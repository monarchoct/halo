import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { decodeEventLog, getContractAddress, parseEther, keccak256 } from 'viem';
import { root } from '../scripts/compile.mjs';
import { startChain } from './helpers.mjs';
import { deploySettlement } from './settlement-fixture.mjs';
import { mineHookSalt } from '../sdk/hook-salt.mjs';
import { nativePurchaseQuote } from '../sdk/native-quote.mjs';
import { createApi } from '../services/api/server.mjs';
import { robinhoodForkConfig } from './robinhood-fork-config.mjs';
import { gasWithHeadroom } from '../sdk/transaction-gas.mjs';

const artifacts = Object.fromEntries(fs.readdirSync(path.join(root, 'artifacts')).filter(n => n.endsWith('.json'))
  .map(n => [n.slice(0, -5), JSON.parse(fs.readFileSync(path.join(root, 'artifacts', n)))]));
const fork = process.argv.includes('--robinhood-fork') ? await robinhoodForkConfig() : null;
if (fork) console.log(`Robinhood fork block ${fork.forkBlock}; all transactions execute on disposable loopback Anvil`);
const env = await startChain(fork ?? {});
const { client, wallet, accounts } = env;
const [deployer, buyer, treasury] = accounts;
const passed = [];
const pass = name => { passed.push(name); console.log(`PASS ${name}`); };
const read = (address, name, functionName, args = []) => client.readContract({ address, abi: artifacts[name].abi, functionName, args });
const receipt = async hash => {
  const r = await client.waitForTransactionReceipt({ hash });
  if (r.status !== 'success') {
    const tx = await client.getTransaction({ hash });
    const block = await client.getBlock({ blockNumber: r.blockNumber });
    const trace = await client.request({ method: 'debug_traceTransaction', params: [hash, { disableStorage: true, disableStack: true, enableMemory: false }] });
    console.error(JSON.stringify({ hash, gas: String(tx.gas), gasUsed: String(r.gasUsed), timestamp: String(block.timestamp), returnValue: trace.returnValue, failed: trace.failed }));
  }
  assert.equal(r.status, 'success'); return r;
};
const deploy = async (name, args = []) => (await receipt(await wallet.deployContract({ account: deployer, abi: artifacts[name].abi, bytecode: artifacts[name].bytecode, args }))).contractAddress;
async function send(address, name, functionName, args = [], account = deployer, value = 0n) {
  const { request } = await client.simulateContract({ account, address, abi: artifacts[name].abi, functionName, args, value });
  return receipt(await wallet.writeContract({ ...request, gas: (await client.estimateContractGas(request)) * 3n / 2n }));
}
try {
  const halo = await deploy('TestToken'), weth = await deploy('TestWrappedNative');
  const m = JSON.parse(fs.readFileSync(path.join(root, 'node_modules/@uniswap/v4-core/out/PoolManager.sol/PoolManager.json')));
  artifacts.UniswapPoolManager = { abi: m.abi, bytecode: m.bytecode.object };
  const manager = fork?.manager ?? await deploy('UniswapPoolManager', [deployer]);
  if (fork) assert.equal(keccak256(await client.getCode({ address: manager })), fork.evidence.poolManagerCodeHash);
  const nonce = BigInt(await client.getTransactionCount({ address: deployer }));
  const expected = getContractAddress({ from: deployer, nonce });
  const salt = mineHookSalt({ adapter: expected, manager, hookBytecode: artifacts.HaloPoolHook.bytecode }).salt;
  const adapter = await deploy('V4GraduationAdapter', [manager, getContractAddress({ from: deployer, nonce: nonce + 1n }), salt]);
  const factory = await deploy('CurveFactory', [halo, treasury, adapter]);
  await send(weth, 'TestWrappedNative', 'deposit', [], deployer, parseEther('200'));
  const market = await deploySettlement({ artifacts, client, accounts, halo, weth, factory, deploy, send, read, manager, liquidityAmount: parseEther('1000') });
  const router = await deploy('NativeBuyRouter', [factory, market.reference, weth]);
  const fees = { tradingBps: 100, operationsBps: 6000, haloBps: 2000, operations: treasury, creator: deployer };
  async function launch(symbol, parent, target) {
    const r = await send(factory, 'CurveFactory', 'create', [symbol, symbol, parent, parseEther(target), fees, 'ipfs://test']);
    for (const log of r.logs) { try { const e = decodeEventLog({ abi: artifacts.CurveFactory.abi, ...log }); if (e.eventName === 'TokenLaunched') return e.args; } catch {} }
    throw new Error('No launch event');
  }
  const fred = await launch('FRED', halo, '100');
  const dog = await launch('DOG', fred.token, '1000000');
  const quote = async (token, value) => (await client.simulateContract({ address: router, abi: artifacts.NativeBuyRouter.abi, functionName: 'quote', args: [token, value], account: buyer })).result;
  const deadline = async () => (await client.getBlock()).timestamp + 120n;
  const balance = (token, who) => read(token, 'HaloToken', 'balanceOf', [who]);
  const q = await quote(dog.token, parseEther('0.01'));
  assert.deepEqual(q[0].map(x => x.toLowerCase()), [weth, halo, fred.token, dog.token].map(x => x.toLowerCase()));
  assert.equal(await read(fred.curve, 'HaloCurve', 'sold'), 0n);
  assert.deepEqual(await quote(dog.token, parseEther('0.01')), q);
  pass('ETH → WETH → HALO → FRED → DOG quote is repeatable and does not mutate curves');
  const integrationDeployment = { environment: 'local', chainId: 31337, nativeBuyRouter: router, curveFactory: factory, rootHalo: halo, deploymentBlock: '0' };
  const integrated = await nativePurchaseQuote({ client, deployment: integrationDeployment, artifacts, token: dog.token, buyer, amount: parseEther('0.01').toString() });
  assert.equal(integrated.outputAmount, q[1].at(-1).toString());
  assert.equal(integrated.minimumOutput, (q[1].at(-1) * 99n / 100n).toString());
  const api = await createApi({ client, deployment: integrationDeployment, artifacts });
  try {
    const response = await api.inject(`/v1/tokens/${dog.token}/native-quote?buyer=${buyer}&amount=10000000000000000`);
    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json().transaction, integrated.transaction);
    assert.equal(response.headers['cache-control'], 'no-store');
    assert.equal((await api.inject(`/v1/tokens/${dog.token}/native-quote?buyer=${buyer}&amount=1&slippageBps=10000`)).statusCode, 400);
  } finally { await api.close(); }
  const unsigned = { account: buyer, to: integrated.transaction.to, data: integrated.transaction.data, value: BigInt(integrated.transaction.value) };
  const nativeGas = gasWithHeadroom(await client.estimateGas(unsigned));
  await receipt(await wallet.sendTransaction({ ...unsigned, gas: nativeGas }));
  pass('SDK and public API return matching unsigned calldata that executes on the real local chain');
  assert.equal(await balance(dog.token, buyer), q[1].at(-1));
  for (const t of q[0]) assert.equal(await balance(t, router), 0n);
  pass('Actual native ETH funds an atomic multi-hop purchase with exact quoted output');
  const beforeSold = await read(fred.curve, 'HaloCurve', 'sold');
  const beforeDog = await balance(dog.token, buyer);
  const impossible = await quote(dog.token, parseEther('0.01'));
  const hash = await wallet.writeContract({ account: buyer, address: router, abi: artifacts.NativeBuyRouter.abi, functionName: 'buy', args: [dog.token, impossible[1].at(-1) + 1n, await deadline()], value: parseEther('0.01'), gas: 5000000n });
  assert.equal((await client.waitForTransactionReceipt({ hash })).status, 'reverted');
  assert.equal(await read(fred.curve, 'HaloCurve', 'sold'), beforeSold);
  assert.equal(await balance(dog.token, buyer), beforeDog);
  pass('Mined slippage failure rolls back every upstream purchase');
  const cap = await quote(dog.token, parseEther('2'));
  assert(cap[2].some(v => v > 0n));
  const prior = await Promise.all(cap[0].map(t => balance(t, buyer)));
  await send(halo, 'HaloToken', 'transfer', [router, 123n]);
  await send(router, 'NativeBuyRouter', 'buy', [dog.token, cap[1].at(-1), await deadline()], buyer, parseEther('2'));
  for (let i = 1; i < cap[0].length - 1; i++) assert.equal(await balance(cap[0][i], buyer), prior[i] + cap[2][i]);
  assert.equal(await balance(halo, router), 123n);
  assert.equal(await read(fred.curve, 'HaloCurve', 'graduated'), true);
  assert.equal(await read(dog.curve, 'HaloCurve', 'graduated'), true);
  pass('Curve caps graduate both markets, return intermediate refunds and preserve donated balances');
  const graduated = await quote(dog.token, parseEther('0.01'));
  const old = await balance(dog.token, buyer);
  await send(router, 'NativeBuyRouter', 'buy', [dog.token, graduated[1].at(-1), await deadline()], buyer, parseEther('0.01'));
  assert.equal(await balance(dog.token, buyer), old + graduated[1].at(-1));
  pass('Same ETH route executes through graduated Uniswap v4 pools');
  await assert.rejects(() => quote(buyer, 1n));
  await assert.rejects(() => send(router, 'NativeBuyRouter', 'unlockCallback', ['0x'], buyer));
  await assert.rejects(() => send(router, 'NativeBuyRouter', 'buy', [dog.token, 1n, 0n], buyer, 1n));
  pass('Unknown tokens, forged callbacks and expired purchases are rejected');
  fs.writeFileSync(path.join(root, `test-results/native-buy${fork ? '-robinhood-fork' : ''}.json`), JSON.stringify({ timestamp: new Date().toISOString(), chainId: 31337, passed, productionDeployment: false,
    ...(fork ? { fork: fork.evidence } : {}) }, null, 2));
} finally { await env.stop(); }
