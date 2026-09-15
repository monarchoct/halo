import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { decodeEventLog, maxUint256, parseEther } from 'viem';
import { compile, root } from '../scripts/compile.mjs';
import { startChain } from './helpers.mjs';
import { CURVE_SUPPLY as C, LIQUIDITY_SUPPLY as L, SUPPLY, reserves, quoteBuy, quoteSell } from '../sdk/curve.mjs';
import './curve-model.test.mjs';
import { runAgentScenarios } from './agents.test.mjs';
import { runV4Scenarios } from './v4.test.mjs';
import { gasWithHeadroom } from '../sdk/transaction-gas.mjs';

const artifacts = process.argv.includes('--no-compile')
  ? Object.fromEntries(fs.readdirSync(path.join(root, 'artifacts')).filter(name => name.endsWith('.json'))
    .map(name => [name.slice(0, -5), JSON.parse(fs.readFileSync(path.join(root, 'artifacts', name)))]))
  : compile({ test: true });
const env = await startChain();
const { client, wallet, accounts } = env;
const [deployer, creator, operations, protocol, stranger] = accounts;
const passed = [];
let txCount = 0;
const read = (address, contract, functionName, args = []) => client.readContract({ address, abi: artifacts[contract].abi, functionName, args });
async function send(address, contract, functionName, args = [], account = deployer) {
  const { request } = await client.simulateContract({ address, abi: artifacts[contract].abi, functionName, args, account });
  const gas = gasWithHeadroom(await client.estimateContractGas(request));
  const hash = await wallet.writeContract({ ...request, gas });
  const receipt = await client.waitForTransactionReceipt({ hash });
  if (receipt.status !== 'success') {
    const trace = await client.request({ method: 'debug_traceTransaction', params: [hash, { tracer: 'callTracer' }] });
    console.error(JSON.stringify({ contract, functionName, gasUsed: String(receipt.gasUsed), trace }));
  }
  assert.equal(receipt.status, 'success'); txCount++;
  return receipt;
}
async function deploy(name, args = []) {
  const hash = await wallet.deployContract({ abi: artifacts[name].abi, bytecode: artifacts[name].bytecode, args, account: deployer });
  const receipt = await client.waitForTransactionReceipt({ hash });
  assert.equal(receipt.status, 'success'); txCount++;
  return receipt.contractAddress;
}
async function rejects(address, contract, functionName, args, reason, account = deployer) {
  await assert.rejects(() => client.simulateContract({ address, abi: artifacts[contract].abi, functionName, args, account }),
    error => error.message.includes(reason), `Expected ${reason}`);
}
function pass(name) { passed.push(name); console.log(`PASS ${name}`); }

try {
  const rootToken = await deploy('TestToken');
  const adapter = await deploy('TestGraduationAdapter');
  const factory = await deploy('CurveFactory', [rootToken, protocol, adapter]);
  const math = await deploy('CurveMathHarness');
  const target = parseEther('1000000');
  const fees = { tradingBps: 100, operationsBps: 6000, haloBps: 2000, operations, creator };
  const deadline = (await client.getBlock()).timestamp + 86400n;

  async function launch(name, symbol, parent = rootToken, launchFees = fees, actor = creator) {
    const receipt = await send(factory, 'CurveFactory', 'create', [name, symbol, parent, target, launchFees, `ipfs://test-${symbol}`], actor);
    const event = receipt.logs.map(log => { try { return decodeEventLog({ abi: artifacts.CurveFactory.abi, ...log }); } catch { return null; } })
      .find(log => log?.eventName === 'TokenLaunched');
    assert(event);
    return event.args;
  }

  const fred = await launch('Fred', 'FRED');
  assert.equal(await read(fred.token, 'HaloToken', 'totalSupply'), SUPPLY);
  assert.equal(await read(fred.token, 'HaloToken', 'balanceOf', [fred.curve]), SUPPLY);
  assert.equal((await read(factory, 'CurveFactory', 'parentOf', [fred.token])).toLowerCase(), rootToken.toLowerCase());
  pass('permissionless fixed-supply root-quoted launch');

  await send(rootToken, 'TestToken', 'approve', [fred.curve, maxUint256]);
  await send(fred.token, 'HaloToken', 'approve', [fred.curve, maxUint256]);
  let sold = 0n;
  for (let i = 1; i <= 60; i++) {
    if (i % 3 === 0) {
      const amount = sold / 7n;
      const expected = quoteSell({ target, sold, tokensIn: amount, feeBps: 100 });
      assert.deepEqual(await read(math, 'CurveMathHarness', 'sell', [target, sold, amount, 100]), [expected.quoteOut, expected.fee]);
      await send(fred.curve, 'HaloCurve', 'sell', [amount, expected.quoteOut, deployer, deadline]);
      sold -= amount;
    } else {
      const amount = parseEther(String(100 + i * 31));
      const expected = quoteBuy({ target, sold, grossIn: amount, feeBps: 100 });
      assert.deepEqual(await read(fred.curve, 'HaloCurve', 'quoteBuy', [amount]), [expected.tokensOut, expected.spent, expected.fee]);
      await send(fred.curve, 'HaloCurve', 'buy', [amount, expected.tokensOut, deployer, deadline]);
      sold += expected.tokensOut;
    }
    assert.equal(await read(fred.curve, 'HaloCurve', 'sold'), sold);
    assert.equal(await read(rootToken, 'TestToken', 'balanceOf', [fred.curve]), reserves(target, sold));
    assert.equal(await read(fred.token, 'HaloToken', 'balanceOf', [fred.curve]), SUPPLY - sold);
    assert.equal(await read(rootToken, 'TestToken', 'allowance', [fred.curve, fred.splitter]), 0n);
  }
  pass('60 actual EVM trades match BigInt quotes and preserve backing reserves');

  const before = await read(fred.curve, 'HaloCurve', 'sold');
  await rejects(fred.curve, 'HaloCurve', 'buy', [parseEther('1'), C, deployer, deadline], 'Slippage');
  await rejects(fred.curve, 'HaloCurve', 'buy', [parseEther('1'), 0n, deployer, 0n], 'Expired');
  await rejects(fred.curve, 'HaloCurve', 'buy', [0n, 0n, deployer, deadline], 'InvalidTrade');
  await rejects(fred.curve, 'HaloCurve', 'sell', [sold + 1n, 0n, deployer, deadline], 'InvalidAmount');
  await rejects(fred.curve, 'HaloCurve', 'graduate', [], 'Closed');
  await rejects(fred.curve, 'HaloCurve', 'finishGraduation', [], 'OnlySelf');
  assert.equal(await read(fred.curve, 'HaloCurve', 'sold'), before);
  pass('invalid amounts, expired trades, slippage and unauthorized migration rejected');

  const totalFees = await read(fred.splitter, 'FeeSplitter', 'totalDeposited');
  const opsFees = await read(fred.splitter, 'FeeSplitter', 'claimable', [operations]);
  const creatorFees = await read(fred.splitter, 'FeeSplitter', 'claimable', [creator]);
  const haloFees = await read(fred.splitter, 'FeeSplitter', 'claimable', [protocol]);
  assert.equal(opsFees + creatorFees + haloFees, totalFees);
  const beforeOps = await read(rootToken, 'TestToken', 'balanceOf', [operations]);
  await send(fred.splitter, 'FeeSplitter', 'claim', [operations], stranger);
  assert.equal(await read(rootToken, 'TestToken', 'balanceOf', [operations]), beforeOps + opsFees);
  assert.equal(await read(fred.splitter, 'FeeSplitter', 'claimable', [creator]), creatorFees);
  pass('fee conservation and permissionless claims pay only the immutable recipient');

  const dog = await launch('Dog narrative', 'DOG', fred.token);
  const cat = await launch('Cat narrative', 'CAT', fred.token);
  assert.notEqual(dog.token, cat.token);
  assert.equal((await read(factory, 'CurveFactory', 'parentOf', [dog.token])).toLowerCase(), fred.token.toLowerCase());
  assert.equal((await read(factory, 'CurveFactory', 'parentOf', [cat.token])).toLowerCase(), fred.token.toLowerCase());
  await send(fred.token, 'HaloToken', 'approve', [dog.curve, parseEther('2000')]);
  await send(dog.curve, 'HaloCurve', 'buy', [parseEther('2000'), 1n, deployer, deadline]);
  assert((await read(dog.token, 'HaloToken', 'balanceOf', [deployer])) > 0n);
  pass('multiple child tokens use the same parent token and trade in that quote asset');

  await rejects(factory, 'CurveFactory', 'create', ['Bad', 'BAD', rootToken, target, { ...fees, tradingBps: 201 }, ''], 'InvalidFees');
  await rejects(factory, 'CurveFactory', 'create', ['Bad', 'BAD', rootToken, target, { ...fees, operationsBps: 4999 }, ''], 'InvalidFees');
  await rejects(factory, 'CurveFactory', 'create', ['Bad', 'BAD', stranger, target, fees, ''], 'UnsupportedQuote');
  pass('published fee bounds and compatible quote provenance enforced');

  const remaining = quoteBuy({ target, sold, grossIn: target * 2n, feeBps: 100 });
  const walletBefore = await read(rootToken, 'TestToken', 'balanceOf', [deployer]);
  await send(fred.curve, 'HaloCurve', 'buy', [target * 2n, remaining.tokensOut, deployer, deadline]);
  assert.equal(walletBefore - await read(rootToken, 'TestToken', 'balanceOf', [deployer]), remaining.spent);
  assert(remaining.refund > 0n);
  assert.equal(await read(fred.curve, 'HaloCurve', 'sold'), C);
  assert.equal(await read(fred.curve, 'HaloCurve', 'graduated'), false);
  assert.equal(await read(rootToken, 'TestToken', 'balanceOf', [fred.curve]), target);
  assert.equal(await read(fred.token, 'HaloToken', 'balanceOf', [fred.curve]), L);
  await rejects(fred.curve, 'HaloCurve', 'buy', [1n, 0n, deployer, deadline], 'Closed');
  await rejects(fred.curve, 'HaloCurve', 'sell', [1n, 0n, deployer, deadline], 'Closed');
  pass('sellout charges only the fill and preserves exact reserves after adapter failure');

  await send(adapter, 'TestGraduationAdapter', 'setFailure', [false]);
  await send(fred.curve, 'HaloCurve', 'graduate', [], stranger);
  const sink = await read(adapter, 'TestGraduationAdapter', 'sink');
  assert.equal(await read(fred.curve, 'HaloCurve', 'graduated'), true);
  assert.equal(await read(rootToken, 'TestToken', 'balanceOf', [sink]), target);
  assert.equal(await read(fred.token, 'HaloToken', 'balanceOf', [sink]), L);
  assert.equal(await read(rootToken, 'TestToken', 'allowance', [fred.curve, adapter]), 0n);
  await rejects(fred.curve, 'HaloCurve', 'graduate', [], 'Closed');
  pass('any caller can retry migration exactly once; no adapter allowance remains (test adapter)');

  for (const name of ['HaloToken', 'HaloCurve', 'CurveFactory', 'FeeSplitter']) {
    const functions = artifacts[name].abi.filter(item => item.type === 'function').map(item => item.name);
    for (const forbidden of ['pause', 'unpause', 'upgradeTo', 'upgradeToAndCall', 'mint', 'rescue', 'setFees', 'setOwner']) {
      assert(!functions.includes(forbidden), `${name} exposes ${forbidden}`);
    }
  }
  pass('economic contract ABIs expose no mint, pause, upgrade or mutable-fee authority');

  await runAgentScenarios({ artifacts, client, accounts, rootToken, factory, deploy, send, read, rejects, pass });
  await runV4Scenarios({ artifacts, client, accounts, rootToken, deploy, send, read, rejects, pass });

  const evidence = { completedAt: new Date().toISOString(), environment: 'local Anvil Cancun; no mainnet transactions',
    compiler: artifacts.HaloCurve.compiler, transactions: txCount, passed,
    exclusions: ['Cryptographic inference not covered by binding-only test verifier',
      'Finalized market snapshots, graduated-pool agent trades and fee-to-WETH conversion remain to be integrated', 'No external audit or public network deployment'] };
  fs.writeFileSync(path.join(root, 'test-results', 'contracts.json'), `${JSON.stringify(evidence, null, 2)}\n`);
  console.log(`PASS ${passed.length} contract scenarios, ${txCount} successful local EVM transactions`);
} finally { await env.stop(); }
