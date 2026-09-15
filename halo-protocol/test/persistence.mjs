import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import { root } from '../scripts/compile.mjs';
import { openDatabase, migrate, verifySchema } from '../services/persistence/database.mjs';
import { createJobStore, LeaseLostError } from '../services/persistence/store.mjs';
import { createOutboxDispatcher } from '../runtime/outbox.mjs';

const config = process.env.HALO_TEST_DATABASE_URL ? { url: process.env.HALO_TEST_DATABASE_URL, local: true }
  : JSON.parse(fs.readFileSync(path.resolve(root, '../../work/postgres-private/connection.json')));
const databaseName = `halo_queue_test_${randomBytes(6).toString('hex')}`;
assert.match(databaseName, /^halo_queue_test_[a-f0-9]{12}$/);
const adminUrl = new URL(config.url); adminUrl.pathname = '/postgres';
const admin = openDatabase({ ...config, url: adminUrl.toString() });
try { await admin.pool.query(`CREATE DATABASE "${databaseName}"`); } finally { await admin.close(); }
const url = new URL(config.url); url.pathname = `/${databaseName}`;
let database = openDatabase({ ...config, url: url.toString() });
const deploymentFile = path.join(root, 'test-results/local-deployment.json');
// Database-only CI does not need an EVM deployment; these addresses are explicitly synthetic.
const deployment = fs.existsSync(deploymentFile) ? JSON.parse(fs.readFileSync(deploymentFile)) : {
  environment: 'local', chainId: 31337, rpcUrl: 'http://127.0.0.1:8545', registry: `0x${'1'.repeat(40)}`,
  decisionVerifier: `0x${'2'.repeat(40)}`, rootHalo: `0x${'3'.repeat(40)}`, operatingToken: `0x${'4'.repeat(40)}`, coreReleaseSha256: '5'.repeat(64),
};
const passed = [];
try {
  const migrations = await Promise.all([migrate(database), migrate(database)]);
  assert.equal(migrations[0].serverVersion, 170011); assert.equal(migrations[0].sha256, migrations[1].sha256);
  assert.equal(migrations[0].version, 4); assert.equal((await verifySchema(database)).schemaVersion, 4);
  passed.push('Concurrent migration is serialized and pins its source checksum on real PostgreSQL 17.11');
  let store = await createJobStore({ database, deployment });
  const agent = `0x${'a'.repeat(40)}`;
  const first = await store.enqueue({ agent, nonce: 0n, payload: { task: 'fixture' } });
  assert.equal((await store.enqueue({ agent, nonce: '0', payload: { task: 'fixture' } })).id, first.id);
  await assert.rejects(store.enqueue({ agent, nonce: 0n, payload: { task: 'different' } }), /conflicts/);
  passed.push('Agent nonce deduplicates enqueue and rejects conflicting payloads');
  for (let i = 1; i < 20; i++) await store.enqueue({ agent, nonce: BigInt(i) });
  const claimed = await Promise.all(Array.from({ length: 24 }, (_, i) => store.claim(`worker-${i}`, 120)));
  const leases = claimed.filter(Boolean);
  assert.equal(leases.length, 20); assert.equal(new Set(leases.map(j => j.id)).size, 20);
  assert.equal(new Set(leases.map(j => j.lease_token)).size, 20);
  passed.push('Twenty jobs are claimed once each by 24 competing requests using SKIP LOCKED');
  const old = leases[0];
  await database.pool.query("UPDATE halo_jobs SET lease_until=clock_timestamp()-interval '1 second' WHERE id=$1", [old.id]);
  const replacement = await store.claim('replacement', 120);
  assert.equal(replacement.id, old.id); assert.notEqual(replacement.lease_token, old.lease_token); assert.equal(replacement.attempts, 2);
  await assert.rejects(store.renew(old), LeaseLostError); await assert.rejects(store.complete(old, { status: 'stale' }), LeaseLostError);
  const attempts = (await database.pool.query('SELECT outcome FROM halo_job_attempts WHERE token=$1', [old.lease_token])).rows;
  assert.equal(attempts[0].outcome, 'lease-expired');
  passed.push('Expired claim is recovered and the stale worker cannot renew or complete it');
  await store.complete(replacement, { status: 'fixture-complete' }, [{ topic: 'operator-receipt', streamKey: 'receipt-one', dedupeKey: 'receipt-one', ordinal: 0, payload: { fixture: true } }]);
  assert.equal((await database.pool.query('SELECT state FROM halo_jobs WHERE id=$1', [old.id])).rows[0].state, 'completed');
  assert.equal((await database.pool.query("SELECT count(*)::int AS n FROM halo_outbox WHERE dedupe_key='receipt-one'")).rows[0].n, 1);
  passed.push('Completion atomically persists both the result and publication');
  await store.enqueueEvent({ topic: 'operator-receipt', streamKey: 'conflict', dedupeKey: 'conflict', ordinal: 0, payload: { old: true } });
  await assert.rejects(store.complete(leases[1], { status: 'must-rollback' }, [
    { topic: 'operator-receipt', streamKey: 'rollback', dedupeKey: 'rollback', ordinal: 0, payload: {} },
    { topic: 'operator-receipt', streamKey: 'conflict', dedupeKey: 'conflict', ordinal: 0, payload: { old: false } },
  ]), /conflicts/);
  assert.equal((await database.pool.query('SELECT state FROM halo_jobs WHERE id=$1', [leases[1].id])).rows[0].state, 'leased');
  assert.equal((await database.pool.query("SELECT count(*)::int AS n FROM halo_outbox WHERE dedupe_key='rollback'")).rows[0].n, 0);
  passed.push('A conflicting publication rolls back the entire completion transaction');
  await store.retry(leases[1], { delaySeconds: 30, reason: 'fixture-retry' });
  assert.equal(await store.claim('too-early'), null);
  await database.pool.query("UPDATE halo_jobs SET available_at=clock_timestamp()-interval '1 second' WHERE id=$1", [leases[1].id]);
  assert.equal((await store.claim('retry-worker')).id, leases[1].id);
  passed.push('Retry delay prevents early work and preserves the original job identity');
  for (const [streamKey, ordinal] of [['a',0],['a',1],['b',0]]) await store.enqueueEvent({ topic: 'public-step', streamKey, ordinal, dedupeKey: `${streamKey}:${ordinal}`, payload: { fixture: `${streamKey}:${ordinal}` } });
  const deliveries = (await Promise.all(Array.from({ length: 3 }, (_, i) => store.claimDelivery('public-step', `delivery-${i}`, 120)))).filter(Boolean);
  assert.equal(deliveries.length, 2); assert.ok(deliveries.every(d => d.ordinal === 0));
  const a = deliveries.find(d => d.stream_key === 'a');
  await assert.rejects(store.acknowledge({ ...a, lease_token: randomUUID() }), LeaseLostError);
  await store.acknowledge(a);
  const second = await store.claimDelivery('public-step', 'next'); assert.equal(second.stream_key, 'a'); assert.equal(second.ordinal, 1);
  passed.push('Outbox streams preserve order across consumers; stale acknowledgements are rejected');
  await database.pool.query("UPDATE halo_outbox SET lease_until=clock_timestamp()-interval '1 second' WHERE id=$1", [second.id]);
  const recovered = await store.claimDelivery('public-step', 'replacement');
  assert.equal(recovered.id, second.id); assert.deepEqual(recovered.payload, second.payload); assert.notEqual(recovered.lease_token, second.lease_token);
  await store.acknowledge(recovered);
  passed.push('Unacknowledged publication is reclaimed with its exact original payload');
  const appended = await Promise.all(Array.from({ length: 5 }, () => store.appendStream('social-post', 'append-fixture', async (previous, ordinal) => ({ previous: previous?.ordinal ?? null, ordinal }))));
  assert.deepEqual(appended.map(r => r.ordinal).sort(), [0,1,2,3,4]);
  const ordered = (await database.pool.query("SELECT payload FROM halo_outbox WHERE stream_key='append-fixture' ORDER BY ordinal")).rows;
  assert.deepEqual(ordered.map(r => r.payload.previous), [null,0,1,2,3]);
  passed.push('Concurrent append uses a transactional stream lock and retains a contiguous public record order');
  await assert.rejects(createJobStore({ database, deployment: { ...deployment, rootHalo: `0x${'b'.repeat(40)}` } }), /identity differs/);
  const other = await createJobStore({ database, deployment: { ...deployment, registry: `0x${'c'.repeat(40)}` } });
  assert.equal(await other.claim('other-deployment'), null);
  passed.push('Deployment identity changes and cross-deployment work claims are rejected');
  await database.close(); database = openDatabase({ ...config, url: url.toString() }); store = await createJobStore({ database, deployment });
  const history = await store.recentJobs(agent, 30);
  assert.equal(history.length, 20); assert.equal(history.find(j => j.id === old.id).result.status, 'fixture-complete');
  assert.equal('leaseToken' in history[0], false);
  passed.push('A new connection pool recovers persisted results through Drizzle without exposing private lease tokens');
  const selectedAgent = `0x${'d'.repeat(40)}`, untouchedAgent = `0x${'e'.repeat(40)}`;
  const untouched = await store.enqueue({ agent: untouchedAgent, nonce: 0n });
  const selected = await store.enqueue({ agent: selectedAgent, nonce: 0n });
  const scoped = (await Promise.all(Array.from({ length: 8 }, (_, i) => store.claim(`scoped-${i}`, 120, { agent: selectedAgent })))).filter(Boolean);
  assert.equal(scoped.length, 1); assert.equal(scoped[0].id, selected.id);
  assert.equal((await database.pool.query('SELECT state FROM halo_jobs WHERE id=$1', [untouched.id])).rows[0].state, 'queued');
  assert.equal(await store.claim('empty-scope', 120, { agent: `0x${'f'.repeat(40)}` }), null);
  await assert.rejects(store.claim('invalid-scope', 120, { agent: 'not-an-address' }));
  passed.push('Eight scoped workers claim only their selected agent; earlier jobs belonging to another agent remain queued');
  await store.enqueueEvent({ topic: 'operator-receipt', streamKey: 'prepared-fixture', dedupeKey: 'prepared-fixture', ordinal: 0, payload: { test: 'prepared' } });
  // Earlier receipt streams may still be pending. Drain them before the dedicated checkpoint case.
  let delivery;
  while ((delivery = await store.claimDelivery('operator-receipt', 'checkpoint-worker')) && delivery.stream_key !== 'prepared-fixture') await store.acknowledge(delivery);
  assert.ok(delivery);
  const prepared = { text: 'A single immutable thesis', profileUrl: 'https://x.com/halo_test' };
  await store.checkpointDelivery(delivery, { prepared, result: { status: 'browser-started', externalMutationPossible: true } });
  await assert.rejects(store.checkpointDelivery(delivery, { prepared: { ...prepared, text: 'Changed text' } }), /cannot change/);
  await assert.rejects(store.checkpointDelivery({ ...delivery, lease_token: randomUUID() }, { result: { status: 'forged' } }), LeaseLostError);
  passed.push('Prepared text is immutable and stale delivery tokens cannot alter its checkpoint');
  await assert.rejects(database.pool.query('UPDATE halo_outbox SET prepared_hash=NULL WHERE id=$1', [delivery.id]), /halo_outbox_prepared_pair/);
  await assert.rejects(database.pool.query('UPDATE halo_outbox SET last_result_hash=NULL WHERE id=$1', [delivery.id]), /halo_outbox_result_pair/);
  passed.push('Database constraints reject missing hashes for prepared publications and attempt results');
  await store.retryDelivery(delivery, { reason: 'lost-browser-response' });
  await database.close(); database = openDatabase({ ...config, url: url.toString() }); store = await createJobStore({ database, deployment });
  await database.pool.query("UPDATE halo_outbox SET available_at=clock_timestamp()-interval '1 second' WHERE id=$1", [delivery.id]);
  const retry = await store.claimDelivery('operator-receipt', 'replacement-publisher');
  assert.equal(retry.id, delivery.id);
  const checkpoint = await store.checkpointDelivery(retry, { prepared });
  assert.deepEqual(checkpoint.prepared, prepared); assert.equal(checkpoint.result.externalMutationPossible, true);
  await assert.rejects(store.acknowledge(delivery), LeaseLostError);
  passed.push('A new pool recovers exact text and publication uncertainty while fencing the old worker');
  await store.acknowledge(retry, { status: 'posted', postUrl: 'https://x.com/halo_test/status/123', fixture: true });
  const done = (await database.pool.query('SELECT state,prepared_payload,last_result FROM halo_outbox WHERE id=$1', [retry.id])).rows[0];
  assert.equal(done.state, 'delivered'); assert.deepEqual(done.prepared_payload, prepared); assert.equal(done.last_result.status, 'posted');
  passed.push('Final acknowledgement atomically preserves the prepared text and supplied delivery outcome');
  const publicationOutcome={uri:'ipfs://explicit-test-fixture',replicas:[{id:'fixture-peer'}]};
  await store.enqueueEvent({topic:'operator-receipt',streamKey:'receipt-result-fixture',dedupeKey:'receipt-result-fixture',ordinal:0,payload:{test:'delivery-result'}});
  const dispatched=await createOutboxDispatcher({store,workerId:'receipt-result',handlers:{'operator-receipt':async()=>publicationOutcome}}).deliverOnce('operator-receipt');
  assert.equal(dispatched.status,'delivered');
  const savedPublication=(await database.pool.query('SELECT state,last_result FROM halo_outbox WHERE id=$1',[dispatched.id])).rows[0];
  assert.equal(savedPublication.state,'delivered'); assert.deepEqual(savedPublication.last_result,publicationOutcome);
  passed.push('The real dispatcher persists receipt-publication evidence with its acknowledgement instead of retaining it only in process output');
  const postmasterStartedAt = (await database.pool.query('SELECT pg_postmaster_start_time() AS started')).rows[0].started.toISOString();
  const report = { checkedAt: new Date().toISOString(), serverVersion: migrations[0].serverVersion, databaseName, postmasterStartedAt,
    scope: 'Real PostgreSQL server and competing pooled connections; synthetic jobs, no chain transactions or social posts', persistedJobId: old.id, agent, passed };
  const reportName = process.env.HALO_TEST_RESULT_NAME ?? 'persistence.json';
  assert.match(reportName, /^[a-z0-9-]+\.json$/);
  fs.writeFileSync(path.join(root, 'test-results', reportName), JSON.stringify(report, null, 2));
  console.log(`PASS ${passed.length} PostgreSQL lease and outbox scenarios`);
} finally { await database.close(); }
