import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { createPublicClient, createWalletClient, http } from 'viem';
import { root } from '../scripts/compile.mjs';
import { openDatabase, migrate } from '../services/persistence/database.mjs';
import { createJobStore } from '../services/persistence/store.mjs';
import { createScheduler } from '../runtime/scheduler.mjs';
import { createOperator } from '../runtime/operator.mjs';
import { createOutboxDispatcher } from '../runtime/outbox.mjs';
import { kuboReplica, replicatedArtifacts } from '../sdk/artifacts.mjs';

const config = JSON.parse(fs.readFileSync(path.resolve(root, '../../work/postgres-private/connection.json')));
const deployment = JSON.parse(fs.readFileSync(path.join(root, 'test-results/local-deployment.json')));
assert.equal(deployment.environment, 'local'); assert.equal(deployment.rpcUrl, 'http://127.0.0.1:8545');
const agent = JSON.parse(fs.readFileSync(path.join(root, 'test-results/last-local-operator.json'))).agent;
const artifacts = Object.fromEntries(fs.readdirSync(path.join(root, 'artifacts')).filter(name => name.endsWith('.json')).map(name => [name.slice(0,-5),JSON.parse(fs.readFileSync(path.join(root, 'artifacts',name)))]));
const client = createPublicClient({ transport: http(deployment.rpcUrl) });
const before = await client.getBlockNumber();
const nonce = await client.readContract({ address: agent, abi: artifacts.AgentVault.abi, functionName: 'nonce' }); assert.ok(nonce >= 2n);
const databaseName = `halo_scheduler_test_${randomBytes(6).toString('hex')}`;
assert.match(databaseName, /^halo_scheduler_test_[a-f0-9]{12}$/);
const adminUrl = new URL(config.url); adminUrl.pathname = '/postgres';
const admin = openDatabase({ ...config, url: adminUrl.toString() });
try { await admin.pool.query(`CREATE DATABASE "${databaseName}"`); } finally { await admin.close(); }
const url = new URL(config.url); url.pathname = `/${databaseName}`;
const database = openDatabase({ ...config, url: url.toString() });
const passed = [];
let publications = [];
try {
  await migrate(database);
  const store = await createJobStore({ database, deployment });
  for (const n of [0n,1n]) await store.enqueue({ agent, nonce: n, payload: { version: 'halo.agent-cycle.v1', nonce: n.toString() } });
  let executions = 0;
  const mustNotExecute = { async runCycle() { executions++; throw new Error('An old nonce must be reconciled, not executed again'); } };
  const a = createScheduler({ client, deployment, artifacts, operator: mustNotExecute, store, workerId: 'recovery-a', confirmations: 1 });
  const b = createScheduler({ client, deployment, artifacts, operator: mustNotExecute, store, workerId: 'recovery-b', confirmations: 1 });
  const recovered = await Promise.all([a.workOnce(),b.workOnce()]);
  assert.equal(executions, 0); assert.ok(recovered.every(r => r.status === 'confirmed' && r.recovered));
  assert.deepEqual(recovered.map(r => r.nonce).sort(), ['0','1']);
  assert.equal(await client.getBlockNumber(), before);
  passed.push('Two scheduler workers recover actual prior agent receipts without running another action or mining a block');
  const wallet = createWalletClient({ transport: http(deployment.rpcUrl) });
  const operator = createOperator({ client, wallet, account: deployment.demoOperator, deployment, artifacts,
    store: {}, python: 'must-not-run', directory: path.join(root,'test-results/unused-nonce-guard'), maxGasCostWei: 10n**16n });
  const stale = await operator.runCycle(agent, { expectedNonce: 0n });
  assert.equal(stale.status, 'superseded'); assert.equal(stale.nonce, nonce.toString());
  passed.push('The real operator rejects a stale scheduled nonce before research, inference or transaction submission');
  const peers = JSON.parse(fs.readFileSync(path.join(root, 'test-results/local-ipfs.json'))).peers;
  const content = replicatedArtifacts({ replicas: peers.map(apiUrl => kuboReplica({ apiUrl })) });
  const dispatcher = createOutboxDispatcher({ store, workerId: 'receipt-publisher', handlers: { 'operator-receipt': payload => content.put(payload) } });
  publications = [await dispatcher.deliverOnce('operator-receipt'), await dispatcher.deliverOnce('operator-receipt')];
  assert.ok(publications.every(p => p.status === 'delivered' && p.result.replicas.length === 3));
  for (const publication of publications) {
    const receipt = JSON.parse(await content.get(publication.result.uri));
    const matching = recovered.find(r => r.nonce === receipt.nonce);
    assert.equal(receipt.transactionHash, matching.transactionHash); assert.equal(receipt.workReward, matching.workReward);
  }
  assert.equal((await dispatcher.deliverOnce('operator-receipt')).status, 'idle');
  passed.push('Recovered receipts leave the transactional outbox only after verified pin/retrieval on three local IPFS peers');
  const history = await store.recentJobs(agent);
  assert.equal(history.length,2); assert.ok(history.every(row => row.state === 'completed'));
  assert.equal((await a.workOnce()).status, 'idle');
  passed.push('Completed jobs remain completed and preserve public gas/reward evidence for each nonce');
  fs.writeFileSync(path.join(root, 'test-results/scheduler-recovery.json'), JSON.stringify({ checkedAt: new Date().toISOString(), databaseName, agent,
    chainId: deployment.chainId, observedBlock: before.toString(), newTransactions: 0, socialPosts: 0,
    scope: 'Real PostgreSQL leases, existing Anvil action receipts and three offline local IPFS peers; no hosted model or new action execution',
    recovered, publications: publications.map(p=>({id:p.id,uri:p.result.uri,replicas:p.result.replicas.length})), passed },null,2));
  console.log(`PASS ${passed.length} scheduler recovery and receipt publication scenarios`);
} finally { await database.close(); }
