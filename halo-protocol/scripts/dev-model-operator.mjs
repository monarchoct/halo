import fs from 'node:fs';
import path from 'node:path';
import { createPublicClient, createWalletClient, defineChain, http, parseEther } from 'viem';
import { root } from './compile.mjs';
import { kuboReplica, replicatedArtifacts } from '../sdk/artifacts.mjs';
import { loadPublicModel } from '../runtime/inference.mjs';
import { createOperator } from '../runtime/operator.mjs';
import { createTracePublisher } from '../runtime/trace.mjs';
import { randomUUID } from 'node:crypto';
import { openDatabase, verifySchema } from '../services/persistence/database.mjs';
import { createJobStore } from '../services/persistence/store.mjs';
import { createScheduler } from '../runtime/scheduler.mjs';
import { createOutboxDispatcher } from '../runtime/outbox.mjs';
const deployment = JSON.parse(fs.readFileSync(path.join(root, '../halo-web/public/deployment-trading.json')));
if (deployment.environment !== 'local' || deployment.chainId !== 31337 || deployment.rpcUrl !== 'http://127.0.0.1:8547') throw new Error('Disposable model preview only');
const chain = defineChain({ id: 31337, name: deployment.chainName, nativeCurrency: { name: 'Test Ether', symbol: 'ETH', decimals: 18 }, rpcUrls: { default: { http: [deployment.rpcUrl] } } });
const client = createPublicClient({ chain, transport: http(deployment.rpcUrl) }), wallet = createWalletClient({ chain, transport: http(deployment.rpcUrl) });
if (await client.getChainId() !== 31337) throw new Error('Local chain mismatch');
const accounts = await wallet.getAddresses(), account = accounts[Number(process.env.HALO_LOCAL_OPERATOR_INDEX ?? 4)];
const artifacts = Object.fromEntries(fs.readdirSync(path.join(root, 'artifacts')).filter(name => name.endsWith('.json')).map(name => [name.slice(0, -5), JSON.parse(fs.readFileSync(path.join(root, 'artifacts', name)))]));
const key = fs.readFileSync(path.resolve(root, '../../work/inference-assets/local-inference-key.txt'), 'utf8').trim();
const model = loadPublicModel({ releaseFile: path.join(root, 'models/proposal-qwen35-4b/release.json'), backendUrl: 'http://127.0.0.1:8080/v1', authorization: `Bearer ${key}` });
const peers = JSON.parse(fs.readFileSync(path.join(root, 'test-results/local-ipfs.json'))).peers;
const store = replicatedArtifacts({ replicas: peers.map(apiUrl => kuboReplica({ apiUrl })) });
const agent = process.argv[2];
if (!/^0x[0-9a-fA-F]{40}$/.test(agent ?? '')) throw new Error('Supply the local agent address');
const operator = createOperator({ client, wallet, account, deployment, artifacts, store,
  publicModels: [model], python: process.env.HALO_PYTHON ?? path.resolve(root, '../../work/halo-python/Scripts/python.exe'),
  directory: path.join(root, 'test-results', `model-operator-${account.toLowerCase()}`), confirmations: 1,
  maxGasCostWei: parseEther('0.005'), computeCostWei: parseEther('0.00005'), minimumMarginWei: parseEther('0.00001'),
  onStep: createTracePublisher({ wallet, account, deployment, endpoint: deployment.transparencyApiUrl, localOrigins: [deployment.transparencyApiUrl] }),
});
const watch = process.argv.includes('--watch');
if (!process.env.HALO_TEST_DATABASE_URL) throw new Error('Supply the migrated local PostgreSQL connection as HALO_TEST_DATABASE_URL; direct unqueued execution is disabled');
const database = openDatabase({ url: process.env.HALO_TEST_DATABASE_URL, local: true });
let jobStore;
try { await verifySchema(database); jobStore = await createJobStore({ database, deployment }); }
catch (error) { await database.close(); throw error; }
const scheduler = createScheduler({ client, deployment, artifacts, operator, store: jobStore,
  workerId: `local-model:${account.toLowerCase()}:${randomUUID()}`, confirmations: 1, leaseSeconds: 180 });
const publications = createOutboxDispatcher({ store: jobStore, workerId: `local-receipts:${randomUUID()}`,
  handlers: { 'operator-receipt': payload => store.put(payload) } });
const abort = new AbortController();
process.once('SIGINT', () => abort.abort()); process.once('SIGTERM', () => abort.abort());
let previousStatus;
console.log(JSON.stringify({ service: 'halo-model-scheduler', agent, chainId: deployment.chainId, database: 'persistent-postgresql', socialPublication: false }));
try { do {
  // The disposable chain mines only when asked; advance its wall clock without bypassing agent policy.
  await client.request({ method: 'evm_mine', params: [] });
  const nonce = await client.readContract({ address: agent, abi: artifacts.AgentVault.abi, functionName: 'nonce' });
  await jobStore.enqueue({ agent, nonce, payload: { version: 'halo.agent-cycle.v1', nonce: nonce.toString() } });
  const result = await scheduler.workOnce({ agent });
  fs.writeFileSync(path.join(root, 'test-results', `model-cycle-${agent.toLowerCase()}-${result.nonce ?? 'attempt'}.json`), JSON.stringify(result, null, 2));
  if (result.status !== previousStatus || result.status === 'confirmed') console.log(JSON.stringify(result, null, 2));
  previousStatus = result.status;
  for (let index = 0; index < 20 && !abort.signal.aborted; index++) {
    const publication = await publications.deliverOnce('operator-receipt');
    if (publication.status === 'idle') break;
    console.log(JSON.stringify({ service: 'halo-receipt-outbox', ...publication }));
    if (publication.status !== 'delivered') break;
  }
  if (!watch) { if (result.status === 'retryable-error') process.exitCode = 1; break; }
  await new Promise(resolve => {
    function done() { clearTimeout(timer); abort.signal.removeEventListener('abort', done); resolve(); }
    const timer = setTimeout(done, 30000); abort.signal.addEventListener('abort', done, { once: true }); if (abort.signal.aborted) done();
  });
} while (!abort.signal.aborted); } finally { await database.close(); }
