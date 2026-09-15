import fs from 'node:fs';
import path from 'node:path';
import { createPublicClient, createWalletClient, defineChain, http } from 'viem';
import { root } from './compile.mjs';
import { kuboReplica, replicatedArtifacts } from '../sdk/artifacts.mjs';
import { createOperator } from '../runtime/operator.mjs';
import { createTracePublisher } from '../runtime/trace.mjs';
import { loadPublicModel } from '../runtime/inference.mjs';

const deployment = JSON.parse(fs.readFileSync(path.join(root, 'test-results/local-deployment.json')));
const peers = JSON.parse(fs.readFileSync(path.join(root, 'test-results/local-ipfs.json'))).peers;
if (deployment.environment !== 'local' || deployment.chainId !== 31337 || deployment.rpcUrl !== 'http://127.0.0.1:8545') throw new Error('This helper is restricted to the disposable local chain');
const chain = defineChain({ id: 31337, name: 'HALO disposable Anvil', nativeCurrency: { name: 'Test Ether', symbol: 'ETH', decimals: 18 }, rpcUrls: { default: { http: [deployment.rpcUrl] } } });
const client = createPublicClient({ chain, transport: http(deployment.rpcUrl) });
if (await client.getChainId() !== 31337) throw new Error('Local chain mismatch');
// An idle automining development chain has no recent timestamp until its next block.
await client.request({ method: 'evm_mine', params: [] });
const wallet = createWalletClient({ chain, transport: http(deployment.rpcUrl) });
const accounts = await wallet.getAddresses();
const account = accounts[Number(process.env.HALO_LOCAL_OPERATOR_INDEX ?? 4)];
if (!account) throw new Error('Select a disposable local operator account');
const artifacts = Object.fromEntries(fs.readdirSync(path.join(root, 'artifacts')).filter(name => name.endsWith('.json')).map(name => [name.slice(0, -5), JSON.parse(fs.readFileSync(path.join(root, 'artifacts', name)))]));
const directory = path.join(root, 'test-results', `operator-${account.toLowerCase()}`);
// Optional live public model: HALO_INFERENCE_URL is the /v1 base (loopback HTTP or public HTTPS); the bearer key is read from a file, never from the command line.
const publicModels = process.env.HALO_INFERENCE_URL ? [loadPublicModel({ releaseFile: path.join(root, 'models/proposal-qwen35-4b/release.json'), backendUrl: process.env.HALO_INFERENCE_URL,
  authorization: `Bearer ${fs.readFileSync(process.env.HALO_INFERENCE_KEY_FILE ?? path.join(root, 'test-results/inference.key'), 'utf8').trim()}` })] : [];
const operator = createOperator({ client, wallet, account, deployment, artifacts,
  store: replicatedArtifacts({ replicas: peers.map(apiUrl => kuboReplica({ apiUrl })) }),
  python: process.env.HALO_PYTHON ?? path.resolve(root, '../../work/halo-python', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python'),
  directory, localOrigins: ['http://127.0.0.1:8787'], confirmations: 1,
  maxGasCostWei: 10n ** 16n, computeCostWei: 10n ** 10n,
  // Testnet work may be deliberately subsidized. This flag is rejected on every non-local deployment.
  allowLocalLoss: true, publicModels,
  onStep: createTracePublisher({ wallet, account, deployment, endpoint: 'http://127.0.0.1:8791', localOrigins: ['http://127.0.0.1:8791'] }),
});
const requested = process.argv[2];
if (!/^0x[0-9a-fA-F]{40}$/.test(requested ?? '')) throw new Error('Supply the local agent address as the first argument');
const result = await operator.runCycle(requested);
fs.writeFileSync(path.join(root, 'test-results/last-local-operator.json'), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
if (result.status === 'retryable-error') process.exitCode = 1;
