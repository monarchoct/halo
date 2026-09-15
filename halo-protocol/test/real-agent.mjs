import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { decodeEventLog, keccak256, maxUint256, parseEther, toHex, zeroAddress, zeroHash } from 'viem';
import { compile, root } from '../scripts/compile.mjs';
import { startChain } from './helpers.mjs';
import { deploySettlement } from './settlement-fixture.mjs';
import { proveDecision } from '../sdk/prover.mjs';
import { gasWithHeadroom } from '../sdk/transaction-gas.mjs';

const artifacts = process.argv.includes('--no-compile')
  ? Object.fromEntries(fs.readdirSync(path.join(root, 'artifacts')).filter(name => name.endsWith('.json'))
    .map(name => [name.slice(0, -5), JSON.parse(fs.readFileSync(path.join(root, 'artifacts', name)))]))
  : compile({ test: true });
const python = process.env.HALO_PYTHON ?? path.join(root, '../../work/halo-python', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
const releaseSha256 = fs.readFileSync(path.join(root, 'models/core-v1/release/manifest.sha256'), 'utf8').trim();
const env = await startChain();
const { client, wallet, accounts } = env;
const [deployer, creator, donor, treasury, operator, copier] = accounts;
const passed = [];
const proofs = [];
let transactions = 0;
const read = (address, contract, functionName, args = []) => client.readContract({ address, abi: artifacts[contract].abi, functionName, args });
async function receipt(hash) {
  const value = await client.waitForTransactionReceipt({ hash });
  assert.equal(value.status, 'success'); transactions++;
  return value;
}
async function send(address, contract, functionName, args = [], account = deployer) {
  const { request } = await client.simulateContract({ address, abi: artifacts[contract].abi, functionName, args, account });
  return receipt(await wallet.writeContract({ ...request, gas: gasWithHeadroom(await client.estimateContractGas(request)) }));
}
async function deploy(name, args = []) {
  return (await receipt(await wallet.deployContract({ abi: artifacts[name].abi, bytecode: artifacts[name].bytecode, args, account: deployer }))).contractAddress;
}
async function rejects(address, contract, functionName, args, reason = 'InvalidProof', account = operator) {
  await assert.rejects(() => client.simulateContract({ address, abi: artifacts[contract].abi, functionName, args, account }),
    error => error.message.includes(reason), `Expected ${reason}`);
}
function event(receipt, contract, name) {
  return receipt.logs.map(log => { try { return decodeEventLog({ abi: artifacts[contract].abi, ...log }); } catch { return null; } })
    .find(log => log?.eventName === name)?.args;
}
const pass = label => { passed.push(label); console.log(`PASS ${label}`); };
async function advance(seconds = 901) {
  await client.request({ method: 'evm_increaseTime', params: [seconds] });
  await client.request({ method: 'evm_mine', params: [] });
}

try {
  const halo = await deploy('TestToken');
  const weth = await deploy('TestToken');
  const migration = await deploy('TestGraduationAdapter');
  const factory = await deploy('CurveFactory', [halo, treasury, migration]);
  const halo2 = await deploy('Halo2Verifier');
  const verifier = await deploy('EzklDecisionVerifier', [halo2]);
  assert.equal(await read(verifier, 'EzklDecisionVerifier', 'VERIFIER_CODE_HASH'), keccak256(await client.getCode({ address: halo2 })));
  const wrongVerifierHash = await wallet.deployContract({ abi: artifacts.EzklDecisionVerifier.abi,
    bytecode: artifacts.EzklDecisionVerifier.bytecode, args: [halo], account: deployer, gas: 5_000_000n });
  assert.equal((await client.waitForTransactionReceipt({ hash: wrongVerifierHash })).status, 'reverted');
  const { settlement } = await deploySettlement({ artifacts, client, accounts, halo, weth, factory, deploy, send, read });
  const registry = await deploy('AgentRegistry', [factory, weth, verifier, settlement]);
  const policy = { maxPositionBps: 1000, maxDailyDebitBps: 1000, maxLaunchesPerDay: 1, maxSlippageBps: 300,
    intervalSeconds: 900, workReward: 1_000_000_000_000n, childGraduationTarget: parseEther('1000000') };
  const fees = { tradingBps: 100, operationsBps: 6000, haloBps: 2000, operations: creator, creator };

  async function createAgent(name) {
    const result = event(await send(registry, 'AgentRegistry', 'createAgent', [name, name.slice(0, 6).toUpperCase(),
      keccak256(toHex(`public-manifest:${name}`)), `ipfs://test-manifest-${name}`, parseEther('1000000'), policy, fees], creator), 'AgentRegistry', 'AgentCreated');
    await send(halo, 'TestToken', 'approve', [result.curve, maxUint256]);
    await send(result.curve, 'HaloCurve', 'buy', [parseEther('10000'), 1n, result.agent, (await client.getBlock()).timestamp + 600n]);
    await send(weth, 'TestToken', 'transfer', [result.agent, await read(result.agent, 'AgentVault', 'reserveRequired', [30n])]);
    await send(result.agent, 'AgentVault', 'activate', [], creator);
    return result;
  }
  const { agent, token, curve } = await createAgent('Fred');
  const other = await createAgent('Nyx');
  async function action(fields = {}) {
    return { kind: 0, nonce: await read(agent, 'AgentVault', 'nonce'), deadline: (await client.getBlock()).timestamp + 1200n,
      child: zeroAddress, amount: 0n, minOutput: 0n, beneficiary: operator,
      evidenceHash: keccak256(toHex('public-narrative-evidence')), snapshotId: zeroHash, name: '', symbol: '', metadataURI: '', ...fields };
  }
  async function prove(value, label, overrides = {}) {
    const [commitment, facts] = await read(agent, 'AgentVault', 'decisionContext', [value]);
    const result = await proveDecision({ commitment, facts, python, releaseSha256,
      outputDirectory: path.join(root, 'test-results/real-actions', label), ...overrides });
    proofs.push({ label, commitment, facts: facts.map(Number), seconds: result.result.elapsedSeconds });
    return result;
  }
  async function trade(fields) {
    const observed = event(await send(agent, 'AgentVault', 'snapshotTrade', [fields.child, fields.kind, fields.amount], operator), 'AgentVault', 'TradeObserved');
    await client.request({ method: 'evm_mine', params: [] });
    return action({ ...fields, snapshotId: observed.snapshotId,
      minOutput: await read(agent, 'AgentVault', 'minimumSnapshotOutput', [observed.snapshotId]) });
  }

  const launch = await action({ kind: 1, name: 'Orbital dogs', symbol: 'ODOG', metadataURI: 'ipfs://orbital-dogs-evidence' });
  const first = await prove(launch, 'launch-one');
  assert.equal(await read(verifier, 'EzklDecisionVerifier', 'verifyDecision', [first.proof, first.result.commitment, Array(10).fill(1n)]), true);
  for (const change of [ { beneficiary: copier }, { evidenceHash: keccak256(toHex('changed')) }, { name: 'Different narrative' } ]) {
    await rejects(agent, 'AgentVault', 'execute', [{ ...launch, ...change }, first.proof]);
  }
  await rejects(other.agent, 'AgentVault', 'execute', [launch, first.proof]);
  const [originalCommitment] = await read(agent, 'AgentVault', 'decisionContext', [launch]);
  await client.request({ method: 'anvil_setChainId', params: [31338] });
  const [foreignCommitment] = await read(agent, 'AgentVault', 'decisionContext', [launch]);
  assert.notEqual(foreignCommitment, originalCommitment);
  await rejects(agent, 'AgentVault', 'execute', [launch, first.proof]);
  await client.request({ method: 'anvil_setChainId', params: [31337] });
  pass('Pinned real verifier accepts the proof; altered beneficiary, narrative, agent and chain are rejected');

  const contextBefore = await read(agent, 'AgentVault', 'decisionContext', [launch]);
  await send(weth, 'TestToken', 'transfer', [agent, 1n]);
  await send(curve, 'HaloCurve', 'buy', [parseEther('1'), 1n, agent, (await client.getBlock()).timestamp + 600n]);
  assert.deepEqual(await read(agent, 'AgentVault', 'decisionContext', [launch]), contextBefore);
  const beforeOperator = await read(weth, 'TestToken', 'balanceOf', [operator]);
  const beforeCopier = await read(weth, 'TestToken', 'balanceOf', [copier]);
  const executed = await send(agent, 'AgentVault', 'execute', [launch, first.proof], copier);
  assert.equal(await read(weth, 'TestToken', 'balanceOf', [operator]), beforeOperator + policy.workReward);
  assert.equal(await read(weth, 'TestToken', 'balanceOf', [copier]), beforeCopier);
  await rejects(agent, 'AgentVault', 'execute', [launch, first.proof], 'InvalidAction');
  const child = await read(agent, 'AgentVault', 'children', [0n]);
  pass('A copied submission executes a real proof but cannot steal the operator payment; donations do not invalidate it');

  await advance();
  const excessiveLaunch = await action({ kind: 1, name: 'Too soon', symbol: 'SOON', metadataURI: 'ipfs://too-soon' });
  const denied = await prove(excessiveLaunch, 'denied-launch');
  assert.equal(denied.result.authorization, 0);
  const direct = await client.simulateContract({ address: halo2, abi: artifacts.Halo2Verifier.abi, functionName: 'verifyProof',
    args: [denied.proof, denied.instances], account: operator });
  assert.equal(direct.result, true, 'Proof of a denied decision is still a valid inference proof');
  await rejects(agent, 'AgentVault', 'execute', [excessiveLaunch, denied.proof]);
  const falseFacts = Array(10).fill(1n); falseFacts[0] = 2n;
  assert.equal(await read(verifier, 'EzklDecisionVerifier', 'verifyDecision', [first.proof, first.result.commitment, falseFacts]), false);
  pass('A cryptographically valid proof of a denied decision cannot authorize spending; non-Boolean facts are rejected');

  const buy = await trade({ kind: 2, child, amount: parseEther('1000') });
  await rejects(agent, 'AgentVault', 'execute', [{ ...buy, minOutput: 1n }, '0x'], 'InvalidSnapshot');
  const bought = await prove(buy, 'buy-child');
  await send(weth, 'TestToken', 'transfer', [agent, 1n]);
  await send(agent, 'AgentVault', 'execute', [buy, bought.proof], operator);
  assert((await read(child, 'HaloToken', 'balanceOf', [agent])) > 0n);
  pass('A real action proof buys the agent’s own child within immutable allocation and snapshot slippage limits');

  await advance();
  const sell = await trade({ kind: 3, child, amount: await read(child, 'HaloToken', 'balanceOf', [agent]) });
  const sold = await prove(sell, 'sell-child');
  await send(agent, 'AgentVault', 'execute', [sell, sold.proof], operator);
  assert.equal(await read(child, 'HaloToken', 'balanceOf', [agent]), 0n);
  assert((await read(agent, 'AgentVault', 'realizedPnl')) < 0n);
  pass('A real sell proof settles proceeds and records the realized loss separately from deposits');

  await advance();
  const stale = await trade({ kind: 2, child, amount: parseEther('1') });
  const staleProof = await prove(stale, 'stale-trade');
  await advance(901);
  await rejects(agent, 'AgentVault', 'execute', [stale, staleProof.proof], 'InvalidSnapshot');
  pass('A previously valid proof is rejected after its recorded quote expires');

  await advance(86400);
  const second = await action({ kind: 1, name: 'Garden computers', symbol: 'GARDEN', metadataURI: 'ipfs://garden-evidence',
    evidenceHash: keccak256(toHex('new-independent-narrative')) });
  const secondProof = await prove(second, 'launch-two');
  await send(agent, 'AgentVault', 'execute', [second, secondProof.proof], operator);
  assert.equal(await read(agent, 'AgentVault', 'childCount'), 2n);
  assert.equal(await read(agent, 'AgentVault', 'totalWorkPaid'), 4n * policy.workReward);
  pass('The same immutable agent launches a second narrative with a fresh proof and pays four completed work cycles');

  const evidence = { completedAt: new Date().toISOString(), environment: 'local Anvil; real EZKL/EVM proofs; mock root and operating assets',
    transactions, releaseSha256, verifierCodeHash: keccak256(await client.getCode({ address: halo2 })),
    firstLaunchGas: String(executed.gasUsed), passed, proofs,
    exclusions: ['The discretionary-trade snapshot is not itself a manipulation-resistant oracle', 'Fee replenishment and graduated discretionary trades are exercised by their separate acceptance suites',
      'No full LLM inference proof, public-network deployment or external audit'] };
  fs.writeFileSync(path.join(root, 'test-results/real-agent.json'), JSON.stringify(evidence, null, 2) + '\n');
  console.log(`PASS ${passed.length} real-proof agent scenarios; ${transactions} successful local transactions`);
} finally { await env.stop(); }
