#!/usr/bin/env node
/**
 * Deploy the HALO contract graph to a public Robinhood Chain network (or a local chain for rehearsal).
 *
 *   HALO_DEPLOYER_KEY=0x... node scripts/deploy-public.mjs deploy/testnet/config.json [--dry-run]
 *
 * The config carries only public facts (chain, RPC, token and PoolManager addresses, fee parameters, recipients).
 * The deployer key comes from the environment and is never written anywhere. The sequence mirrors the local dev
 * stack exactly, so what passed locally is what gets deployed: graduation adapter with a mined hook salt, curve
 * factory, pinned Halo2 verifier, decision verifier, root reference market, fee settlement router, agent registry,
 * native ETH buy router. Output is a website-shaped deployment.json plus a report with every transaction hash.
 */
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { createPublicClient, createWalletClient, defineChain, getContractAddress, http, keccak256 } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { root } from './compile.mjs';
import { mineHookSalt } from '../sdk/hook-salt.mjs';
import { gasWithHeadroom } from '../sdk/transaction-gas.mjs';
import { assertSupportedDeployment } from '../sdk/networks.mjs';

const address = z.string().regex(/^0x[0-9a-fA-F]{40}$/);
const configSchema = z.object({
  environment: z.enum(['local', 'testnet', 'mainnet']), chainId: z.number().int().positive(), chainName: z.string().min(1),
  rpcUrl: z.string().url(), explorerUrl: z.string().url().optional(),
  rootHalo: address, operatingToken: address, poolManager: address,
  poolManagerCodeHash: z.string().regex(/^0x[0-9a-f]{64}$/).optional(),
  protocolFeeRecipient: address, referenceFee: z.number().int().min(1).max(20000).default(3000),
  referenceSqrtPriceX96: z.string().regex(/^[0-9]+$/).optional(), minimumDepthWei: z.string().regex(/^[0-9]+$/),
  operatingSymbol: z.string().min(1).max(12), haloSymbol: z.string().min(1).max(12),
  apiUrl: z.string().url(), historyApiUrl: z.string().url().optional(), operationsApiUrl: z.string().url().optional(),
  artifactApiUrl: z.string().url().optional(), transparencyApiUrl: z.string().url().optional(), browserApiUrl: z.string().url().optional(),
  social: z.object({ xClientId: z.string().min(1), xRedirectUri: z.string().url() }).optional(),
}).strict();

const file = path.resolve(process.argv[2] ?? ''), dryRun = process.argv.includes('--dry-run');
if (!process.argv[2]) throw new Error('Usage: HALO_DEPLOYER_KEY=0x... node scripts/deploy-public.mjs <config.json> [--dry-run]');
const config = configSchema.parse(JSON.parse(fs.readFileSync(file, 'utf8')));
const key = process.env.HALO_DEPLOYER_KEY;
if (!/^0x[0-9a-fA-F]{64}$/.test(key ?? '')) throw new Error('HALO_DEPLOYER_KEY must be a 32-byte hex private key in the environment');
const account = privateKeyToAccount(key);
const chain = defineChain({ id: config.chainId, name: config.chainName, nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 }, rpcUrls: { default: { http: [config.rpcUrl] } } });
const client = createPublicClient({ chain, transport: http(config.rpcUrl, { timeout: 30000 }) });
const wallet = createWalletClient({ chain, account, transport: http(config.rpcUrl, { timeout: 30000 }) });
const artifacts = Object.fromEntries(fs.readdirSync(path.join(root, 'artifacts')).filter(n => n.endsWith('.json')).map(n => [n.slice(0, -5), JSON.parse(fs.readFileSync(path.join(root, 'artifacts', n)))]));
const releaseSha256 = fs.readFileSync(path.join(root, 'models/core-v1/release/manifest.sha256'), 'utf8').trim();
const report = { checkedAt: new Date().toISOString(), environment: config.environment, chainId: config.chainId, deployer: account.address, dryRun, checks: [], transactions: [] };
const log = message => console.log(message);

// --- Pre-flight: the chain, the PoolManager and the tokens must be what the config says they are.
if (await client.getChainId() !== config.chainId) throw new Error('RPC chain id differs from the configuration');
assertSupportedDeployment({ environment: config.environment, chainId: config.chainId, rpcUrl: config.rpcUrl });
const managerCode = await client.getCode({ address: config.poolManager });
if (!managerCode || managerCode === '0x') throw new Error('No code at the configured PoolManager');
const managerHash = keccak256(managerCode);
if (config.poolManagerCodeHash && managerHash !== config.poolManagerCodeHash) throw new Error(`PoolManager code hash ${managerHash} differs from the reviewed ${config.poolManagerCodeHash}`);
report.checks.push({ poolManager: config.poolManager, codeHash: managerHash, reviewed: !!config.poolManagerCodeHash });
for (const [name, token] of [['rootHalo', config.rootHalo], ['operatingToken', config.operatingToken]]) {
  const code = await client.getCode({ address: token });
  if (!code || code === '0x') throw new Error(`No code at ${name} ${token}`);
  report.checks.push({ [name]: token, codeHash: keccak256(code) });
}
const balance = await client.getBalance({ address: account.address });
log(`Deployer ${account.address} · balance ${Number(balance) / 1e18} ETH · chain ${config.chainId} (${config.environment})`);

async function deploy(name, args = []) {
  const data = { abi: artifacts[name].abi, bytecode: artifacts[name].bytecode, args, account };
  if (dryRun) { const gas = await client.estimateContractGas({ ...data, address: undefined }).catch(() => null); log(`  would deploy ${name}${gas ? ` (~${gas} gas)` : ''}`); return `0x${'0'.repeat(39)}1`; }
  const hash = await wallet.deployContract(data);
  const receipt = await client.waitForTransactionReceipt({ hash, confirmations: config.environment === 'local' ? 1 : 2 });
  if (receipt.status !== 'success') throw new Error(`${name} deployment reverted: ${hash}`);
  report.transactions.push({ name, hash, address: receipt.contractAddress, gasUsed: String(receipt.gasUsed) });
  log(`  ${name} → ${receipt.contractAddress}`);
  return receipt.contractAddress;
}
async function send(target, name, functionName, args) {
  const { request } = await client.simulateContract({ address: target, abi: artifacts[name].abi, functionName, args, account });
  if (dryRun) { log(`  would call ${name}.${functionName}`); return; }
  const hash = await wallet.writeContract({ ...request, gas: gasWithHeadroom(await client.estimateContractGas(request)) });
  const receipt = await client.waitForTransactionReceipt({ hash, confirmations: config.environment === 'local' ? 1 : 2 });
  if (receipt.status !== 'success') throw new Error(`${name}.${functionName} reverted: ${hash}`);
  report.transactions.push({ name: `${name}.${functionName}`, hash, gasUsed: String(receipt.gasUsed) });
}
const read = (target, name, functionName, args = []) => client.readContract({ address: target, abi: artifacts[name].abi, functionName, args });

// --- Deployment, in the same order the local stack uses.
log('Deploying the HALO contract graph…');
const nonce = BigInt(await client.getTransactionCount({ address: account.address, blockTag: 'pending' }));
const expectedAdapter = getContractAddress({ from: account.address, nonce }), expectedFactory = getContractAddress({ from: account.address, nonce: nonce + 1n });
const hookSalt = mineHookSalt({ adapter: expectedAdapter, manager: config.poolManager, hookBytecode: artifacts.HaloPoolHook.bytecode });
const adapter = await deploy('V4GraduationAdapter', [config.poolManager, expectedFactory, hookSalt.salt]);
const factory = await deploy('CurveFactory', [config.rootHalo, config.protocolFeeRecipient, adapter]);
if (!dryRun && factory.toLowerCase() !== expectedFactory.toLowerCase()) throw new Error('Curve factory landed at an unexpected address; the adapter binding is wrong');
const halo2 = await deploy('Halo2Verifier');
const verifier = await deploy('EzklDecisionVerifier', [halo2]);
if (!dryRun && keccak256(await client.getCode({ address: halo2 })) !== artifacts.Halo2Verifier.runtimeCodeHash) throw new Error('Deployed verifier code hash differs from the pinned artifact');
const referenceNonce = BigInt(await client.getTransactionCount({ address: account.address, blockTag: 'pending' }));
const expectedReference = getContractAddress({ from: account.address, nonce: referenceNonce });
const referenceSalt = mineHookSalt({ adapter: expectedReference, manager: config.poolManager, hookBytecode: artifacts.HaloPoolHook.bytecode });
const reference = await deploy('RootReferenceMarket', [config.poolManager, config.rootHalo, config.operatingToken, config.referenceFee, account.address, referenceSalt.salt]);
if (config.referenceSqrtPriceX96) await send(reference, 'RootReferenceMarket', 'initialize', [BigInt(config.referenceSqrtPriceX96)]);
else log('  reference market left uninitialised: supply referenceSqrtPriceX96 once the real HALO/operating price is known');
const settlement = await deploy('FeeSettlementRouter', [factory, config.operatingToken, reference, BigInt(config.minimumDepthWei)]);
const registry = await deploy('AgentRegistry', [factory, config.operatingToken, verifier, settlement]);
const nativeBuyRouter = await deploy('NativeBuyRouter', [factory, reference, config.operatingToken]);
const tradeRouter = dryRun ? undefined : await read(settlement, 'FeeSettlementRouter', 'tradeRouter');

const deployment = { version: 1, environment: config.environment, chainId: config.chainId, chainName: config.chainName, rpcUrl: config.rpcUrl,
  ...(config.explorerUrl ? { explorerUrl: config.explorerUrl } : {}), apiUrl: config.apiUrl,
  ...Object.fromEntries(['historyApiUrl', 'operationsApiUrl', 'artifactApiUrl', 'transparencyApiUrl', 'browserApiUrl'].filter(k => config[k]).map(k => [k, config[k]])),
  registry, curveFactory: factory, decisionVerifier: verifier, operatingToken: config.operatingToken, rootHalo: config.rootHalo,
  poolManager: config.poolManager, graduationAdapter: adapter, hook: hookSalt.address, feeSettlement: settlement, rootReferenceMarket: reference,
  ...(tradeRouter ? { tradeRouter } : {}), nativeBuyRouter, deploymentBlock: String(await client.getBlockNumber()),
  operatingSymbol: config.operatingSymbol, haloSymbol: config.haloSymbol, coreReleaseSha256: releaseSha256, ...(config.social ? { social: config.social } : {}),
  disclosure: config.environment === 'mainnet' ? 'Public deployment. Verify every address against the deployment report before funding.' : 'Public testnet deployment with test assets. No mainnet value.' };
const outDir = path.join(root, 'deploy', config.environment); fs.mkdirSync(outDir, { recursive: true });
if (!dryRun) {
  fs.writeFileSync(path.join(outDir, 'deployment.json'), JSON.stringify(deployment, null, 2) + '\n');
  fs.writeFileSync(path.join(outDir, 'deployment-report.json'), JSON.stringify({ ...report, deployment }, null, 2) + '\n');
  log(`Wrote ${path.relative(root, outDir)}/deployment.json and deployment-report.json`);
  log('Next: provide liquidity to the reference pool (owner action through Uniswap), copy deployment.json to halo-web/public/, start the API with this deployment.');
} else log('Dry run complete: nothing was sent.');
