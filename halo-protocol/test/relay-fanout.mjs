import assert from 'node:assert/strict';
import { createFanout, memoryBus, postgresBus } from '../services/relay/fanout.mjs';

const passed = [];
const pass = name => { passed.push(name); console.log(`PASS ${name}`); };
const agent = '0x2B961E3959b79326A8e7F64Ef0d2d825707669b5';

{ // Single instance without a bus behaves like the original in-memory watchers.
  const fanout = createFanout();
  const seen = [];
  const off = fanout.subscribe(agent, encoded => seen.push(encoded));
  await fanout.publish(agent.toLowerCase(), 'a'); await fanout.publish(agent, 'b');
  off(); await fanout.publish(agent, 'c');
  assert.deepEqual(seen, ['a', 'b']); assert.equal(fanout.viewers, 0);
  pass('local subscribers receive publications until they unsubscribe');
}
{ // Two relay instances share a bus: a record published on one reaches a viewer on the other, once, and never echoes.
  const bus = memoryBus();
  const a = createFanout({ bus }), b = createFanout({ bus });
  const onA = [], onB = [];
  a.subscribe(agent, e => onA.push(e)); b.subscribe(agent, e => onB.push(e));
  const result = await a.publish(agent, 'from-a');
  assert.equal(result.remote, true);
  assert.deepEqual(onA, ['from-a']); assert.deepEqual(onB, ['from-a']);
  await b.publish(agent, 'from-b');
  assert.deepEqual(onA, ['from-a', 'from-b']); assert.deepEqual(onB, ['from-a', 'from-b']);
  pass('two instances on one bus deliver each record exactly once to every viewer');
}
{ // Viewers for another agent never receive the record; the cap is enforced per instance.
  const bus = memoryBus();
  const a = createFanout({ bus, maxViewers: 1 }), b = createFanout({ bus });
  const other = [];
  b.subscribe('0x000000000000000000000000000000000000dEaD', e => other.push(e));
  assert.ok(a.subscribe(agent, () => {})); assert.equal(a.subscribe(agent, () => {}), null);
  await a.publish(agent, 'x');
  assert.deepEqual(other, []);
  pass('agent isolation and the viewer cap hold');
}
{ // Oversized payloads stay local rather than being truncated on the bus.
  const bus = memoryBus();
  const a = createFanout({ bus, maxPayloadBytes: 16 }), b = createFanout({ bus });
  const onA = [], onB = [];
  a.subscribe(agent, e => onA.push(e)); b.subscribe(agent, e => onB.push(e));
  const result = await a.publish(agent, 'x'.repeat(40));
  assert.equal(result.remote, false); assert.equal(a.remoteDropped, 1);
  assert.equal(onA.length, 1); assert.equal(onB.length, 0);
  pass('oversized records are delivered locally and counted, never truncated');
}
if (process.env.HALO_TEST_DATABASE_URL) {
  const { default: pg } = await import('../services/persistence/node_modules/pg/lib/index.js');
  const pool = new pg.Pool({ connectionString: process.env.HALO_TEST_DATABASE_URL, max: 4 });
  const channel = `halo_fanout_test_${Date.now()}`;
  const busA = await postgresBus({ pool, channel }), busB = await postgresBus({ pool, channel });
  const a = createFanout({ bus: busA }), b = createFanout({ bus: busB });
  const onB = []; b.subscribe(agent, e => onB.push(e));
  await a.publish(agent, 'via-postgres');
  await new Promise(resolve => setTimeout(resolve, 500));
  assert.deepEqual(onB, ['via-postgres']);
  await a.close(); await b.close(); await pool.end();
  pass('PostgreSQL LISTEN/NOTIFY carries records between instances');
} else console.log('SKIP PostgreSQL bus: set HALO_TEST_DATABASE_URL to run it');
console.log(`PASS ${passed.length} relay fan-out scenarios`);
