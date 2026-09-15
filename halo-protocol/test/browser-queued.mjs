import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, randomUUID } from 'node:crypto';
import { createPublicClient, http, verifyMessage } from 'viem';
import { openDatabase, migrate } from '../services/persistence/database.mjs';
import { createJobStore } from '../services/persistence/store.mjs';
import { createScheduler } from '../runtime/scheduler.mjs';
import { createOutboxDispatcher } from '../runtime/outbox.mjs';
import { createSocialHandler } from '../runtime/social.mjs';
import { createContainerRunner } from '../runtime/browser/container-runner.mjs';
import { browserFrameMessage, imageDigest } from '../runtime/browser/frames.mjs';
import { parseRawCid } from '../sdk/artifacts.mjs';
import { safeFetch } from '../sdk/safe-fetch.mjs';

assert.equal(process.platform, 'linux'); assert.equal(process.getuid(), 1000);
const image = process.argv[2]; assert.match(image ?? '', /^sha256:[a-f0-9]{64}$/);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const deploymentFile = path.join(root, 'test-results/browser-trading-deployment.json');
const deployment = JSON.parse(fs.readFileSync(deploymentFile));
assert.equal(deployment.chainId, 31337); assert.equal(deployment.rpcUrl, 'http://127.0.0.1:8547');
const agent = '0x532323de74BAb864b7005D910E5bD8562D038b9b';
const operatorAddress = '0x15d34aaf54267db7d7c367839aaf71a00a2c6a65';
const config = { url: process.env.HALO_TEST_DATABASE_URL, local: true };
const databaseName = `halo_browser_queue_${randomBytes(6).toString('hex')}`;
const adminUrl = new URL(config.url); adminUrl.pathname = '/postgres';
const admin = openDatabase({ ...config, url: adminUrl.toString() });
try { await admin.pool.query(`CREATE DATABASE "${databaseName}"`); } finally { await admin.close(); }
const url = new URL(config.url); url.pathname = `/${databaseName}`;
const database = openDatabase({ ...config, url: url.toString() });
const client = createPublicClient({ transport: http(deployment.rpcUrl) });
const artifacts = Object.fromEntries(['AgentRegistry', 'AgentVault'].map(name => [name, JSON.parse(fs.readFileSync(path.join(root, `artifacts/${name}.json`)))]));
const content = { async get(uri) { return (await safeFetch(`http://127.0.0.1:8793/ipfs/${parseRawCid(uri)}`,
  { localOrigins: ['http://127.0.0.1:8793'], maxBytes: 262144, timeoutMs: 10000 })).bytes; } };
const stateDirectory = '/home/halo/lab/social-runtime';
const browserConfig = { image, stateDirectory, deploymentFile, egressFile: path.join(root, 'runtime/browser/container/egress.example.json'),
  endpoint: 'http://127.0.0.1:8795', operatorAddress, localTest: true, sudoDocker: true, maxRunSeconds: 120 };
const runner = createContainerRunner(browserConfig), passed = [];
let execution, lockChecked = false, renewals = 0;
try {
  await migrate(database); const store = await createJobStore({ database, deployment });
  await store.enqueue({ agent, nonce: 0n, payload: { version: 'halo.agent-cycle.v1', nonce: '0' } });
  const scheduler = createScheduler({ client, deployment, artifacts, store, workerId: 'queued-browser-recovery', confirmations: 1,
    operator: { async runCycle() { throw new Error('No new action may execute in this acceptance'); } } });
  const recovered = await scheduler.workOnce(); assert.equal(recovered.status, 'confirmed'); assert.equal(recovered.recovered, true);
  await database.pool.query("UPDATE halo_outbox SET available_at=clock_timestamp()+interval '1 hour' WHERE topic='social-post' AND payload->>'platform'='x'");
  const handler = createSocialHandler({ client, deployment, artifacts, content, store, confirmations: 1,
    async runBrowser(job, guard) {
      execution = await runner(job, { ...guard, async beforeStart() {
        await guard.beforeStart();
        await assert.rejects(runner({ ...job }, { ...guard }), /already in use/);
        lockChecked = true;
      } });
      return execution;
    } });
  const dispatcher = createOutboxDispatcher({ store: { ...store, async renewDelivery(...args) { renewals++; return store.renewDelivery(...args); } },
    workerId: `browser-queue:${randomUUID()}`, leaseSeconds: 30, handlers: { 'social-post': handler } });
  const outcome = await dispatcher.deliverOnce('social-post');
  if (!execution) throw new Error(`Container execution failed before returning an outcome: ${outcome.status}. Inspect retained execution logs.`);
  assert.equal(outcome.status, 'deferred'); assert.equal(outcome.result.status, 'needs-account');
  assert.equal(execution.result.status, 'needs-account'); assert.equal(execution.containersCleaned, true);
  assert.equal(execution.reportsDelivered, true); assert.equal(lockChecked, true);
  passed.push('A canonical launch intent runs actual sandboxed Chromium through the durable dispatcher, opens FOMO account setup and remains pending');
  passed.push('A second real flock invocation cannot run another browser with the same agent profile');
  const row = (await database.pool.query('SELECT * FROM halo_outbox WHERE id=$1', [outcome.id])).rows[0];
  assert.equal(row.state, 'queued'); assert.equal(row.last_result.status, 'needs-account'); assert.equal(row.prepared_payload.id, execution.jobId);
  assert.equal(row.last_result.externalMutationPossible, false); assert.equal(row.last_result.reportsDelivered, true);
  const journal = JSON.parse(fs.readFileSync(path.join(execution.executionDirectory, 'publisher/delivery.json')));
  const response = await fetch(`${browserConfig.endpoint}/v1/agents/${agent}/browser`); assert.equal(response.status, 200);
  const frames = (await response.json()).frames.filter(record => record.frame.sessionId === journal.sessionId);
  assert.equal(frames.length, execution.reportCount); assert.ok(frames.length >= 3);
  let imageCount = 0;
  for (const record of frames) {
    assert.equal(record.frame.source, 'local-browser-worker');
    assert.equal(await verifyMessage({ address: record.frame.operator, message: browserFrameMessage(record.frame), signature: record.signature }), true);
    if (['private', 'needs-account', 'error'].includes(record.frame.state)) assert.ok(!record.frame.imageHash);
    if (record.frame.imageHash) {
      const imageResponse = await fetch(`${browserConfig.endpoint}/v1/browser/frames/${record.hash}/image`);
      assert.equal(imageResponse.status, 200);
      assert.equal(imageDigest(Buffer.from(await imageResponse.arrayBuffer())), record.frame.imageHash); imageCount++;
    }
  }
  assert.ok(imageCount >= 1);
  passed.push('The relay stores every signed report and matching public image; account-setup states carry no images');
  passed.push('The exact prepared thesis and actual account-required outcome persist without acknowledging an external post');
  const configFile = path.join(stateDirectory, 'local-social.json');
  const { localTest, deploymentFile: ignored, ...browser } = browserConfig;
  fs.writeFileSync(configFile, JSON.stringify({ deploymentFile, database: { connectionEnvironment: 'HALO_SOCIAL_DATABASE_URL' },
    browser, artifactGateways: ['http://127.0.0.1:8793'], confirmations: 1, leaseSeconds: 30 }, null, 2), { mode: 0o600 });
  fs.writeFileSync(path.join(stateDirectory, 'acceptance-database.json'), JSON.stringify({ url: url.toString() }), { mode: 0o600 });
  fs.writeFileSync(path.join(root, 'test-results/browser-queued.json'), JSON.stringify({ checkedAt: new Date().toISOString(), databaseName, image, agent,
    chainId: deployment.chainId, newTransactionsSubmittedByTest: 0, externalSocialPosts: 0, automaticAccountCreation: false,
    scope: 'Actual PostgreSQL launch intent, Linux container/profile lock, sandboxed Chromium FOMO publication attempt and signed relay; no authenticated account or post',
    jobId: execution.jobId, executionId: execution.executionId, sessionId: journal.sessionId, reportCount: frames.length, imageCount, leaseRenewals: renewals,
    containersCleaned: execution.containersCleaned, reportsDelivered: execution.reportsDelivered, databaseState: row.state,
    browserOutcome: execution.result, prepared: row.prepared_payload, executionDirectory: execution.executionDirectory, frames, passed }, null, 2));
  console.log(`PASS ${passed.length} actual queued-browser checks; ${frames.length} signed reports, ${imageCount} public images, ${renewals} lease renewals`);
} finally { await database.close(); }
