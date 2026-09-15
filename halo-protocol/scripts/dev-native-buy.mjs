// Adds a real ETH-backed wrapper and retail reference pool to the EXISTING disposable preview.
// Never resets chain state. Never accepts a public RPC or deploys on a public chain.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createPublicClient, createWalletClient, defineChain, http, parseEther } from 'viem';
import { root } from './compile.mjs';
import { deploySettlement } from '../test/settlement-fixture.mjs';
const file = path.join(root, '../halo-web/public/deployment-trading.json');
const config = JSON.parse(fs.readFileSync(file));
assert.equal(config.environment, 'local');
assert.equal(config.rpcUrl, 'http://127.0.0.1:8547');
if (config.nativeBuyRouter) throw new Error('Router already configured; inspect it instead of duplicating deployment');
const chain = defineChain({ id: 31337, name: 'HALO local preview', nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 }, rpcUrls: { default: { http: [config.rpcUrl] } } });
const client = createPublicClient({ chain, transport: http(config.rpcUrl) });
assert.equal(await client.getChainId(), 31337);
assert(await client.getCode({ address: config.curveFactory }));
const wallet = createWalletClient({ chain, transport: http(config.rpcUrl) });
const accounts = await wallet.getAddresses();
const [deployer] = accounts;
const artifacts = Object.fromEntries(fs.readdirSync(path.join(root, 'artifacts')).filter(n => n.endsWith('.json')).map(n => [n.slice(0, -5), JSON.parse(fs.readFileSync(path.join(root, 'artifacts', n)))]));
const read = (address, name, functionName, args = []) => client.readContract({ address, abi: artifacts[name].abi, functionName, args });
const receipt = async hash => { const r = await client.waitForTransactionReceipt({ hash }); assert.equal(r.status, 'success'); return r; };
const deploy = async (name, args = []) => (await receipt(await wallet.deployContract({ account: deployer, abi: artifacts[name].abi, bytecode: artifacts[name].bytecode, args }))).contractAddress;
async function send(address, name, functionName, args = [], value = 0n) {
  const { request } = await client.simulateContract({ account: deployer, address, abi: artifacts[name].abi, functionName, args, value });
  return receipt(await wallet.writeContract({ ...request, gas: (await client.estimateContractGas(request)) * 3n / 2n }));
}
const weth = await deploy('TestWrappedNative');
await send(weth, 'TestWrappedNative', 'deposit', [], parseEther('200'));
const market = await deploySettlement({ artifacts, client, accounts, halo: config.rootHalo, weth, factory: config.curveFactory, deploy, send, read, manager: config.poolManager, liquidityAmount: parseEther('1000') });
const router = await deploy('NativeBuyRouter', [config.curveFactory, market.reference, weth]);
config.nativeBuyRouter = router;
config.nativeWrappedToken = weth;
config.nativeReferenceMarket = market.reference;
fs.writeFileSync(file, JSON.stringify(config, null, 2) + '\n');
fs.writeFileSync(path.join(root, 'test-results/native-preview.json'), JSON.stringify({ timestamp: new Date().toISOString(), router, weth, reference: market.reference, chainId: 31337, publicDeployment: false }, null, 2));
console.log(`Local ETH router connected: ${router}`);
