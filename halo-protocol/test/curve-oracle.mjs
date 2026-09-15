import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { decodeEventLog, maxUint256, parseEther } from 'viem';
import { compile, root } from '../scripts/compile.mjs';
import { startChain } from './helpers.mjs';
import { gasWithHeadroom } from '../sdk/transaction-gas.mjs';

const artifacts = process.argv.includes('--no-compile')
  ? Object.fromEntries(fs.readdirSync(path.join(root, 'artifacts')).filter(n => n.endsWith('.json'))
    .map(n => [n.slice(0, -5), JSON.parse(fs.readFileSync(path.join(root, 'artifacts', n)))]))
  : compile({ test: true });
const env = await startChain();
const { client, wallet, accounts } = env;
const [account, creator, operations, protocol] = accounts;
const passed = [];
const read = (address, contract, functionName, args = []) => client.readContract({ address, abi: artifacts[contract].abi, functionName, args });
async function done(hash) { const result = await client.waitForTransactionReceipt({ hash }); assert.equal(result.status, 'success'); return result; }
async function send(address, contract, functionName, args = []) {
  const { request } = await client.simulateContract({ address, abi: artifacts[contract].abi, functionName, args, account });
  return done(await wallet.writeContract({ ...request, gas: gasWithHeadroom(await client.estimateContractGas(request)) }));
}
async function deploy(contract, args = []) {
  return (await done(await wallet.deployContract({ abi: artifacts[contract].abi, bytecode: artifacts[contract].bytecode, args, account }))).contractAddress;
}
const pass = label => { passed.push(label); console.log(`PASS ${label}`); };
try {
  const halo = await deploy('TestToken');
  const adapter = await deploy('TestGraduationAdapter');
  const factory = await deploy('CurveFactory', [halo, protocol, adapter]);
  const fees = { tradingBps: 100, operationsBps: 6000, haloBps: 2000, operations, creator };
  const target = parseEther('1000000');
  const created = await send(factory, 'CurveFactory', 'create', ['Observed curve', 'OBS', halo, target, fees, 'ipfs://oracle-test']);
  const launch = created.logs.map(log => { try { return decodeEventLog({ abi: artifacts.CurveFactory.abi, ...log }); } catch { return null; } })
    .find(log => log?.eventName === 'TokenLaunched').args;
  const curve = launch.curve;
  const start = (await client.getBlock({ blockNumber: created.blockNumber })).timestamp;
  const p0 = await read(curve, 'HaloCurve', 'priceX128');
  const C = 800_000_000n * 10n ** 18n;
  assert.equal(p0, 4n * target * C * (1n << 128n) / (4n * C) ** 2n);
  await assert.rejects(() => read(curve, 'HaloCurve', 'consult', [1800]), /InsufficientHistory/);
  await send(halo, 'TestToken', 'approve', [curve, maxUint256]);
  await client.request({ method: 'evm_setNextBlockTimestamp', params: [Number(start + 100n)] });
  await send(curve, 'HaloCurve', 'buy', [parseEther('10000'), 1n, account, start + 10000n]);
  const p1 = await read(curve, 'HaloCurve', 'priceX128');
  await client.request({ method: 'evm_setNextBlockTimestamp', params: [Number(start + 300n)] });
  await send(curve, 'HaloCurve', 'buy', [parseEther('10000'), 1n, account, start + 10000n]);
  const p2 = await read(curve, 'HaloCurve', 'priceX128');
  await client.request({ method: 'evm_setNextBlockTimestamp', params: [Number(start + 600n)] });
  await client.request({ method: 'evm_mine', params: [] });
  const [mean, seconds] = await read(curve, 'HaloCurve', 'consult', [599]);
  assert.equal(seconds, 600n);
  assert.equal(mean, (p0 * 100n + p1 * 200n + p2 * 300n) / 600n);
  pass('on-chain price history exactly matches an independent piecewise time integral of actual curve trades');

  await client.request({ method: 'evm_setNextBlockTimestamp', params: [Number(start + 2500n)] });
  await client.request({ method: 'evm_mine', params: [] });
  const flash = await deploy('CurveOracleRoundTrip');
  await send(halo, 'TestToken', 'approve', [flash, parseEther('500000')]);
  await send(flash, 'CurveOracleRoundTrip', 'run', [curve, parseEther('500000')]);
  pass('a large atomic buy/sell changes spot during execution but contributes zero time to the price average');

  for (let i = 0; i < 66; i++) {
    await client.request({ method: 'evm_increaseTime', params: [61] });
    await send(curve, 'HaloCurve', 'checkpoint');
  }
  const [steady, window] = await read(curve, 'HaloCurve', 'consult', [1800]);
  assert.equal(steady, p2);
  assert(window >= 1800n && window < 1862n);
  await assert.rejects(() => read(curve, 'HaloCurve', 'consult', [4000]), /InsufficientHistory/);
  pass('observation ring rollover preserves recent history and rejects a requested window older than the retained entries');
  fs.writeFileSync(path.join(root, 'test-results/curve-oracle.json'), JSON.stringify({ completedAt: new Date().toISOString(), passed,
    environment: 'Disposable Anvil; deterministic timestamps and actual curve transactions' }, null, 2) + '\n');
} finally { await env.stop(); }
