import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, randomUUID } from 'node:crypto';
import { createPublicClient, http } from 'viem';
import { openDatabase, migrate, verifySchema } from '../services/persistence/database.mjs';
import { createJobStore, LeaseLostError } from '../services/persistence/store.mjs';
import { createScheduler } from '../runtime/scheduler.mjs';
import { createOutboxDispatcher } from '../runtime/outbox.mjs';
import { createSocialHandler, confirmedLaunchIntents, prepareSocialPublication, verifySocialReceipt } from '../runtime/social.mjs';
import { parseRawCid } from '../sdk/artifacts.mjs';
import { safeFetch } from '../sdk/safe-fetch.mjs';

// Real PostgreSQL and preserved local chain/evidence; browser outcomes below are
// explicit fault-injection fixtures, not evidence of an external social publication.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
assert.equal(process.platform, 'linux');
assert.ok(process.env.HALO_TEST_DATABASE_URL, 'Supply the local acceptance database URL');
const config = { url: process.env.HALO_TEST_DATABASE_URL, local: true };
const deployment = JSON.parse(fs.readFileSync(path.join(root, 'test-results/browser-trading-deployment.json')));
assert.equal(deployment.chainId, 31337); assert.equal(deployment.environment, 'local');
assert.equal(deployment.rpcUrl, 'http://127.0.0.1:8547');
const agent = '0x532323de74BAb864b7005D910E5bD8562D038b9b';
const artifacts = Object.fromEntries(['AgentRegistry', 'AgentVault'].map(name => [name, JSON.parse(fs.readFileSync(path.join(root, `artifacts/${name}.json`)))]));
const client = createPublicClient({ transport: http(deployment.rpcUrl) });
const content = { async get(uri) {
  return (await safeFetch(`http://127.0.0.1:8793/ipfs/${parseRawCid(uri)}`, {
    localOrigins: ['http://127.0.0.1:8793'], maxBytes: 262144, timeoutMs: 10000,
  })).bytes;
} };
const before = await client.getBlockNumber();
const databaseName = `halo_social_test_${randomBytes(6).toString('hex')}`;
assert.match(databaseName, /^halo_social_test_[a-f0-9]{12}$/);
const adminUrl = new URL(config.url); adminUrl.pathname = '/postgres';
const admin = openDatabase({ ...config, url: adminUrl.toString() });
try { await admin.pool.query(`CREATE DATABASE "${databaseName}"`); } finally { await admin.close(); }
const url = new URL(config.url); url.pathname = `/${databaseName}`;
let database = openDatabase({ ...config, url: url.toString() }), store;
const passed = [];
let browserCalls = 0, executions = 0, target, recovered, prepared;
const readTarget = async () => (await database.pool.query('SELECT * FROM halo_outbox WHERE id=$1', [target.id])).rows[0];
const makeDue = () => database.pool.query("UPDATE halo_outbox SET available_at=clock_timestamp()-interval '1 second' WHERE id=$1", [target.id]);
const reconnect = async () => {
  await database.close(); database = openDatabase({ ...config, url: url.toString() });
  await verifySchema(database); store = await createJobStore({ database, deployment });
};
try {
  assert.equal((await migrate(database)).version, 4);
  store = await createJobStore({ database, deployment });
  for (const nonce of [0n, 1n]) await store.enqueue({ agent, nonce, payload: { version: 'halo.agent-cycle.v1', nonce: nonce.toString() } });
  const operator = { async runCycle() { executions++; throw new Error('Historical launch must not be executed again'); } };
  const schedulers = ['social-recovery-a', 'social-recovery-b'].map(workerId => createScheduler({ client, deployment, artifacts, operator, store, workerId, confirmations: 1 }));
  recovered = await Promise.all(schedulers.map(s => s.workOnce()));
  assert.equal(executions, 0); assert.ok(recovered.every(r => r.status === 'confirmed' && r.kind === 'launch' && r.recovered));
  assert.deepEqual(recovered.map(r => r.nonce).sort(), ['0', '1']);
  const rows = (await database.pool.query('SELECT topic,payload FROM halo_outbox')).rows;
  assert.equal(rows.filter(r => r.topic === 'operator-receipt').length, 2);
  assert.equal(rows.filter(r => r.topic === 'social-post').length, 4);
  assert.deepEqual(rows.filter(r => r.topic === 'social-post').map(r => `${r.payload.nonce}:${r.payload.platform}`).sort(), ['0:fomo', '0:x', '1:fomo', '1:x']);
  for (const result of recovered) for (const event of confirmedLaunchIntents(deployment, result)) await store.enqueueEvent(event);
  assert.equal((await database.pool.query('SELECT count(*)::int AS n FROM halo_outbox')).rows[0].n, 6);
  assert.deepEqual(confirmedLaunchIntents(deployment, { status: 'confirmed', kind: 'hold' }), []);
  passed.push('Two actual historical launches atomically create four distinct social intents and two receipts; replay adds no jobs and hold creates no posts');

  const base = () => ({ client, deployment, artifacts, content, store, confirmations: 1 });
  // The agent's creator connects accounts out of band; there is no self-service onboarding
  // task any more. With no connection at all, the job defers immediately and no browser runs.
  const noConnection = createSocialHandler({ ...base(), async runBrowser() { browserCalls++; throw new Error('Must not run without a connected account'); } });
  const initial = await createOutboxDispatcher({ store, workerId: 'social-no-connection-fixture', handlers: { 'social-post': noConnection } }).deliverOnce('social-post');
  assert.equal(initial.status, 'deferred'); target = { id: initial.id };
  target = await readTarget(); prepared = target.prepared_payload;
  assert.equal(target.state, 'queued'); assert.equal(target.last_result.status, 'needs-connection');
  assert.equal(target.last_result.externalMutationPossible, false); assert.ok(prepared.text.includes(agent.toLowerCase()));
  assert.ok(prepared.text.includes(target.payload.transactionHash));
  assert.equal(browserCalls, 0);
  const again = await prepareSocialPublication({ ...base(), intent: target.payload });
  assert.deepEqual(again, prepared);
  // Keep other independent platform/nonce jobs pending while isolating restart tests.
  await database.pool.query("UPDATE halo_outbox SET available_at=clock_timestamp()+interval '1 hour' WHERE topic='social-post' AND id<>$1", [target.id]);
  passed.push('Real hash-checked evidence and token identity produce stable text; an agent with no connected account defers without ever launching a browser');

  await assert.rejects(prepareSocialPublication({ ...base(), intent: target.payload,
    content: { async get(uri) { return Buffer.concat([await content.get(uri), Buffer.from('altered')]); } } }), /content mismatch/);
  await assert.rejects(verifySocialReceipt({ ...base(), intent: { ...target.payload, child: `0x${'a'.repeat(40)}` } }), /does not match/);
  await assert.rejects(verifySocialReceipt({ ...base(), intent: target.payload,
    client: { ...client, async getBlock(args) { return { ...await client.getBlock(args), hash: `0x${'0'.repeat(64)}` }; } } }), /canonically confirmed/);
  assert.equal(browserCalls, 0);
  passed.push('Altered public evidence, wrong child and a simulated orphaned receipt are rejected before any browser call');

  await makeDue(); const delivery = await store.claimDelivery('social-post', 'pre-crash-fixture');
  assert.equal(delivery.id, target.id);
  await assert.rejects(store.checkpointDelivery(delivery, { prepared: { ...prepared, text: 'Substituted thesis' } }), /cannot change/);
  const origin = target.payload.platform === 'x' ? 'https://x.com' : 'https://fomo.family';
  const binding = { method: 'browser-session', state: 'connected', profileUrl: `${origin}/halo_test`, identity: { role: 'link', name: 'Profile' } };
  await store.checkpointDelivery(delivery, { result: { status: 'browser-started', jobId: prepared.id, profileUrl: binding.profileUrl, externalMutationPossible: true } });
  await database.pool.query("UPDATE halo_outbox SET lease_until=clock_timestamp()-interval '1 second' WHERE id=$1", [delivery.id]);
  await reconnect();
  const replacement = await store.claimDelivery('social-post', 'replacement-fixture'); assert.equal(replacement.id, delivery.id);
  await assert.rejects(store.acknowledge(delivery), LeaseLostError);
  const checkpoint = await store.checkpointDelivery(replacement, { prepared });
  assert.equal(checkpoint.result.externalMutationPossible, true); assert.deepEqual(checkpoint.prepared, prepared);
  await store.retryDelivery(replacement, { reason: 'recovered-ambiguous-publication' });
  passed.push('Expired workers lose delivery rights; a new database pool recovers the exact thesis, account and possible prior submission');

  await makeDue();
  const interrupted = createSocialHandler({ ...base(), bindings: async () => binding, async runBrowser(job, guard) {
    browserCalls++; assert.equal(job.reconcileOnly, true); await guard.beforeStart(); await guard.verifyReceipt();
    throw new Error('Injected browser process disappearance');
  } });
  assert.equal((await createOutboxDispatcher({ store, workerId: 'interrupted-fixture', handlers: { 'social-post': interrupted } }).deliverOnce('social-post')).status, 'retryable-error');
  assert.equal((await readTarget()).last_result.externalMutationPossible, true);
  await reconnect(); await makeDue();
  const reconcile = createSocialHandler({ ...base(), bindings: async () => binding, async runBrowser(job) {
    browserCalls++; assert.equal(job.reconcileOnly, true); assert.equal(job.text, prepared.text);
    return { executionId: randomUUID(), result: { status: 'uncertain' }, reportsDelivered: false };
  } });
  assert.equal((await createOutboxDispatcher({ store, workerId: 'reconcile-fixture', handlers: { 'social-post': reconcile } }).deliverOnce('social-post')).status, 'deferred');
  assert.equal((await readTarget()).last_result.externalMutationPossible, true);
  passed.push('A disappearing browser and another pool restart preserve uncertainty and force read-only reconciliation instead of a duplicate publish');

  await makeDue(); const callsBefore = browserCalls;
  const switched = createSocialHandler({ ...base(), bindings: async () => ({ ...binding, profileUrl: `${origin}/other_account` }), async runBrowser() { browserCalls++; throw new Error('Must not run'); } });
  assert.equal((await createOutboxDispatcher({ store, workerId: 'changed-account-fixture', handlers: { 'social-post': switched } }).deliverOnce('social-post')).status, 'retryable-error');
  assert.equal(browserCalls, callsBefore);
  assert.throws(() => createSocialHandler({ ...base(), publish: true }), /cannot publish/);
  passed.push('A queued publication cannot silently switch accounts, and a local deployment cannot enable external posting');

  await makeDue();
  const falseSuccess = createSocialHandler({ ...base(), bindings: async () => binding, async runBrowser() {
    browserCalls++; return { executionId: randomUUID(), result: { status: 'posted', profileUrl: binding.profileUrl, text: 'Wrong thesis', postUrl: `${binding.profileUrl}/status/123` } };
  } });
  assert.equal((await createOutboxDispatcher({ store, workerId: 'false-success-fixture', handlers: { 'social-post': falseSuccess } }).deliverOnce('social-post')).status, 'retryable-error');
  assert.equal((await readTarget()).state, 'queued');
  assert.equal((await database.pool.query("SELECT count(*)::int AS n FROM halo_outbox WHERE topic='social-post' AND state='delivered'")).rows[0].n, 0);
  passed.push('A reported post with different text cannot acknowledge a social job; all four real launch intents remain pending');

  fs.writeFileSync(path.join(root, 'test-results/social-outbox.json'), JSON.stringify({ checkedAt: new Date().toISOString(), databaseName,
    schemaVersion: 3, agent, chainId: deployment.chainId, observedBlockBefore: before.toString(), observedBlockAfter: (await client.getBlockNumber()).toString(),
    newTransactionsSubmittedByTest: 0, externalSocialPosts: 0, browserProcessExecutions: 0, injectedBrowserCalls: browserCalls,
    scope: 'Actual PostgreSQL, preserved local Qwen launch receipts and content-addressed evidence; injected browser outcomes test delivery and recovery only',
    recovered: recovered.map(r => ({ nonce: r.nonce, transactionHash: r.transactionHash, child: r.child, evidenceURI: r.evidenceURI })),
    selectedIntent: target.payload, prepared, passed }, null, 2));
  console.log(`PASS ${passed.length} real-chain social-outbox scenarios; no external posts or new transactions`);
} finally { await database.close(); }
