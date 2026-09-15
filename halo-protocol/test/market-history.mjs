import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { decodeEventLog, getContractAddress, parseAbiItem, parseEther, zeroAddress } from 'viem';
import { compile, root } from '../scripts/compile.mjs';
import { startChain } from './helpers.mjs';
import { mineHookSalt } from '../sdk/hook-salt.mjs';
import { gasWithHeadroom } from '../sdk/transaction-gas.mjs';
import { createApi } from '../services/api/server.mjs';
import { marketHistory, curvePrice, poolPrice } from '../sdk/market-history.mjs';
import { CURVE_SUPPLY } from '../sdk/curve.mjs';

const artifacts = process.argv.includes('--no-compile')
  ? Object.fromEntries(fs.readdirSync(path.join(root, 'artifacts')).filter(name => name.endsWith('.json'))
    .map(name => [name.slice(0, -5), JSON.parse(fs.readFileSync(path.join(root, 'artifacts', name)))])) : compile({ test: true });
for (const name of ['PoolManager', 'PoolSwapTest']) {
  const built = JSON.parse(fs.readFileSync(path.join(root, 'node_modules/@uniswap/v4-core/out', `${name}.sol`, `${name}.json`)));
  artifacts[`Uniswap${name}`] = { abi: built.abi, bytecode: built.bytecode.object };
}

assert.equal(curvePrice(1000000n * 10n ** 18n, 0n, 18, 18), .0003125);
assert.equal(curvePrice(1000000n * 10n ** 18n, CURVE_SUPPLY, 18, 18), .005);
assert.equal(poolPrice(2n ** 97n, true, 18, 6), 4e12);
assert.equal(poolPrice(2n ** 97n, false, 6, 18), .25e-12);
assert.throws(() => curvePrice(1n, -1n, 18, 18));

// --- Disposable fixture: a real local curve/pool history, built directly (no agent, no EZKL proving) ---
// so this test stays self-contained and fast while still exercising real contract logic end to end.
const env = await startChain();
const { client, wallet, accounts } = env;
const [deployer] = accounts;
const read = (address, name, functionName, args = []) => client.readContract({ address, abi: artifacts[name].abi, functionName, args });
let transactions = 0;
async function receipt(hash) { const value = await client.waitForTransactionReceipt({ hash }); assert.equal(value.status, 'success', hash); transactions++; return value; }
async function send(address, name, functionName, args = [], account = deployer) {
  const { request } = await client.simulateContract({ address, abi: artifacts[name].abi, functionName, args, account });
  return receipt(await wallet.writeContract({ ...request, gas: gasWithHeadroom(await client.estimateContractGas(request)) }));
}
async function deploy(name, args = []) {
  return (await receipt(await wallet.deployContract({ abi: artifacts[name].abi, bytecode: artifacts[name].bytecode, args, account: deployer }))).contractAddress;
}
function event(value, name, eventName, address) {
  return value.logs.filter(log => !address || log.address.toLowerCase() === address.toLowerCase())
    .map(log => { try { return decodeEventLog({ abi: artifacts[name].abi, ...log }); } catch { return null; } })
    .find(log => log?.eventName === eventName)?.args;
}
const deadline = async () => (await client.getBlock()).timestamp + 600n;

let api;
try {
  const halo = await deploy('TestToken');
  const manager = await deploy('UniswapPoolManager', [deployer]);
  const deploymentNonce = BigInt(await client.getTransactionCount({ address: deployer, blockTag: 'pending' }));
  const adapterAddress = getContractAddress({ from: deployer, nonce: deploymentNonce });
  const factoryAddress = getContractAddress({ from: deployer, nonce: deploymentNonce + 1n });
  const mined = mineHookSalt({ adapter: adapterAddress, manager, hookBytecode: artifacts.HaloPoolHook.bytecode });
  const adapter = await deploy('V4GraduationAdapter', [manager, factoryAddress, mined.salt]);
  const factory = await deploy('CurveFactory', [halo, deployer, adapter]);
  const fees = { tradingBps: 100, operationsBps: 6000, haloBps: 2000, operations: deployer, creator: deployer };

  async function launch(symbol, target) {
    const created = event(await send(factory, 'CurveFactory', 'create',
      [`Token ${symbol}`, symbol, halo, target, fees, 'ipfs://disposable-test-fixture']), 'CurveFactory', 'TokenLaunched');
    return { token: created.token, curve: created.curve };
  }
  async function buySell(curve, token, amount) {
    await send(halo, 'TestToken', 'approve', [curve, amount]);
    const bought = event(await send(curve, 'HaloCurve', 'buy', [amount, 1n, deployer, await deadline()]), 'HaloCurve', 'Bought');
    await send(token, 'HaloToken', 'approve', [curve, bought.tokens]);
    await send(curve, 'HaloCurve', 'sell', [bought.tokens, 1n, deployer, await deadline()]);
  }

  // A never-graduating market: independently cross-checked against on-chain priceX128 below.
  const quiet = await launch('QUIET', parseEther('1000000'));
  for (let i = 0; i < 20; i++) await buySell(quiet.curve, quiet.token, parseEther('5'));

  // The graduating market: enough pre-graduation curve trades plus post-graduation pool swaps to exceed
  // 600 combined events, exercising both the 500-point truncation and the candle aggregation.
  const grad = await launch('GRAD', parseEther('2000'));
  await send(halo, 'TestToken', 'approve', [grad.curve, parseEther('1000000000')]);
  await send(grad.token, 'HaloToken', 'approve', [grad.curve, parseEther('1000000000')]);
  const preGradTrades = 145;
  for (let i = 0; i < preGradTrades; i++) {
    const bought = event(await send(grad.curve, 'HaloCurve', 'buy', [parseEther('1'), 1n, deployer, await deadline()]), 'HaloCurve', 'Bought');
    await send(grad.curve, 'HaloCurve', 'sell', [bought.tokens, 1n, deployer, await deadline()]);
  }
  const graduation = await send(grad.curve, 'HaloCurve', 'buy', [parseEther('4000'), 1n, deployer, await deadline()]);
  assert.equal(await read(grad.curve, 'HaloCurve', 'graduated'), true);
  const expectedCurveEvents = 1 /* launch */ + preGradTrades * 2 + 1 /* graduating buy */;

  const liquidityVault = await read(grad.curve, 'HaloCurve', 'liquidityVault');
  const key = await read(liquidityVault, 'LockedLiquidityVault', 'marketKey');
  const zeroForOne = key.currency0.toLowerCase() === grad.token.toLowerCase();
  const swapRouter = await deploy('UniswapPoolSwapTest', [manager]);
  await send(halo, 'TestToken', 'approve', [swapRouter, parseEther('1000000000')]);
  await send(grad.token, 'HaloToken', 'approve', [swapRouter, parseEther('1000000000')]);
  const swapCount = 460;
  let lastSwapReceipt;
  for (let i = 0; i < swapCount; i++) {
    const forward = i % 2 === 0; // alternate direction so the small locked-liquidity pool never runs dry
    lastSwapReceipt = await send(swapRouter, 'UniswapPoolSwapTest', 'swap', [key,
      { zeroForOne: forward ? zeroForOne : !zeroForOne, amountSpecified: -parseEther('0.05'),
        sqrtPriceLimitX96: (forward ? zeroForOne : !zeroForOne) ? 4295128740n : 1461446703485210103287273052203988822378723970341n },
      { takeClaims: false, settleUsingBurn: false }, '0x']);
  }
  const expectedTotalEvents = expectedCurveEvents + 1 /* graduation */ + swapCount;
  assert(expectedTotalEvents > 600, `fixture must exceed 600 events, has ${expectedTotalEvents}`);

  const deployment = { environment: 'local', chainId: 31337, chainName: 'HALO market-history test', rpcUrl: client.chain.rpcUrls.default.http[0],
    registry: zeroAddress, curveFactory: factory, deploymentBlock: '0' };
  const options = { client, deployment, artifacts };
  const readHistory = marketHistory(options);
  const [history, shared] = await Promise.all([readHistory(grad.token), readHistory(grad.token)]);
  assert.equal(history, shared, 'Concurrent readers share one snapshot');
  assert.equal(history.complete, true);
  assert(history.points.some(p => p.venue === 'pool' && p.kind === 'sell'), 'at least one pool sell was observed');
  assert(history.points.some(p => p.venue === 'pool' && p.kind === 'buy'), 'at least one pool buy was observed');
  const migration = history.points.findIndex(p => p.kind === 'graduation');
  assert(migration > 0);
  assert(Math.abs(history.points[migration].price / history.points[migration - 1].price - 1) < 1e-12);
  assert.equal(history.totalEvents, expectedTotalEvents);
  assert.equal(history.points.length, 500, 'points is truncated to the newest 500 raw events');
  assert.equal(history.candles.reduce((sum, c) => sum + c.trades, 0), history.totalEvents, 'every event is folded into exactly one candle');
  assert(history.candles.length > 0 && history.bucketMs > 0);
  for (const candle of history.candles) {
    assert(candle.high >= candle.open && candle.high >= candle.close && candle.high >= candle.low);
    assert(candle.low <= candle.open && candle.low <= candle.close);
  }
  for (let i = 1; i < history.candles.length; i++) assert(history.candles[i].time > history.candles[i - 1].time);
  assert.equal(history.points.at(-1).transactionHash, lastSwapReceipt.transactionHash, 'the newest raw point is the very last swap');
  assert.equal(BigInt(history.points.at(-1).blockNumber), lastSwapReceipt.blockNumber);

  const swapAbi = [parseAbiItem('event Swap(bytes32 indexed id,address indexed sender,int128 amount0,int128 amount1,uint160 sqrtPriceX96,uint128 liquidity,int24 tick,uint24 fee)')];
  const poolPoints = history.points.filter(p => p.venue === 'pool' && p.kind !== 'graduation');
  for (const point of poolPoints.filter((_, i) => i % 20 === 0)) { // sample: a full receipt fetch per point would be needlessly slow
    const receiptLogs = await client.getTransactionReceipt({ hash: point.transactionHash });
    const log = receiptLogs.logs.find(l => l.logIndex === point.logIndex);
    const { args } = decodeEventLog({ abi: swapAbi, data: log.data, topics: log.topics });
    const quoteDelta = BigInt(grad.token) < BigInt(history.quote) ? args.amount1 : args.amount0;
    assert.equal(point.volume, Math.abs(Number(quoteDelta) / 1e18));
    assert.equal(point.kind, (BigInt(grad.token) < BigInt(history.quote) ? args.amount0 : args.amount1) > 0n ? 'buy' : 'sell');
  }

  const quietHistory = await readHistory(quiet.token);
  const onchain = await read(quiet.curve, 'HaloCurve', 'priceX128');
  assert(Math.abs(quietHistory.points.at(-1).price / (Number(onchain) / 2 ** 128) - 1) < 1e-12);
  assert.equal(quietHistory.totalEvents, quietHistory.points.length, 'small histories are never truncated');

  await assert.rejects(marketHistory({ ...options, maxBlocks: 0n })(grad.token), /archival indexer/);
  await assert.rejects(readHistory('0x0000000000000000000000000000000000000001'), /not created/);
  let calls = 0;
  const reorganizing = { ...client, getBlock: async args => { const b = await client.getBlock(args); return ++calls > 1 ? { ...b, hash: '0x' + 'ff'.repeat(32) } : b; } };
  await assert.rejects(marketHistory({ ...options, client: reorganizing })(grad.token), /reorganized/);

  // In-memory fake of the durable candle cache contract (see services/history/journal.mjs createCandleCache):
  // exercises the read-through short-circuit against a real chain head/hash, without needing PostgreSQL.
  // Each call below builds a *fresh* marketHistory() instance (sharing only the fake store) so the ordinary
  // 15-second in-process snapshot cache — a separate mechanism — can never mask what candleCache itself does.
  const store = new Map();
  const fakeCache = { async read(token) { return store.get(token.toLowerCase()) ?? null; }, async write(token, state) { store.set(token.toLowerCase(), state); } };
  let getLogsCalls = 0;
  const countedClient = { ...client, getLogs: p => { getLogsCalls++; return client.getLogs(p); } };
  const first = await marketHistory({ ...options, client: countedClient, candleCache: fakeCache })(grad.token);
  assert.equal(store.size, 1, 'a cache miss populates the cache');
  const callsAfterFirst = getLogsCalls;
  const second = await marketHistory({ ...options, client: countedClient, candleCache: fakeCache })(grad.token);
  assert.deepEqual(second, first, 'a cache hit (same head) returns the identical snapshot');
  assert.equal(getLogsCalls, callsAfterFirst, 'a cache hit never re-fetches logs');
  await buySell(quiet.curve, quiet.token, parseEther('1')); // mine a new block so the head advances
  const third = await marketHistory({ ...options, client: countedClient, candleCache: fakeCache })(grad.token);
  assert.notEqual(third.observedBlock, first.observedBlock, 'a new head is a cache miss and recomputes');
  assert(getLogsCalls > callsAfterFirst, 'a new head re-fetches logs and refreshes the cache');
  assert.equal(store.size, 1);

  // --- Live API surface: the same server the website talks to, exercised over real HTTP. ---
  api = await createApi({ client, deployment, artifacts });
  await api.listen({ host: '127.0.0.1', port: 8799 });
  const base = 'http://127.0.0.1:8799';
  const hourly = await (await fetch(`${base}/v1/tokens/${grad.token}/history?bucket=1h`)).json();
  assert.equal(hourly.bucketMs, 3600e3);
  assert(hourly.truncated === true, 'the API reports truncation for this oversized fixture');
  assert(Array.isArray(hourly.candles) && hourly.candles.length > 0);
  const trades = await (await fetch(`${base}/v1/tokens/${grad.token}/trades?limit=50`)).json();
  assert.equal(trades.trades.length, 50);
  assert(trades.nextCursor, 'more than 50 trades exist, so a cursor is returned');
  const nextPage = await (await fetch(`${base}/v1/tokens/${grad.token}/trades?limit=50&cursor=${encodeURIComponent(trades.nextCursor)}`)).json();
  assert.equal(nextPage.trades.length, 50);
  assert.notEqual(nextPage.trades[0].transactionHash, trades.trades[0].transactionHash);
  const badCursor = await fetch(`${base}/v1/tokens/${grad.token}/trades?cursor=not-a-cursor`);
  assert.equal(badCursor.status, 400);
  console.log(JSON.stringify({ historyExcerpt: { bucketMs: hourly.bucketMs, truncated: hourly.truncated, candleCount: hourly.candles.length, firstCandle: hourly.candles[0], lastCandle: hourly.candles.at(-1) } }));
  console.log(JSON.stringify({ tradesExcerpt: { count: trades.trades.length, nextCursor: trades.nextCursor, newest: trades.trades[0] } }));

  const result = { checkedAt: new Date().toISOString(), chainId: deployment.chainId, environment: deployment.environment,
    checks: ['curve endpoints and decimal scaling', 'pool quote inversion', 'concurrent snapshot deduplication', 'graduation price continuity',
      'canonical pool receipts and volume (sampled)', 'curve marginal price matches contract', 'points truncated to 500 with candles covering full history',
      'unknown tokens rejected', 'reorganization rejected', 'durable candle cache short-circuits on an unchanged head and misses on a new one',
      'live HTTP /history bucket query and truncation flag', 'live HTTP /trades keyset pagination and malformed-cursor rejection'],
    graduatedEvents: history.points.length, totalGraduatedEvents: history.totalEvents, curveEvents: quietHistory.points.length, observedBlock: history.observedBlock, transactions };
  fs.writeFileSync(new URL('../test-results/market-history.json', import.meta.url), JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result));
} finally { await api?.close(); await env.stop(); }
