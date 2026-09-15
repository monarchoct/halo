import { createHash } from 'node:crypto';
import { and, desc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { canonicalJson } from '../../sdk/manifest.mjs';
import { assertSupportedDeployment } from '../../sdk/networks.mjs';
import { jobs, outbox } from './schema.mjs';

const hash = value => createHash('sha256').update(canonicalJson(value)).digest('hex');
const address = value => z.string().regex(/^0x[0-9a-fA-F]{40}$/).parse(value).toLowerCase();
const nonceString = value => { const n = BigInt(value); if (n < 0n || n >= 1n << 256n) throw new Error('Invalid agent nonce'); return n.toString(); };
const workerId = value => z.string().min(1).max(120).parse(value);
const duration = value => z.number().int().min(1).max(3600).parse(value);
const eventSchema = z.object({ topic: z.enum(['public-step', 'social-post', 'operator-receipt']), dedupeKey: z.string().min(1).max(256),
  streamKey: z.string().min(1).max(256), ordinal: z.number().int().min(0), payload: z.record(z.string(), z.unknown()) }).strict();
function bounded(value) { if (Buffer.byteLength(canonicalJson(value)) > 262144) throw new Error('Public database payload is too large'); return value; }
const first = result => result.rows[0];
export class LeaseLostError extends Error { constructor() { super('Job lease expired or belongs to another worker'); this.name = 'LeaseLostError'; } }

export async function createJobStore({ database, deployment }) {
  assertSupportedDeployment(deployment);
  const db = database.db, deploymentId = `${deployment.chainId}:${address(deployment.registry)}`;
  const identityHash = hash({ chainId: deployment.chainId, registry: address(deployment.registry), decisionVerifier: address(deployment.decisionVerifier),
    rootHalo: address(deployment.rootHalo), operatingToken: address(deployment.operatingToken), coreReleaseSha256: deployment.coreReleaseSha256 });
  await db.execute(sql`INSERT INTO halo_deployments(id,chain_id,registry,identity_hash) VALUES (${deploymentId},${deployment.chainId},${address(deployment.registry)},${identityHash}) ON CONFLICT DO NOTHING`);
  const existing = first(await db.execute(sql`SELECT identity_hash FROM halo_deployments WHERE id=${deploymentId}`));
  if (existing?.identity_hash !== identityHash) throw new Error('Database deployment identity differs from this release');

  async function enqueueEvent(tx, input) {
    const event = eventSchema.parse(input), payload = bounded(event.payload), payloadHash = hash(payload);
    await tx.execute(sql`INSERT INTO halo_outbox(deployment_id,topic,dedupe_key,stream_key,ordinal,payload,payload_hash)
      VALUES (${deploymentId},${event.topic},${event.dedupeKey},${event.streamKey},${event.ordinal},${JSON.stringify(payload)}::jsonb,${payloadHash}) ON CONFLICT DO NOTHING`);
    const saved = first(await tx.execute(sql`SELECT * FROM halo_outbox WHERE deployment_id=${deploymentId} AND topic=${event.topic} AND dedupe_key=${event.dedupeKey}`));
    if (!saved || saved.payload_hash !== payloadHash || saved.stream_key !== event.streamKey || saved.ordinal !== event.ordinal) throw new Error('Outbox identity conflicts with an existing public record');
    return saved;
  }
  const assertLease = async (tx, lease, lock = false) => {
    const result = await tx.execute(sql`SELECT id FROM halo_jobs WHERE id=${lease.id}::uuid AND deployment_id=${deploymentId}
      AND state='leased' AND lease_token=${lease.lease_token}::uuid AND lease_owner=${lease.lease_owner} AND lease_until>clock_timestamp() ${lock ? sql`FOR UPDATE` : sql``}`);
    if (!result.rows.length) throw new LeaseLostError();
  };
  return {
    deploymentId,
    async enqueue({ agent, nonce, payload = {}, delaySeconds = 0 }) {
      agent = address(agent); nonce = nonceString(nonce); bounded(payload);
      z.number().int().min(0).max(86400).parse(delaySeconds);
      const payloadHash = hash(payload);
      await db.execute(sql`INSERT INTO halo_jobs(deployment_id,agent,nonce,payload,payload_hash,available_at)
        VALUES (${deploymentId},${agent},${nonce}::numeric,${JSON.stringify(payload)}::jsonb,${payloadHash},clock_timestamp()+${delaySeconds}*interval '1 second') ON CONFLICT DO NOTHING`);
      const result = first(await db.execute(sql`SELECT * FROM halo_jobs WHERE deployment_id=${deploymentId} AND agent=${agent} AND nonce=${nonce}::numeric`));
      if (result.payload_hash !== payloadHash) throw new Error('Job identity conflicts with a different payload');
      return result;
    },
    async claim(worker, leaseSeconds = 180, { agent } = {}) {
      workerId(worker); duration(leaseSeconds);
      const selectedAgent = agent === undefined ? null : address(agent);
      return db.transaction(async tx => {
        const job = first(await tx.execute(sql`WITH candidate AS (
          SELECT id FROM halo_jobs WHERE deployment_id=${deploymentId} AND (${selectedAgent}::text IS NULL OR agent=${selectedAgent})
          AND ((state='queued' AND available_at<=clock_timestamp()) OR (state='leased' AND lease_until<=clock_timestamp()))
          ORDER BY available_at,created_at,id FOR UPDATE SKIP LOCKED LIMIT 1)
          UPDATE halo_jobs j SET state='leased',lease_token=gen_random_uuid(),lease_owner=${worker},lease_until=clock_timestamp()+${leaseSeconds}*interval '1 second',
            attempts=j.attempts+1,updated_at=clock_timestamp() FROM candidate c WHERE j.id=c.id RETURNING j.*`));
        if (!job) return null;
        await tx.execute(sql`UPDATE halo_job_attempts SET outcome='lease-expired',finished_at=clock_timestamp() WHERE job_id=${job.id}::uuid AND finished_at IS NULL`);
        await tx.execute(sql`INSERT INTO halo_job_attempts(token,job_id,worker) VALUES (${job.lease_token}::uuid,${job.id}::uuid,${worker})`);
        return job;
      });
    },
    async renew(lease, leaseSeconds = 180) {
      duration(leaseSeconds);
      const value = first(await db.execute(sql`UPDATE halo_jobs SET lease_until=clock_timestamp()+${leaseSeconds}*interval '1 second',updated_at=clock_timestamp()
        WHERE id=${lease.id}::uuid AND deployment_id=${deploymentId} AND state='leased' AND lease_token=${lease.lease_token}::uuid AND lease_owner=${lease.lease_owner} AND lease_until>clock_timestamp() RETURNING lease_until`));
      if (!value) throw new LeaseLostError(); return value.lease_until;
    },
    assertLease: lease => assertLease(db, lease),
    async submitted(lease, transactionHash) {
      z.string().regex(/^0x[0-9a-f]{64}$/).parse(transactionHash);
      await db.transaction(async tx => { await assertLease(tx, lease, true);
        await tx.execute(sql`UPDATE halo_job_attempts SET transaction_hash=${transactionHash} WHERE token=${lease.lease_token}::uuid`); });
    },
    async complete(lease, result, events = []) {
      bounded(result); z.array(eventSchema).max(8).parse(events);
      return db.transaction(async tx => {
        await assertLease(tx, lease, true);
        for (const event of events) await enqueueEvent(tx, event);
        await tx.execute(sql`UPDATE halo_jobs SET state='completed',result=${JSON.stringify(result)}::jsonb,result_hash=${hash(result)},lease_token=NULL,lease_owner=NULL,lease_until=NULL,updated_at=clock_timestamp() WHERE id=${lease.id}::uuid`);
        await tx.execute(sql`UPDATE halo_job_attempts SET outcome='completed',finished_at=clock_timestamp() WHERE token=${lease.lease_token}::uuid`);
        return { completed: true, outboxRecords: events.length };
      });
    },
    async retry(lease, { delaySeconds = 30, reason = 'retryable-error' } = {}) {
      duration(delaySeconds); z.string().min(1).max(240).parse(reason);
      return db.transaction(async tx => { await assertLease(tx, lease, true);
        await tx.execute(sql`UPDATE halo_jobs SET state='queued',available_at=clock_timestamp()+${delaySeconds}*interval '1 second',last_error=${reason},lease_token=NULL,lease_owner=NULL,lease_until=NULL,updated_at=clock_timestamp() WHERE id=${lease.id}::uuid`);
        await tx.execute(sql`UPDATE halo_job_attempts SET outcome=${reason},finished_at=clock_timestamp() WHERE token=${lease.lease_token}::uuid`);
      });
    },
    enqueueEvent: input => db.transaction(tx => enqueueEvent(tx, input)),
    async appendStream(topic, streamKey, build) {
      eventSchema.shape.topic.parse(topic); eventSchema.shape.streamKey.parse(streamKey);
      return db.transaction(async tx => {
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`${deploymentId}:${topic}:${streamKey}`},0))`);
        const previous = (await tx.select().from(outbox).where(and(eq(outbox.deploymentId,deploymentId),eq(outbox.topic,topic),eq(outbox.streamKey,streamKey))).orderBy(desc(outbox.ordinal)).limit(1))[0];
        const ordinal = previous ? previous.ordinal + 1 : 0;
        return enqueueEvent(tx, { topic, streamKey, ordinal, dedupeKey: `${streamKey}:${ordinal}`, payload: await build(previous?.payload,ordinal) });
      });
    },
    async claimDelivery(topic, worker, leaseSeconds = 60) {
      eventSchema.shape.topic.parse(topic); workerId(worker); duration(leaseSeconds);
      return first(await db.execute(sql`WITH candidate AS (
        SELECT o.id FROM halo_outbox o WHERE o.deployment_id=${deploymentId} AND o.topic=${topic}
          AND ((o.state='queued' AND o.available_at<=clock_timestamp()) OR (o.state='leased' AND o.lease_until<=clock_timestamp()))
          AND NOT EXISTS (SELECT 1 FROM halo_outbox earlier WHERE earlier.deployment_id=o.deployment_id AND earlier.topic=o.topic AND earlier.stream_key=o.stream_key AND earlier.ordinal<o.ordinal AND earlier.state NOT IN ('delivered','cancelled'))
          ORDER BY o.available_at,o.created_at,o.id FOR UPDATE OF o SKIP LOCKED LIMIT 1)
        UPDATE halo_outbox o SET state='leased',lease_token=gen_random_uuid(),lease_owner=${worker},lease_until=clock_timestamp()+${leaseSeconds}*interval '1 second',attempts=o.attempts+1
          FROM candidate c WHERE o.id=c.id RETURNING o.*`)) ?? null;
    },
    async checkpointDelivery(delivery, { prepared, result } = {}) {
      if (prepared !== undefined) bounded(z.record(z.string(), z.unknown()).parse(prepared));
      if (result !== undefined) bounded(z.record(z.string(), z.unknown()).parse(result));
      return db.transaction(async tx => {
        const saved = first(await tx.execute(sql`SELECT * FROM halo_outbox WHERE id=${delivery.id}::uuid AND deployment_id=${deploymentId}
          AND state='leased' AND lease_token=${delivery.lease_token}::uuid AND lease_owner=${delivery.lease_owner} AND lease_until>clock_timestamp() FOR UPDATE`));
        if (!saved) throw new LeaseLostError();
        if (prepared !== undefined && saved.prepared_hash && saved.prepared_hash !== hash(prepared)) throw new Error('Prepared publication cannot change across attempts');
        if (prepared !== undefined && !saved.prepared_hash) await tx.execute(sql`UPDATE halo_outbox SET prepared_payload=${JSON.stringify(prepared)}::jsonb,prepared_hash=${hash(prepared)} WHERE id=${delivery.id}::uuid`);
        if (result !== undefined) await tx.execute(sql`UPDATE halo_outbox SET last_result=${JSON.stringify(result)}::jsonb,last_result_hash=${hash(result)} WHERE id=${delivery.id}::uuid`);
        return { prepared: saved.prepared_payload ?? prepared, result: result ?? saved.last_result };
      });
    },
    async acknowledge(delivery, outcome) {
      if (outcome !== undefined) bounded(z.record(z.string(), z.unknown()).parse(outcome));
      const result = await db.execute(sql`UPDATE halo_outbox SET state='delivered',delivered_at=clock_timestamp(),lease_token=NULL,lease_owner=NULL,lease_until=NULL,
        last_result=COALESCE(${outcome === undefined ? null : JSON.stringify(outcome)}::jsonb,last_result),last_result_hash=COALESCE(${outcome === undefined ? null : hash(outcome)},last_result_hash)
        WHERE id=${delivery.id}::uuid AND deployment_id=${deploymentId} AND state='leased' AND lease_token=${delivery.lease_token}::uuid AND lease_owner=${delivery.lease_owner} AND lease_until>clock_timestamp() RETURNING id`);
      if (!result.rows.length) throw new LeaseLostError();
    },
    async renewDelivery(delivery, leaseSeconds = 60) {
      duration(leaseSeconds);
      const result = await db.execute(sql`UPDATE halo_outbox SET lease_until=clock_timestamp()+${leaseSeconds}*interval '1 second'
        WHERE id=${delivery.id}::uuid AND deployment_id=${deploymentId} AND state='leased' AND lease_token=${delivery.lease_token}::uuid AND lease_owner=${delivery.lease_owner} AND lease_until>clock_timestamp() RETURNING id`);
      if (!result.rows.length) throw new LeaseLostError();
    },
    async retryDelivery(delivery, { delaySeconds = 10, reason = 'delivery-unavailable', result: outcome } = {}) {
      duration(delaySeconds); z.string().min(1).max(240).parse(reason);
      if (outcome !== undefined) bounded(z.record(z.string(), z.unknown()).parse(outcome));
      const result = await db.execute(sql`UPDATE halo_outbox SET state='queued',available_at=clock_timestamp()+${delaySeconds}*interval '1 second',last_error=${reason},lease_token=NULL,lease_owner=NULL,lease_until=NULL,
        last_result=COALESCE(${outcome === undefined ? null : JSON.stringify(outcome)}::jsonb,last_result),last_result_hash=COALESCE(${outcome === undefined ? null : hash(outcome)},last_result_hash)
        WHERE id=${delivery.id}::uuid AND deployment_id=${deploymentId} AND state='leased' AND lease_token=${delivery.lease_token}::uuid AND lease_owner=${delivery.lease_owner} AND lease_until>clock_timestamp() RETURNING id`);
      if (!result.rows.length) throw new LeaseLostError();
    },
    async recentJobs(agent, limit = 20) {
      z.number().int().min(1).max(100).parse(limit);
      return db.select({ id: jobs.id, agent: jobs.agent, nonce: jobs.nonce, state: jobs.state, attempts: jobs.attempts, result: jobs.result, updatedAt: jobs.updatedAt })
        .from(jobs).where(and(eq(jobs.deploymentId,deploymentId),eq(jobs.agent,address(agent)))).orderBy(desc(jobs.nonce)).limit(limit);
    },
  };
}
