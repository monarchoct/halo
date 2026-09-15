#!/usr/bin/env node
/**
 * Create, fund and activate an agent from the command line, exactly as the website does:
 * publish the manifest through the artifact service (pinned on IPFS), createAgent on chain, buy the initial
 * trading inventory on the agent's curve, transfer the 30-day operating reserve, then activate.
 *
 *   HALO_CREATOR_KEY=0x... node scripts/create-agent.mjs <deployment.json> --name "Vega" --symbol VEGA \
 *     [--mode public-baseline|public-model|custom-api] [--endpoint https://…] [--description "…"] \
 *     [--initial-buy 1000] [--reward 0.000001] [--interval 15] [--launches 1] [--target 1000000] [--child-target 1000000]
 *
 * Local rehearsal: the dev stack's creator account key is Anvil account #1. Public networks: a funded creator wallet.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createPublicClient, createWalletClient, decodeEventLog, defineChain, http, keccak256, parseEther, toHex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { root } from './compile.mjs';
import { canonicalJson } from '../sdk/manifest.mjs';
import { gasWithHeadroom } from '../sdk/transaction-gas.mjs';
import { assertSupportedDeployment } from '../sdk/networks.mjs';

const arg = (name, fallback) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : fallback; };
const deploymentFile = process.argv[2];
if (!deploymentFile || !arg('name') || !arg('symbol')) throw new Error('Usage: HALO_CREATOR_KEY=0x... node scripts/create-agent.mjs <deployment.json> --name NAME --symbol SYM [options]');
const deployment = JSON.parse(fs.readFileSync(path.resolve(deploymentFile), 'utf8'));
assertSupportedDeployment(deployment);
const key = process.env.HALO_CREATOR_KEY;
if (!/^0x[0-9a-fA-F]{64}$/.test(key ?? '')) throw new Error('HALO_CREATOR_KEY must be a 32-byte hex private key in the environment');
const account = privateKeyToAccount(key);
const chain = defineChain({ id: deployment.chainId, name: deployment.chainName, nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 }, rpcUrls: { default: { http: [deployment.rpcUrl] } } });
const client = createPublicClient({ chain, transport: http(deployment.rpcUrl) }), wallet = createWalletClient({ chain, account, transport: http(deployment.rpcUrl) });
if (await client.getChainId() !== deployment.chainId) throw new Error('RPC chain differs from the deployment');
const artifacts = Object.fromEntries(['AgentRegistry', 'AgentVault', 'HaloToken', 'HaloCurve'].map(n => [n, JSON.parse(fs.readFileSync(path.join(root, `artifacts/${n}.json`)))]));
const read = (address, name, functionName, args = []) => client.readContract({ address, abi: artifacts[name].abi, functionName, args });
async function send(address, name, functionName, args, label) {
  const { request } = await client.simulateContract({ address, abi: artifacts[name].abi, functionName, args, account });
  const hash = await wallet.writeContract({ ...request, gas: gasWithHeadroom(await client.estimateContractGas(request)) });
  const receipt = await client.waitForTransactionReceipt({ hash, confirmations: deployment.environment === 'local' ? 1 : 2 });
  if (receipt.status !== 'success') throw new Error(`${label} reverted: ${hash}`);
  console.log(`  ${label} · ${hash}`); return receipt;
}

const mode = arg('mode', 'public-baseline');
const policy = { maxPositionBps: 1000, maxDailyDebitBps: 1000, maxLaunchesPerDay: Number(arg('launches', 1)), maxSlippageBps: 300,
  intervalSeconds: Number(arg('interval', 15)) * 60, workReward: parseEther(arg('reward', deployment.environment === 'local' ? '0.000001' : '0.00005')).toString(), childGraduationTarget: parseEther(arg('child-target', '1000000')).toString() };
const fees = { tradingBps: 100, operationsBps: 6000, haloBps: 2000, creator: account.address };
const models = { mode, core: 'halo-core-v1', releaseSha256: deployment.coreReleaseSha256, proposalEndpoint: mode === 'custom-api' ? arg('endpoint', '') : '',
  ...(mode === 'public-model' ? { proposalReleaseSha256: fs.readFileSync(path.join(root, 'models/proposal-qwen35-4b/release.sha256'), 'utf8').trim() } : {}),
  reproducibility: mode === 'custom-api' ? 'external-provider' : mode === 'public-model' ? 'public-weights' : 'public-rules' };
const manifest = { version: 'halo.agent.v1', chainId: deployment.chainId, identity: { name: arg('name'), symbol: arg('symbol'), description: arg('description', 'Autonomous narrative scout. Public rules baseline; local test assets.') },
  models, policy, fees, graduationTarget: parseEther(arg('target', '1000000')).toString() };

console.log(`Creating ${manifest.identity.name} ($${manifest.identity.symbol}) on chain ${deployment.chainId} as ${account.address}`);
const artifactApi = deployment.artifactApiUrl || deployment.apiUrl;
const response = await fetch(`${artifactApi}/v1/manifests`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(manifest) });
const publication = await response.json();
if (!response.ok) throw new Error(`Manifest publication failed: ${publication.error ?? response.status}`);
if (publication.hash !== keccak256(toHex(canonicalJson(manifest)))) throw new Error('Published manifest hash differs from the local canonical hash');
console.log(`  manifest ${publication.uri} · ${publication.hash}`);

const created = await send(deployment.registry, 'AgentRegistry', 'createAgent', [manifest.identity.name, manifest.identity.symbol, publication.hash, publication.uri, BigInt(manifest.graduationTarget),
  { ...policy, workReward: BigInt(policy.workReward), childGraduationTarget: BigInt(policy.childGraduationTarget) }, { ...fees, operations: account.address }], 'createAgent');
const event = created.logs.map(log => { try { return decodeEventLog({ abi: artifacts.AgentRegistry.abi, ...log }); } catch { return null; } }).find(log => log?.eventName === 'AgentCreated');
const { agent, token, curve } = event.args;
console.log(`  agent ${agent} · token ${token} · curve ${curve}`);

const initialBuy = parseEther(arg('initial-buy', '1000'));
const quote = await read(curve, 'HaloCurve', 'quoteBuy', [initialBuy]);
await send(deployment.rootHalo, 'HaloToken', 'approve', [curve, initialBuy], 'approve HALO');
await send(curve, 'HaloCurve', 'buy', [initialBuy, quote[0] * 99n / 100n, agent, (await client.getBlock()).timestamp + 600n], 'buy trading inventory');
const required = await read(agent, 'AgentVault', 'reserveRequired', [30n]);
await send(deployment.operatingToken, 'HaloToken', 'transfer', [agent, required], `transfer 30-day reserve (${required} wei)`);
await send(agent, 'AgentVault', 'activate', [], 'activate');
const result = { agent, token, curve, creator: account.address, manifestHash: publication.hash, manifestURI: publication.uri, chainId: deployment.chainId, createdAt: new Date().toISOString() };
fs.mkdirSync(path.join(root, 'test-results'), { recursive: true });
fs.writeFileSync(path.join(root, 'test-results/last-created-agent.json'), JSON.stringify(result, null, 2) + '\n');
console.log(`Activated. ${JSON.stringify(result)}`);
