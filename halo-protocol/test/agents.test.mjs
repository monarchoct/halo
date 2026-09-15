import assert from 'node:assert/strict';
import { decodeEventLog, encodeAbiParameters, keccak256, maxUint256, parseEther, toHex, zeroAddress } from 'viem';
import { deploySettlement } from './settlement-fixture.mjs';

export async function runAgentScenarios({ artifacts, client, accounts, rootToken, factory, deploy, send, read, rejects, pass }) {
  const [deployer, creator, , protocol, operator] = accounts;
  const weth = await deploy('TestToken');
  const verifier = await deploy('TestDecisionVerifier');
  const { settlement } = await deploySettlement({ artifacts, client, accounts, halo: rootToken, weth, factory, deploy, send, read });
  const registry = await deploy('AgentRegistry', [factory, weth, verifier, settlement]);
  const policy = { maxPositionBps: 1000, maxDailyDebitBps: 1000, maxLaunchesPerDay: 1,
    maxSlippageBps: 300,
    intervalSeconds: 900, workReward: 1_000_000_000_000n, childGraduationTarget: parseEther('1000000') };
  const fees = { tradingBps: 100, operationsBps: 6000, haloBps: 2000, operations: creator, creator };
  const manifestHash = keccak256(toHex('test-only-public-manifest:multi-narrative-deployer'));
  const created = await send(registry, 'AgentRegistry', 'createAgent', ['Narrative scout', 'SCOUT', manifestHash,
    'ipfs://test-agent-manifest', parseEther('1000000'), policy, fees], creator);
  const createdEvent = created.logs.map(log => {
    try { return decodeEventLog({ abi: artifacts.AgentRegistry.abi, ...log }); } catch { return null; }
  }).find(log => log?.eventName === 'AgentCreated');
  assert(createdEvent);
  const { agent, token, curve } = createdEvent.args;
  assert.equal(await read(registry, 'AgentRegistry', 'isAgent', [agent]), true);
  assert.equal(await read(agent, 'AgentVault', 'active'), false);
  await rejects(agent, 'AgentVault', 'activate', [], 'FundingRequired', creator);
  await rejects(agent, 'AgentVault', 'activate', [], 'Unauthorized', operator);
  await send(rootToken, 'TestToken', 'approve', [curve, maxUint256]);
  const deadline = (await client.getBlock()).timestamp + 3600n;
  await send(curve, 'HaloCurve', 'buy', [parseEther('10000'), 1n, agent, deadline]);
  const minimumReserve = await read(agent, 'AgentVault', 'reserveRequired', [30n]);
  assert.equal(minimumReserve, 30n * 96n * policy.workReward);
  await send(weth, 'TestToken', 'transfer', [agent, minimumReserve]);
  await send(agent, 'AgentVault', 'activate', [], creator);
  assert.equal(await read(agent, 'AgentVault', 'active'), true);
  await rejects(agent, 'AgentVault', 'activate', [], 'InvalidState', creator);
  await rejects(agent, 'AgentVault', 'withdrawBeforeActivation', [weth, 1n], 'Unauthorized', creator);
  pass('agent creation and activation require trading capital plus 30 days of work reserve');

  async function advance(seconds = 901) {
    await client.request({ method: 'evm_increaseTime', params: [seconds] });
    await client.request({ method: 'evm_mine', params: [] });
  }
  async function action(fields = {}) {
    return { kind: 0, nonce: await read(agent, 'AgentVault', 'nonce'), deadline: (await client.getBlock()).timestamp + 1200n,
      child: zeroAddress, snapshotId: `0x${'00'.repeat(32)}`, amount: 0n, minOutput: 0n, beneficiary: operator,
      evidenceHash: keccak256(toHex('test-evidence:public-artifact')), name: '', symbol: '', metadataURI: '', ...fields };
  }
  async function proofFor(value) {
    const [commitment, state] = await read(agent, 'AgentVault', 'decisionContext', [value]);
    return encodeAbiParameters([{ type: 'bytes32' }, { type: 'bytes32' }],
      [commitment, keccak256(encodeAbiParameters([{ type: 'uint256[]' }], [state]))]);
  }
  async function tradeAction(fields) {
    const receipt = await send(agent, 'AgentVault', 'snapshotTrade', [fields.child, fields.kind, fields.amount], operator);
    const observed = receipt.logs.map(log => {
      try { return decodeEventLog({ abi: artifacts.AgentVault.abi, ...log }); } catch { return null; }
    }).find(log => log?.eventName === 'TradeObserved');
    await client.request({ method: 'evm_mine', params: [] });
    return action({ ...fields, snapshotId: observed.args.snapshotId,
      minOutput: await read(agent, 'AgentVault', 'minimumSnapshotOutput', [observed.args.snapshotId]) });
  }
  const first = await action({ kind: 1, name: 'Orbital dogs', symbol: 'ODOG', metadataURI: 'ipfs://narrative-orbital-dogs' });
  await rejects(agent, 'AgentVault', 'execute', [first, '0x'], 'InvalidProof', operator);
  const firstProof = await proofFor(first);
  await rejects(agent, 'AgentVault', 'execute', [{ ...first, beneficiary: protocol }, firstProof], 'InvalidProof', operator);
  const beforeOperator = await read(weth, 'TestToken', 'balanceOf', [operator]);
  await send(agent, 'AgentVault', 'execute', [first, firstProof], operator);
  assert.equal(await read(weth, 'TestToken', 'balanceOf', [operator]), beforeOperator + policy.workReward);
  const firstChild = await read(agent, 'AgentVault', 'children', [0n]);
  assert.equal((await read(factory, 'CurveFactory', 'parentOf', [firstChild])).toLowerCase(), token.toLowerCase());
  assert.equal((await read(factory, 'CurveFactory', 'deployerOf', [firstChild])).toLowerCase(), agent.toLowerCase());
  await rejects(agent, 'AgentVault', 'execute', [first, firstProof], 'InvalidAction', operator);
  const early = await action();
  await rejects(agent, 'AgentVault', 'execute', [early, await proofFor(early)], 'IntervalNotElapsed', operator);
  pass('permissionless executor launches an agent-owned child and is paid; altered beneficiaries and replay rejected (test verifier)');

  await advance();
  const secondSameDay = await action({ kind: 1, name: 'Second narrative', symbol: 'SECOND', metadataURI: 'ipfs://second' });
  await rejects(agent, 'AgentVault', 'execute', [secondSameDay, await proofFor(secondSameDay)], 'LimitExceeded', operator);
  const basis = await read(agent, 'AgentVault', 'capitalBasis');
  const excess = await tradeAction({ kind: 2, child: firstChild, amount: basis * 1001n / 10000n, minOutput: 1n });
  await rejects(agent, 'AgentVault', 'execute', [excess, await proofFor(excess)], 'LimitExceeded', operator);
  const buy = await tradeAction({ kind: 2, child: firstChild, amount: parseEther('1000'), minOutput: 1n });
  await send(agent, 'AgentVault', 'execute', [buy, await proofFor(buy)], operator);
  const held = await read(firstChild, 'HaloToken', 'balanceOf', [agent]);
  assert(held > 0n);
  const childCurve = await read(factory, 'CurveFactory', 'curveOf', [firstChild]);
  assert.equal(await read(token, 'HaloToken', 'allowance', [agent, childCurve]), 0n);
  await advance();
  const sell = await tradeAction({ kind: 3, child: firstChild, amount: held, minOutput: 1n });
  await send(agent, 'AgentVault', 'execute', [sell, await proofFor(sell)], operator);
  assert.equal(await read(firstChild, 'HaloToken', 'balanceOf', [agent]), 0n);
  assert.equal(await read(agent, 'AgentVault', 'positionCost', [firstChild]), 0n);
  assert((await read(agent, 'AgentVault', 'realizedPnl')) < 0n);
  pass('position and daily limits enforced; curve trades update cost basis and realized losses');

  await advance(86400);
  const second = await action({ kind: 1, name: 'Garden computers', symbol: 'GARDEN', metadataURI: 'ipfs://narrative-garden-computers',
    evidenceHash: keccak256(toHex('distinct-narrative-evidence')) });
  await send(agent, 'AgentVault', 'execute', [second, await proofFor(second)], operator);
  assert.equal(await read(agent, 'AgentVault', 'childCount'), 2n);
  const secondChild = await read(agent, 'AgentVault', 'children', [1n]);
  assert.notEqual(secondChild, firstChild);
  assert.equal((await read(factory, 'CurveFactory', 'parentOf', [secondChild])).toLowerCase(), token.toLowerCase());
  assert.notEqual(await read(agent, 'AgentVault', 'narrativeEvidence', [firstChild]), await read(agent, 'AgentVault', 'narrativeEvidence', [secondChild]));
  assert.equal(await read(agent, 'AgentVault', 'totalWorkPaid'), 4n * policy.workReward);
  pass('one activated agent creates multiple independently recorded narratives and child coins across work cycles');

  const publicFunctions = artifacts.AgentVault.abi.filter(item => item.type === 'function').map(item => item.name);
  for (const forbidden of ['pause', 'unpause', 'upgradeTo', 'setPolicy', 'setVerifier', 'rescue', 'withdraw', 'setOwner']) {
    assert(!publicFunctions.includes(forbidden));
  }
  assert.equal((await read(agent, 'AgentVault', 'decisionVerifier')).toLowerCase(), verifier.toLowerCase());
  pass('activated agent has no exposed pause, upgrade, verifier replacement or treasury withdrawal function');
}
