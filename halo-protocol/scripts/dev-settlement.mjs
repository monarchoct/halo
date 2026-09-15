import fs from 'node:fs';
import path from 'node:path';
import { createPublicClient, createWalletClient, defineChain, encodeAbiParameters, http, keccak256, parseEther } from 'viem';
import { root } from './compile.mjs';
import { createSettlementWorker } from '../runtime/settlement-worker.mjs';
import { gasWithHeadroom } from '../sdk/transaction-gas.mjs';

// This companion connects only to the isolated settlement preview, never the original Cedar chain or a public RPC.
const deployment = JSON.parse(fs.readFileSync(path.join(root, 'test-results/settlement-deployment.json')));
if (deployment.environment !== 'local' || deployment.chainId !== 31337 || deployment.rpcUrl !== 'http://127.0.0.1:8546')
  throw new Error('This helper only operates on the disposable settlement preview at 127.0.0.1:8546');
const chain = defineChain({ id: 31337, name: 'HALO settlement preview', nativeCurrency: { name: 'Test Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: [deployment.rpcUrl] } } });
const client = createPublicClient({ chain, transport: http(deployment.rpcUrl, { retryCount: 0 }), pollingInterval: 50 });
const wallet = createWalletClient({ chain, transport: http(deployment.rpcUrl, { retryCount: 0 }) });
if (await client.getChainId() !== 31337) throw new Error('Wrong preview chain');
const account = (await wallet.getAddresses())[5];
const artifacts = Object.fromEntries(fs.readdirSync(path.join(root, 'artifacts')).filter(name => name.endsWith('.json'))
  .map(name => [name.slice(0, -5), JSON.parse(fs.readFileSync(path.join(root, 'artifacts', name)))]));
const read = (address, name, functionName, args = []) => client.readContract({ address, abi: artifacts[name].abi, functionName, args });
async function send(address, name, functionName, args = []) {
  const { request } = await client.simulateContract({ address, abi: artifacts[name].abi, functionName, args, account });
  const hash = await wallet.writeContract({ ...request, gas: gasWithHeadroom(await client.estimateContractGas(request)) });
  if ((await client.waitForTransactionReceipt({ hash })).status !== 'success') throw new Error('Local checkpoint failed');
}
if (process.argv.includes('--warmup')) {
  const key = await read(deployment.rootReferenceMarket, 'RootReferenceMarket', 'marketKey');
  const poolId = keccak256(encodeAbiParameters([{ type: 'address' }, { type: 'address' }, { type: 'uint24' }, { type: 'int24' }, { type: 'address' }],
    [key.currency0, key.currency1, key.fee, key.tickSpacing, key.hooks]));
  await send(key.hooks, 'HaloPoolHook', 'checkpoint', [poolId]);
  const count = Number(await read(deployment.registry, 'AgentRegistry', 'agentCount'));
  for (let i = 0; i < Math.min(count, 20); i++) {
    const agent = await read(deployment.registry, 'AgentRegistry', 'agents', [BigInt(i)]);
    const token = await read(agent, 'AgentVault', 'agentToken');
    const curve = await read(deployment.curveFactory, 'CurveFactory', 'curveOf', [token]);
    if (!(await read(curve, 'HaloCurve', 'graduated'))) await send(curve, 'HaloCurve', 'checkpoint');
  }
  await client.request({ method: 'evm_increaseTime', params: [1801] });
  await client.request({ method: 'evm_mine', params: [] });
  console.log('Disposable preview only: advanced 1801 seconds after real curve/reference checkpoints. No public-chain time was changed.');
}
const worker = createSettlementWorker({ client, wallet, account, deployment, artifacts, maxGasCostWei: parseEther('0.1'),
  confirmations: 1, minimumMarginWei: 0n, submitTransactions: true });
const result = await worker.runRound({ limit: 20 });
fs.writeFileSync(path.join(root, 'test-results/settlement-preview-worker.json'), JSON.stringify({ checkedAt: new Date().toISOString(), ...result }, null, 2) + '\n');
console.log(JSON.stringify(result));
