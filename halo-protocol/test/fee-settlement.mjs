import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { decodeEventLog, getContractAddress, keccak256, maxUint256, parseEther, toHex, zeroAddress, zeroHash } from 'viem';
import { compile, root } from '../scripts/compile.mjs';
import { startChain } from './helpers.mjs';
import { deploySettlement } from './settlement-fixture.mjs';
import { mineHookSalt } from '../sdk/hook-salt.mjs';
import { proveDecision } from '../sdk/prover.mjs';
import { gasWithHeadroom } from '../sdk/transaction-gas.mjs';
import { createSettlementWorker } from '../runtime/settlement-worker.mjs';
import { chainReader } from '../sdk/chain-reader.mjs';

const artifacts = process.argv.includes('--no-compile')
  ? Object.fromEntries(fs.readdirSync(path.join(root, 'artifacts')).filter(name => name.endsWith('.json'))
    .map(name => [name.slice(0, -5), JSON.parse(fs.readFileSync(path.join(root, 'artifacts', name)))]))
  : compile({ test: true });
const env = await startChain();
const { client, wallet, accounts } = env;
const [deployer, creator, donor, protocol, operator, keeper] = accounts;
const passed = [];
let transactions = 0;
const read = (address, name, functionName, args = []) => client.readContract({ address, abi: artifacts[name].abi, functionName, args });
async function receipt(hash) {
  const value = await client.waitForTransactionReceipt({ hash });
  assert.equal(value.status, 'success', hash); transactions++;
  return value;
}
async function send(address, name, functionName, args = [], account = deployer) {
  const { request } = await client.simulateContract({ address, abi: artifacts[name].abi, functionName, args, account });
  return receipt(await wallet.writeContract({ ...request, gas: gasWithHeadroom(await client.estimateContractGas(request)) }));
}
async function deploy(name, args = []) {
  return (await receipt(await wallet.deployContract({ abi: artifacts[name].abi, bytecode: artifacts[name].bytecode, args, account: deployer }))).contractAddress;
}
async function rejects(address, name, functionName, args, reason, account = keeper) {
  const selector = keccak256(toHex(`${reason}()`)).slice(0, 10);
  await assert.rejects(() => client.simulateContract({ address, abi: artifacts[name].abi, functionName, args, account }),
    error => error.message.includes(reason) || error.message.includes(selector), `Expected ${reason} from ${name}.${functionName}`);
}
function event(value, name, eventName) {
  return value.logs.map(log => { try { return decodeEventLog({ abi: artifacts[name].abi, ...log }); } catch { return null; } })
    .find(log => log?.eventName === eventName)?.args;
}
const pass = label => { passed.push(label); console.log(`PASS ${label}`); };
const deadline = async () => (await client.getBlock()).timestamp + 600n;
async function advance(seconds = 1801) {
  await client.request({ method: 'evm_increaseTime', params: [seconds] });
  await client.request({ method: 'evm_mine', params: [] });
}
async function sandbox(fn) {
  const id = await client.request({ method: 'evm_snapshot', params: [] });
  try { await fn(); } finally { assert(await client.request({ method: 'evm_revert', params: [id] })); }
}

try {
  const halo = await deploy('TestToken');
  const weth = await deploy('TestToken');
  const dependency = JSON.parse(fs.readFileSync(path.join(root, 'node_modules/@uniswap/v4-core/out/PoolManager.sol/PoolManager.json')));
  artifacts.UniswapPoolManager = { abi: dependency.abi, bytecode: dependency.bytecode.object };
  const manager = await deploy('UniswapPoolManager', [deployer]);
  const nonce = BigInt(await client.getTransactionCount({ address: deployer, blockTag: 'pending' }));
  const adapterAddress = getContractAddress({ from: deployer, nonce });
  const factoryAddress = getContractAddress({ from: deployer, nonce: nonce + 1n });
  const mined = mineHookSalt({ adapter: adapterAddress, manager, hookBytecode: artifacts.HaloPoolHook.bytecode });
  const adapter = await deploy('V4GraduationAdapter', [manager, factoryAddress, mined.salt]);
  const factory = await deploy('CurveFactory', [halo, protocol, adapter]);
  const market = await deploySettlement({ artifacts, client, accounts, halo, weth, factory, deploy, send, read, manager });
  const halo2 = await deploy('Halo2Verifier');
  const verifier = await deploy('EzklDecisionVerifier', [halo2]);
  const registry = await deploy('AgentRegistry', [factory, weth, verifier, market.settlement]);
  const policy = { maxPositionBps: 1000, maxDailyDebitBps: 1000, maxLaunchesPerDay: 2, maxSlippageBps: 300,
    intervalSeconds: 900, workReward: parseEther('0.01'), childGraduationTarget: parseEther('1000000') };
  const fees = { tradingBps: 100, operationsBps: 6000, haloBps: 2000, operations: creator, creator };
  const created = event(await send(registry, 'AgentRegistry', 'createAgent', ['Fee-funded scout', 'SCOUT',
    keccak256(toHex('public-test-fee-funded-agent')), 'ipfs://fee-settlement-test', parseEther('1000000'), policy, fees], creator),
  'AgentRegistry', 'AgentCreated');
  const { agent, token, curve } = created;
  const treasury = await read(agent, 'AgentVault', 'feeTreasury');
  const splitter = await read(curve, 'HaloCurve', 'feeSplitter');
  assert.equal((await read(splitter, 'FeeSplitter', 'operations')).toLowerCase(), treasury.toLowerCase());
  assert.equal((await read(treasury, 'AgentFeeTreasury', 'agent')).toLowerCase(), agent.toLowerCase());
  await send(halo, 'TestToken', 'approve', [curve, maxUint256]);
  await send(curve, 'HaloCurve', 'buy', [parseEther('10000'), 1n, agent, await deadline()]);
  await send(curve, 'HaloCurve', 'buy', [parseEther('1000'), 1n, deployer, await deadline()]);
  const rootEarned = await read(splitter, 'FeeSplitter', 'claimable', [treasury]);
  assert(rootEarned > 0n);
  await send(splitter, 'FeeSplitter', 'claim', [treasury], donor);
  await send(agent, 'AgentVault', 'claimFees', [token], keeper);
  assert.equal(await read(treasury, 'AgentFeeTreasury', 'pending', [halo]), rootEarned);
  await send(agent, 'AgentVault', 'claimFees', [token], keeper);
  assert.equal(await read(treasury, 'AgentFeeTreasury', 'pending', [halo]), rootEarned);
  await send(halo, 'TestToken', 'transfer', [treasury, parseEther('500')]);
  assert.equal(await read(treasury, 'AgentFeeTreasury', 'pending', [halo]), rootEarned);
  await rejects(treasury, 'AgentFeeTreasury', 'claimFees', [halo], 'InvalidSource');
  await rejects(treasury, 'AgentFeeTreasury', 'settle', [halo, rootEarned, 0n, await deadline()], 'InvalidSettlement');
  pass('agent operations use an isolated treasury; third-party claims reconcile once and direct donations are not counted as fees');

  const required = await read(agent, 'AgentVault', 'reserveRequired', [30n]);
  await send(weth, 'TestToken', 'transfer', [agent, required]);
  await send(agent, 'AgentVault', 'activate', [], creator);
  await rejects(treasury, 'AgentFeeTreasury', 'settle', [halo, rootEarned + 1n, 0n, await deadline()], 'InvalidSettlement');
  await rejects(treasury, 'AgentFeeTreasury', 'settle', [halo, rootEarned, 0n, await deadline()], 'InsufficientHistory');
  await rejects(market.settlement, 'FeeSettlementRouter', 'unlockCallback', ['0x'], 'Unauthorized');
  assert.equal(await read(treasury, 'AgentFeeTreasury', 'pending', [halo]), rootEarned);
  pass('cold markets and unauthorized callbacks reject conversion atomically and leave fees pending');
  await advance();

  const tradingBefore = await read(token, 'HaloToken', 'balanceOf', [agent]);
  const capitalBefore = await read(agent, 'AgentVault', 'capitalBasis');
  const operatingBefore = await read(weth, 'TestToken', 'balanceOf', [agent]);
  const keeperBefore = await read(weth, 'TestToken', 'balanceOf', [keeper]);
  await rejects(treasury, 'AgentFeeTreasury', 'settle', [halo, rootEarned, maxUint256, await deadline()], 'InvalidConversion');
  const converted = await send(treasury, 'AgentFeeTreasury', 'settle', [halo, rootEarned, 0n, await deadline()], keeper);
  const funded = event(converted, 'AgentFeeTreasury', 'OperatingFunded');
  assert(funded.netOutput > policy.workReward);
  assert.equal(await read(weth, 'TestToken', 'balanceOf', [agent]), operatingBefore + funded.netOutput);
  assert.equal(await read(weth, 'TestToken', 'balanceOf', [keeper]), keeperBefore + funded.keeperPayment);
  assert.equal(await read(treasury, 'AgentFeeTreasury', 'pending', [halo]), 0n);
  await rejects(treasury, 'AgentFeeTreasury', 'settle', [halo, rootEarned, 0n, await deadline()], 'InvalidSettlement');
  assert.equal(await read(halo, 'TestToken', 'balanceOf', [treasury]), parseEther('500'));
  assert.equal(await read(halo, 'TestToken', 'allowance', [treasury, market.settlement]), 0n);
  assert.equal(await read(token, 'HaloToken', 'balanceOf', [agent]), tradingBefore);
  assert.equal(await read(agent, 'AgentVault', 'capitalBasis'), capitalBefore);
  const conversionGasCost = converted.gasUsed * converted.effectiveGasPrice;
  assert(funded.keeperPayment > conversionGasCost, 'This local fixture must cover its converter gas from fee proceeds');
  pass('real curve fees sell through the HALO/operating-token v4 pool; only the fixed agent and bounded keeper receive output');

  const action = { kind: 1, nonce: 0n, deadline: await deadline(), child: zeroAddress, amount: 0n, minOutput: 0n,
    beneficiary: operator, evidenceHash: keccak256(toHex('public-fee-funded-child-evidence')), snapshotId: zeroHash,
    name: 'Fee-funded narrative', symbol: 'NARR', metadataURI: 'ipfs://fee-funded-child-test' };
  const [commitment, facts] = await read(agent, 'AgentVault', 'decisionContext', [action]);
  const releaseSha256 = fs.readFileSync(path.join(root, 'models/core-v1/release/manifest.sha256'), 'utf8').trim();
  const python = process.env.HALO_PYTHON ?? path.join(root, '../../work/halo-python', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
  const proof = await proveDecision({ commitment, facts, python, releaseSha256,
    outputDirectory: path.join(root, 'test-results/fee-settlement-proof') });
  const operatorBefore = await read(weth, 'TestToken', 'balanceOf', [operator]);
  const executed = await send(agent, 'AgentVault', 'execute', [action, proof.proof], operator);
  const workGasCost = executed.gasUsed * executed.effectiveGasPrice;
  assert(policy.workReward > workGasCost, 'This local fixture must cover the launch gas reward');
  assert.equal(await read(weth, 'TestToken', 'balanceOf', [operator]), operatorBefore + policy.workReward);
  assert.equal(await read(weth, 'TestToken', 'balanceOf', [agent]), operatingBefore + funded.netOutput - policy.workReward);
  assert(funded.netOutput - policy.workReward > 0n);
  pass('converted fee proceeds exceed a subsequent real EZKL-authorized child launch reward and both local transaction gas costs');

  const child = event(executed, 'AgentVault', 'ChildLaunched').token;
  const childCurve = await read(factory, 'CurveFactory', 'curveOf', [child]);
  const childSplitter = await read(childCurve, 'HaloCurve', 'feeSplitter');
  assert.equal((await read(childSplitter, 'FeeSplitter', 'operations')).toLowerCase(), treasury.toLowerCase());
  await send(token, 'HaloToken', 'approve', [childCurve, maxUint256]);
  await send(childCurve, 'HaloCurve', 'buy', [parseEther('10000'), 1n, deployer, await deadline()]);
  await send(treasury, 'AgentFeeTreasury', 'claimFees', [child], keeper);
  const childEarned = await read(treasury, 'AgentFeeTreasury', 'pending', [token]);
  assert(childEarned > 0n);
  const firstParentConversion = await send(treasury, 'AgentFeeTreasury', 'settle', [token, childEarned, 0n, await deadline()], keeper);
  assert(event(firstParentConversion, 'AgentFeeTreasury', 'OperatingFunded').netOutput > 0n);
  assert.equal(await read(token, 'HaloToken', 'balanceOf', [agent]), tradingBefore);
  assert.equal(await read(agent, 'AgentVault', 'capitalBasis'), capitalBefore);
  assert.equal(await read(token, 'HaloToken', 'allowance', [market.settlement, curve]), 0n);
  pass('child fees convert from agent token through its live curve and HALO reference pool without touching agent trading capital');

  await send(curve, 'HaloCurve', 'buy', [parseEther('2000'), 1n, deployer, await deadline()]);
  await send(treasury, 'AgentFeeTreasury', 'claimFees', [token], keeper);
  const pending = await read(treasury, 'AgentFeeTreasury', 'pending', [halo]);
  const unchanged = async () => assert.equal(await read(treasury, 'AgentFeeTreasury', 'pending', [halo]), pending);
  await sandbox(async () => {
    await send(market.swapRouter, 'UniswapPoolSwapTest', 'swap', [market.key,
      { zeroForOne: market.rootIsZero, amountSpecified: -parseEther('100000'),
        sqrtPriceLimitX96: market.rootIsZero ? 4295128740n : 1461446703485210103287273052203988822378723970341n },
      { takeClaims: false, settleUsingBurn: false }, '0x']);
    await rejects(treasury, 'AgentFeeTreasury', 'settle', [halo, pending, 0n, await deadline()], 'UnsafeMarket');
    await unchanged();
  });
  pass('a sudden reference-market price manipulation cannot be used to execute fee settlement');

  await sandbox(async () => {
    await send(market.liquidityRouter, 'UniswapPoolModifyLiquidityTest', 'modifyLiquidity', [market.key,
      { ...market.liquidity, liquidityDelta: -(market.liquidity.liquidityDelta * 9999n / 10000n) }, '0x']);
    await rejects(treasury, 'AgentFeeTreasury', 'settle', [halo, pending, 0n, await deadline()], 'InsufficientDepth');
    await unchanged();
  });
  pass('withdrawn reference liquidity prevents conversion; the router checks pool depth rather than aggregate manager balances');

  await sandbox(async () => {
    await advance(7201);
    await rejects(treasury, 'AgentFeeTreasury', 'settle', [halo, pending, 0n, await deadline()], 'UnsafeMarket');
    await unchanged();
    const id = keccak256((await import('viem')).encodeAbiParameters([
      { type: 'address' }, { type: 'address' }, { type: 'uint24' }, { type: 'int24' }, { type: 'address' }],
    [market.key.currency0, market.key.currency1, market.key.fee, market.key.tickSpacing, market.key.hooks]));
    await send(market.hook, 'HaloPoolHook', 'checkpoint', [id], keeper);
    await advance();
    await send(treasury, 'AgentFeeTreasury', 'settle', [halo, pending, 0n, await deadline()], keeper);
  });
  pass('stale history leaves fees pending; anyone can rebuild a current observation window and resume settlement');

  await send(curve, 'HaloCurve', 'buy', [parseEther('2000000'), 1n, deployer, await deadline()]);
  assert.equal(await read(curve, 'HaloCurve', 'graduated'), true);
  const vault = await read(curve, 'HaloCurve', 'liquidityVault');
  const locked = await read(vault, 'LockedLiquidityVault', 'liquidity');
  await send(childCurve, 'HaloCurve', 'buy', [parseEther('10000'), 1n, deployer, await deadline()]);
  await send(treasury, 'AgentFeeTreasury', 'claimFees', [child], keeper);
  const afterGraduation = await read(treasury, 'AgentFeeTreasury', 'pending', [token]);
  await rejects(treasury, 'AgentFeeTreasury', 'settle', [token, afterGraduation, 0n, await deadline()], 'InsufficientHistory');
  await advance();
  const graduatedConversion = await send(treasury, 'AgentFeeTreasury', 'settle', [token, afterGraduation, 0n, await deadline()], keeper);
  assert(event(graduatedConversion, 'AgentFeeTreasury', 'OperatingFunded').netOutput > 0n);
  assert.equal(await read(vault, 'LockedLiquidityVault', 'liquidity'), locked);
  assert.equal(await read(token, 'HaloToken', 'balanceOf', [agent]), tradingBefore);
  pass('the same immutable treasury switches to the official graduated agent/HALO v4 pool once its own oracle window is ready');

  const deployment = { environment: 'local', chainId: 31337, rpcUrl: client.chain.rpcUrls.default.http[0],
    registry, curveFactory: factory, operatingToken: weth, rootHalo: halo, feeSettlement: market.settlement, haloSymbol: 'tHALO' };
  const workerOptions = { client, wallet, account: keeper, deployment, artifacts, maxGasCostWei: parseEther('0.1'), confirmations: 1 };
  const beforeDryRun = (await client.getBlock()).number;
  const dryRun = await createSettlementWorker(workerOptions).runAgent(agent);
  assert(dryRun.results.some(result => result.status === 'ready'));
  assert.equal((await client.getBlock()).number, beforeDryRun);
  const tooExpensive = await createSettlementWorker({ ...workerOptions, minimumMarginWei: parseEther('1') }).runAgent(agent);
  assert(tooExpensive.results.some(result => result.status === 'unprofitable'));
  assert.equal((await client.getBlock()).number, beforeDryRun);
  const lowBudget = await createSettlementWorker({ ...workerOptions, maxGasCostWei: 1n }).runAgent(agent);
  assert(lowBudget.results.some(result => result.status === 'gas-budget-exceeded'));
  await assert.rejects(() => createSettlementWorker({ ...workerOptions,
    deployment: { ...deployment, feeSettlement: creator } }).runAgent(agent), /mismatch/);
  await rejects(treasury, 'AgentFeeTreasury', 'collect', [Array(17).fill({ token, baseToConvert: 0n }), await deadline()], 'InvalidSource');
  const beforeWorker = await read(treasury, 'AgentFeeTreasury', 'totalOperatingReceived');
  const workerRound = await createSettlementWorker({ ...workerOptions, submitTransactions: true }).runAgent(agent);
  const confirmed = workerRound.results.find(result => result.status === 'confirmed');
  assert(confirmed, JSON.stringify(workerRound));
  assert(BigInt(confirmed.keeperPayment) > BigInt(confirmed.gasCostWei));
  assert((await read(treasury, 'AgentFeeTreasury', 'totalOperatingReceived')) > beforeWorker);
  assert.equal(await read(token, 'HaloToken', 'balanceOf', [agent]), tradingBefore);
  const projected = await chainReader({ client, deployment, artifacts }).agent(agent);
  assert.equal(projected.feeAccounting.treasury.toLowerCase(), treasury.toLowerCase());
  assert.equal(projected.feeAccounting.totalOperatingReceived, await read(treasury, 'AgentFeeTreasury', 'totalOperatingReceived'));
  assert.equal(projected.feeAccounting.totalKeeperPaid, await read(treasury, 'AgentFeeTreasury', 'totalKeeperPaid'));
  assert.equal(projected.feeAccounting.completeSources, true);
  for (const balance of projected.feeAccounting.balances) {
    assert.equal(balance.pending, await read(treasury, 'AgentFeeTreasury', 'pending', [balance.address]));
    assert.equal(balance.decimals, 18);
  }
  assert(!(await chainReader({ client, deployment, artifacts }).agents()).agents[0].feeAccounting,
    'Directory reads must not request every fee source; accounting is a detail projection');
  pass('the real independent settlement worker quotes without writes, skips uneconomic work, bounds batch size and completes an atomic paid conversion');

  const evidence = { completedAt: new Date().toISOString(), environment: 'Disposable Anvil 31337; real Uniswap v4 and EZKL; mock HALO and operating token',
    harnessTransactions: transactions, workerTransactions: workerRound.results.filter(result => result.status === 'confirmed').length,
    transactions: transactions + workerRound.results.filter(result => result.status === 'confirmed').length,
    passed, workerRound, deployed: { registry, factory, settlement: market.settlement, reference: market.reference, agent, treasury, child },
    localFeeFundedCycle: { inputHalo: rootEarned.toString(), grossOperating: funded.grossOutput.toString(), netOperating: funded.netOutput.toString(),
      keeperPayment: funded.keeperPayment.toString(), conversionGasCostWei: conversionGasCost.toString(),
      workReward: policy.workReward.toString(), workGasCostWei: workGasCost.toString(), proofSeconds: proof.result.elapsedSeconds,
      conversionHash: converted.transactionHash, actionHash: executed.transactionHash },
    exclusions: ['Not a sustained profitability benchmark or a public-chain transaction', 'Initial reserve and reference liquidity are externally funded',
      'The proof verifies the small admissibility core, not LLM authorship', 'Production scheduler operation and real WETH deployment remain separate acceptance gates'] };
  fs.writeFileSync(path.join(root, 'test-results/fee-settlement.json'), JSON.stringify(evidence, null, 2) + '\n');
  console.log(`PASS ${passed.length} settlement scenarios; ${evidence.transactions} successful local executions`);
} finally { await env.stop(); }
