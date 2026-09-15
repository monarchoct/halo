import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPublicClient, createWalletClient, defineChain, http, isAddress } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { z } from 'zod';
import { createOperator } from './operator.mjs';
import { createSettlementWorker } from './settlement-worker.mjs';
import { createTracePublisher } from './trace.mjs';
import { createScheduler } from './scheduler.mjs';
import { createOutboxDispatcher } from './outbox.mjs';
import { openDatabase, verifySchema } from '../services/persistence/database.mjs';
import { createJobStore } from '../services/persistence/store.mjs';
import { randomUUID } from 'node:crypto';
import { assertSupportedDeployment } from '../sdk/networks.mjs';
import { kuboReplica, replicatedArtifacts } from '../sdk/artifacts.mjs';
import { loadPublicModel } from './inference.mjs';

const configPath = path.resolve(process.argv[2] ?? '');
if (!process.argv[2]) throw new Error('Usage: node runtime/cli.mjs operator.json [--execute] [--once]');
const execute = process.argv.includes('--execute');
const config = z.object({ deploymentFile: z.string(), python: z.string(), directory: z.string(),
  operatorAddress: z.string().refine(isAddress), operatorKeyFile: z.string().optional(),
  ipfsPeers: z.array(z.object({ apiUrl: z.string().url(), authorizationEnvironment: z.string().regex(/^[A-Z][A-Z0-9_]*$/).optional() }).strict()).min(3).max(8),
  confirmations: z.number().int().min(2).max(128).default(4),
  computeCostWei: z.string().regex(/^[0-9]+$/), minimumMarginWei: z.string().regex(/^[0-9]+$/),
  maxGasCostWei: z.string().regex(/^[1-9][0-9]+$/), scanIntervalSeconds: z.number().int().min(10).max(60).default(30),
  transparencyEndpoint: z.string().url().optional(),
  database: z.object({ connectionEnvironment: z.string().regex(/^[A-Z][A-Z0-9_]*$/), caFile: z.string().optional() }).strict(),
  leaseSeconds: z.number().int().min(30).max(600).default(180),
  settleFees: z.boolean().default(true),
  publicModels: z.array(z.object({ releaseFile: z.string(), backendUrl: z.string().url(),
    authorizationEnvironment: z.string().regex(/^[A-Z][A-Z0-9_]*$/).optional() }).strict()).max(8).default([]),
}).strict().parse(JSON.parse(fs.readFileSync(configPath)));
const resolve = value => path.resolve(path.dirname(configPath), value);
const deployment = JSON.parse(fs.readFileSync(resolve(config.deploymentFile)));
assertSupportedDeployment(deployment);
if (deployment.environment === 'local') throw new Error('Use the explicit disposable development helpers for local Anvil');
const chain = defineChain({ id: deployment.chainId, name: deployment.chainName, testnet: deployment.environment === 'testnet',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 }, rpcUrls: { default: { http: [deployment.rpcUrl] } } });
let account = config.operatorAddress;
if (execute) {
  if (!config.operatorKeyFile) throw new Error('An operator-owned gas key file is required for execution');
  const raw = fs.readFileSync(resolve(config.operatorKeyFile), 'utf8').trim();
  if (!/^0x[0-9a-fA-F]{64}$/.test(raw)) throw new Error('Invalid operator key file');
  account = privateKeyToAccount(raw);
  if (account.address.toLowerCase() !== config.operatorAddress.toLowerCase()) throw new Error('Key file does not match the configured gas-paying operator');
}
const client = createPublicClient({ chain, transport: http(deployment.rpcUrl, { timeout: 15000, retryCount: 2 }) });
const wallet = createWalletClient({ chain, account, transport: http(deployment.rpcUrl, { timeout: 15000, retryCount: 0 }) });
if (await client.getChainId() !== deployment.chainId) throw new Error('RPC chain differs from deployment configuration');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const artifacts = Object.fromEntries(fs.readdirSync(path.join(root, 'artifacts')).filter(name => name.endsWith('.json')).map(name => [name.slice(0, -5), JSON.parse(fs.readFileSync(path.join(root, 'artifacts', name)))]));
const store = replicatedArtifacts({ replicas: config.ipfsPeers.map(peer => {
  const authorization = peer.authorizationEnvironment ? process.env[peer.authorizationEnvironment] : undefined;
  if (peer.authorizationEnvironment && !authorization) throw new Error('Configured IPFS authorization is unavailable');
  return kuboReplica({ apiUrl: peer.apiUrl, authorization });
}) });
const databaseUrl = process.env[config.database.connectionEnvironment];
if (!databaseUrl) throw new Error('Configured PostgreSQL connection is unavailable');
const database = openDatabase({ url: databaseUrl, ...(config.database.caFile ? { ca: fs.readFileSync(resolve(config.database.caFile),'utf8') } : {}) });
let jobStore;
try { await verifySchema(database); jobStore = await createJobStore({ database, deployment }); }
catch (error) { await database.close(); throw error; }
const operator = createOperator({ client, wallet, account, deployment, artifacts, store,
  python: path.isAbsolute(config.python) ? config.python : resolve(config.python), directory: resolve(config.directory),
  confirmations: config.confirmations, computeCostWei: BigInt(config.computeCostWei), minimumMarginWei: BigInt(config.minimumMarginWei),
  maxGasCostWei: BigInt(config.maxGasCostWei), submitTransactions: execute,
  publicModels: config.publicModels.map(binding => {
    const authorization = binding.authorizationEnvironment ? process.env[binding.authorizationEnvironment] : undefined;
    if (binding.authorizationEnvironment && !authorization) throw new Error('Inference authorization is unavailable');
    return loadPublicModel({ releaseFile: resolve(binding.releaseFile), backendUrl: binding.backendUrl, authorization });
  }),
  ...(execute && config.transparencyEndpoint ? { onStep: createTracePublisher({ wallet, account, deployment, endpoint: config.transparencyEndpoint }) } : {}),
});
const scheduler = createScheduler({ client, deployment, artifacts, operator, store: jobStore,
  workerId: `${config.operatorAddress.toLowerCase()}:${randomUUID()}`, confirmations: config.confirmations, leaseSeconds: config.leaseSeconds });
const settlement = createSettlementWorker({ client, wallet, account, deployment, artifacts,
  maxGasCostWei: config.maxGasCostWei, minimumMarginWei: config.minimumMarginWei,
  confirmations: config.confirmations, submitTransactions: execute });
const publications = createOutboxDispatcher({ store: jobStore, workerId: `publication:${randomUUID()}`,
  handlers: { 'operator-receipt': payload => store.put(payload) } });
const abort = new AbortController();
process.once('SIGINT', () => abort.abort()); process.once('SIGTERM', () => abort.abort());
let offset = 0;
let settlementOffset = 0;
console.log(JSON.stringify({ service: 'halo-operator', chainId: deployment.chainId, operator: config.operatorAddress, mode: execute ? 'execute' : 'dry-run' }));
try { while (!abort.signal.aborted) {
  if (config.settleFees) {
    try {
      const round = await settlement.runRound({ offset: settlementOffset, limit: 2 });
      settlementOffset = round.nextOffset;
      console.log(JSON.stringify({ service: 'halo-fee-settlement', ...round }));
    } catch { console.log(JSON.stringify({ status: 'settlement-dependency-unavailable', retry: true })); }
  }
  try {
    if (execute) {
      const round = await scheduler.scan({ offset, limit: 20 }); offset = round.nextOffset;
      console.log(JSON.stringify({ service: 'halo-scheduler', ...round }));
      for (let count = 0; count < 20 && !abort.signal.aborted; count++) {
        const result = await scheduler.workOnce(); if (result.status === 'idle') break; console.log(JSON.stringify(result));
      }
    } else { const round = await operator.runRound({ offset, limit: 20 }); offset = round.nextOffset; console.log(JSON.stringify(round)); }
  }
  catch { console.log(JSON.stringify({ status: 'operator-dependency-unavailable', retry: true })); }
  if (execute) {
    try { for (let count = 0; count < 20 && !abort.signal.aborted; count++) {
      const result = await publications.deliverOnce('operator-receipt'); if (result.status === 'idle') break;
      console.log(JSON.stringify({ service: 'halo-outbox', ...result })); if (result.status !== 'delivered') break;
    } } catch { console.log(JSON.stringify({ status: 'publication-dependency-unavailable', retry: true })); }
  }
  if (process.argv.includes('--once')) break;
  await new Promise(resolve => {
    const timer = setTimeout(done, config.scanIntervalSeconds * 1000);
    function done() { clearTimeout(timer); abort.signal.removeEventListener('abort', done); resolve(); }
    abort.signal.addEventListener('abort', done, { once: true }); if (abort.signal.aborted) done();
  });
} } finally { await database.close(); }
