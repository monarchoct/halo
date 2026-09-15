import { randomUUID } from 'node:crypto';

/**
 * Fan-out for the live relays. Each relay instance keeps its own SSE subscribers; a bus carries published records to
 * every other instance so any replica can serve any agent's stream. With no bus the behaviour is exactly the old
 * single-process one. PostgreSQL NOTIFY carries at most 8000 bytes; public relay records are small (no image bytes),
 * and anything larger is delivered locally only and reported, never truncated.
 */
export function createFanout({ bus, maxViewers = 2000, maxPayloadBytes = 7900 } = {}) {
  const instance = randomUUID(), local = new Map();
  let viewers = 0, remoteDropped = 0;
  const deliver = (agent, encoded) => { for (const write of local.get(agent) ?? []) write(encoded); };
  const detach = bus?.subscribe(message => {
    if (!message || message.instance === instance || typeof message.agent !== 'string' || typeof message.encoded !== 'string') return;
    deliver(message.agent.toLowerCase(), message.encoded);
  });
  return {
    instance,
    get viewers() { return viewers; },
    get remoteDropped() { return remoteDropped; },
    subscribe(agent, write) {
      if (viewers >= maxViewers) return null;
      agent = agent.toLowerCase(); viewers++;
      const set = local.get(agent) ?? new Set(); local.set(agent, set); set.add(write);
      return () => { if (!set.delete(write)) return; viewers--; if (!set.size) local.delete(agent); };
    },
    async publish(agent, encoded) {
      agent = agent.toLowerCase(); deliver(agent, encoded);
      if (!bus) return { remote: false };
      if (Buffer.byteLength(encoded) > maxPayloadBytes) { remoteDropped++; return { remote: false, reason: 'payload exceeds bus limit' }; }
      await bus.publish({ instance, agent, encoded });
      return { remote: true };
    },
    async close() { for (const set of local.values()) set.clear(); local.clear(); viewers = 0; await detach?.(); await bus?.close?.(); },
  };
}

/** In-process bus: several fan-outs in one process (tests, or one relay serving both streams). */
export function memoryBus() {
  const listeners = new Set();
  return {
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    async publish(message) { for (const listener of [...listeners]) listener(message); },
  };
}

/**
 * PostgreSQL LISTEN/NOTIFY bus. One dedicated client listens; publishing uses the pool. The channel name is validated
 * because it is interpolated into SQL (NOTIFY cannot take a parameter for the channel).
 */
export async function postgresBus({ pool, channel }) {
  if (!/^[a-z_][a-z0-9_]{0,62}$/.test(channel)) throw new Error('Invalid fan-out channel name');
  const client = await pool.connect();
  const listeners = new Set();
  client.on('notification', message => {
    if (message.channel !== channel) return;
    let parsed; try { parsed = JSON.parse(message.payload); } catch { return; }
    for (const listener of [...listeners]) listener(parsed);
  });
  await client.query(`LISTEN ${channel}`);
  return {
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    async publish(message) { await pool.query('SELECT pg_notify($1, $2)', [channel, JSON.stringify(message)]); },
    async close() { try { await client.query(`UNLISTEN ${channel}`); } finally { client.release(); } },
  };
}
