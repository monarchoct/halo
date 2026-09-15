import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { decodeEventLog, getContractAddress, keccak256, maxUint256, parseEther, toHex, zeroAddress, zeroHash } from 'viem';
import { root } from './compile.mjs';
import { startChain } from '../test/helpers.mjs';
import { deploySettlement } from '../test/settlement-fixture.mjs';
import { mineHookSalt } from '../sdk/hook-salt.mjs';
import { proveDecision } from '../sdk/prover.mjs';
import { createApi } from '../services/api/server.mjs';
import { jsonSafe } from '../sdk/chain-reader.mjs';
import { gasWithHeadroom } from '../sdk/transaction-gas.mjs';
import { createSettlementWorker } from '../runtime/settlement-worker.mjs';

// Always creates its own loopback-only Anvil. There is no configurable live RPC or private key in this script.
const settlementPreview = process.argv.includes('--settlement-preview');
const rpcPort = settlementPreview ? 8546 : 8545;
const apiPort = settlementPreview ? 8788 : 8787;
const profile = settlementPreview ? 'settlement' : 'local';
const env = await startChain({ port: rpcPort });
const { client, wallet, accounts } = env;
const [deployer, creator, , treasury, operator] = accounts;
const artifacts = Object.fromEntries(fs.readdirSync(path.join(root, 'artifacts')).filter(name => name.endsWith('.json'))
  .map(name => [name.slice(0, -5), JSON.parse(fs.readFileSync(path.join(root, 'artifacts', name)))]));
const python = process.env.HALO_PYTHON ?? path.resolve(root, '../../work/halo-python', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
const releaseSha256 = fs.readFileSync(path.join(root, 'models/core-v1/release/manifest.sha256'), 'utf8').trim();
let api;
async function receipt(hash) { const value = await client.waitForTransactionReceipt({ hash }); assert.equal(value.status, 'success'); return value; }
async function deploy(name, args = []) { return (await receipt(await wallet.deployContract({ account: deployer, abi: artifacts[name].abi, bytecode: artifacts[name].bytecode, args }))).contractAddress; }
const read = (address, contract, functionName, args = []) => client.readContract({ address, abi: artifacts[contract].abi, functionName, args });
async function send(address, contract, functionName, args = [], account = deployer) {
  const { request } = await client.simulateContract({ address, abi: artifacts[contract].abi, functionName, args, account });
  return receipt(await wallet.writeContract({ ...request, gas: gasWithHeadroom(await client.estimateContractGas(request)) }));
}
function event(value, contract, name) {
  return value.logs.map(log => { try { return decodeEventLog({ abi: artifacts[contract].abi, ...log }); } catch { return null; } })
    .find(log => log?.eventName === name).args;
}
try {
  console.log('Preparing local HALO chain, real curve contracts and the pinned cryptographic verifier…');
  const halo = await deploy('HaloToken', ['Local HALO', 'HALO', deployer]);
  const weth = await deploy('HaloToken', ['Local operating token', 'tWETH', deployer]);
  const managerArtifact = JSON.parse(fs.readFileSync(path.join(root, 'node_modules/@uniswap/v4-core/out/PoolManager.sol/PoolManager.json')));
  artifacts.UniswapPoolManager = { abi: managerArtifact.abi, bytecode: managerArtifact.bytecode.object };
  const manager = await deploy('UniswapPoolManager', [deployer]);
  const nonce = BigInt(await client.getTransactionCount({ address: deployer, blockTag: 'pending' }));
  const expectedAdapter = getContractAddress({ from: deployer, nonce });
  const expectedFactory = getContractAddress({ from: deployer, nonce: nonce + 1n });
  const mined = mineHookSalt({ adapter: expectedAdapter, manager, hookBytecode: artifacts.HaloPoolHook.bytecode });
  const adapter = await deploy('V4GraduationAdapter', [manager, expectedFactory, mined.salt]);
  const factory = await deploy('CurveFactory', [halo, treasury, adapter]);
  assert.equal(factory.toLowerCase(), expectedFactory.toLowerCase());
  const halo2 = await deploy('Halo2Verifier');
  const verifier = await deploy('EzklDecisionVerifier', [halo2]);
  const { settlement, reference } = await deploySettlement({ artifacts, client, accounts, halo, weth, factory, deploy, send, read, manager });
  const registry = await deploy('AgentRegistry', [factory, weth, verifier, settlement]);
  const deployment = { version: 1, environment: 'local', chainId: 31337, chainName: 'HALO local development',
    rpcUrl: `http://127.0.0.1:${rpcPort}`, apiUrl: `http://127.0.0.1:${apiPort}`, registry, curveFactory: factory,
    decisionVerifier: verifier, operatingToken: weth, rootHalo: halo, deploymentBlock: '0',
    poolManager: manager, graduationAdapter: adapter, hook: mined.address, feeSettlement: settlement, rootReferenceMarket: reference,
    tradeRouter: await read(settlement, 'FeeSettlementRouter', 'tradeRouter'),
    operatingSymbol: 'tWETH', haloSymbol: 'HALO',
    coreReleaseSha256: releaseSha256, demoCreator: creator, demoOperator: operator,
    disclosure: 'Local test assets and seeded narrative fixtures. No mainnet value, public hosting or autonomous LLM research is implied.' };
  const policy = { maxPositionBps: 1000, maxDailyDebitBps: 1000, maxLaunchesPerDay: 2, maxSlippageBps: 300,
    intervalSeconds: 900, workReward: parseEther(settlementPreview ? '0.01' : '0.000001'), childGraduationTarget: parseEther('1000000') };
  const fees = { tradingBps: 100, operationsBps: 6000, haloBps: 2000, operations: creator, creator };
  const fixtures = [ { name: 'Fred', symbol: 'FRED', children: [['Orbital dogs', 'ODOG'], ['Garden computers', 'GARDEN']] },
    { name: 'Nyx', symbol: 'NYX', children: [['Moon archive', 'ARCHIVE']] }, { name: 'Atlas', symbol: 'ATLAS', children: [['Tiny observatories', 'TINY']] } ];
  for (const fixture of fixtures) {
    const created = event(await send(registry, 'AgentRegistry', 'createAgent', [fixture.name, fixture.symbol,
      keccak256(toHex(`HALO_LOCAL_FIXTURE:${fixture.name}`)), `https://example.invalid/local-fixture/${fixture.symbol}`,
      parseEther('1000000'), policy, fees], creator), 'AgentRegistry', 'AgentCreated');
    await send(halo, 'HaloToken', 'approve', [created.curve, maxUint256]);
    await send(created.curve, 'HaloCurve', 'buy', [parseEther('10000'), 1n, created.agent, (await client.getBlock()).timestamp + 600n]);
    await send(weth, 'HaloToken', 'transfer', [created.agent, await read(created.agent, 'AgentVault', 'reserveRequired', [30n])]);
    await send(created.agent, 'AgentVault', 'activate', [], creator);
    for (const [name, symbol] of fixture.children) {
      const action = { kind: 1, nonce: await read(created.agent, 'AgentVault', 'nonce'), deadline: (await client.getBlock()).timestamp + 1200n,
        child: zeroAddress, amount: 0n, minOutput: 0n, beneficiary: operator,
        evidenceHash: keccak256(toHex(`Explicit local narrative fixture: ${name}`)), snapshotId: zeroHash,
        name, symbol, metadataURI: `https://example.invalid/local-fixture/${symbol}` };
      const [commitment, facts] = await read(created.agent, 'AgentVault', 'decisionContext', [action]);
      const proof = await proveDecision({ commitment, facts, python, releaseSha256,
        outputDirectory: path.join(root, 'test-results/dev-stack-proofs', symbol) });
      await send(created.agent, 'AgentVault', 'execute', [action, proof.proof], operator);
      const child = await read(created.agent, 'AgentVault', 'children', [BigInt(fixture.children.findIndex(value => value[1] === symbol))]);
      const childCurve = await read(factory, 'CurveFactory', 'curveOf', [child]);
      await send(created.curve, 'HaloCurve', 'buy', [parseEther('1000'), 1n, deployer, (await client.getBlock()).timestamp + 600n]);
      await send(created.token, 'HaloToken', 'approve', [childCurve, parseEther('25000')]);
      await send(childCurve, 'HaloCurve', 'buy', [parseEther('25000'), 1n, deployer, (await client.getBlock()).timestamp + 600n]);
      await client.request({ method: 'evm_increaseTime', params: [901] }); await client.request({ method: 'evm_mine', params: [] });
    }
    console.log(`Seeded ${fixture.name}: ${fixture.children.length} child tokens launched through real proofs`);
  }
  // Fund only disposable local accounts for browser tests. Never use these public development accounts on real chains.
  for (const account of accounts.slice(1, 4)) {
    await send(halo, 'HaloToken', 'transfer', [account, parseEther('100000')]);
    await send(weth, 'HaloToken', 'transfer', [account, parseEther('1')]);
  }
  const settlementWorker = createSettlementWorker({ client, wallet, account: operator, deployment, artifacts,
    maxGasCostWei: parseEther('0.1'), minimumMarginWei: 0n, confirmations: 1, submitTransactions: true });
  const initialSettlement = await settlementWorker.runRound({ limit: 3 });
  fs.writeFileSync(path.join(root, `test-results/${profile}-settlement-worker.json`), JSON.stringify(initialSettlement, null, 2) + '\n');
  api = await createApi({ client, deployment, artifacts, artifactDirectory: path.join(root, `test-results/${profile}-artifacts`) });
  await api.listen({ host: '127.0.0.1', port: apiPort });
  const status = await api.inject({ method: 'GET', url: '/v1/status' }); assert.equal(status.statusCode, 200);
  const agents = await api.inject({ method: 'GET', url: '/v1/agents' });
  assert.equal(agents.statusCode, 200, agents.body); assert.equal(agents.json().agents.length, 3);
  for (const agent of agents.json().agents) {
    const result = await api.inject({ method: 'GET', url: `/v1/agents/${agent.address}/actions` });
    assert.equal(result.statusCode, 200); assert.equal(result.json().actions.length, Number(agent.childCount));
  }
  assert.equal((await api.inject({ method: 'GET', url: '/v1/agents/not-an-address' })).statusCode, 400);
  assert.equal((await api.inject({ method: 'GET', url: '/v1/agents?limit=1000' })).statusCode, 400);
  fs.writeFileSync(path.join(root, `../halo-web/public/${settlementPreview ? 'deployment-settlement' : 'deployment'}.json`), JSON.stringify(deployment, null, 2) + '\n');
  fs.writeFileSync(path.join(root, `test-results/${profile}-deployment.json`), JSON.stringify(deployment, null, 2) + '\n');
  fs.writeFileSync(path.join(root, `test-results/${profile}-api.json`), JSON.stringify(jsonSafe({ checkedAt: new Date().toISOString(),
    status: status.json(), agents: agents.json().agents.map(value => ({ name: value.name, address: value.address, children: value.childCount })),
    passed: ['Live API projections match chain state', 'Action history matches real proof executions', 'Malformed addresses and oversized pages rejected'] }), null, 2) + '\n');
  console.log(`HALO ${profile} stack ready: RPC http://127.0.0.1:${rpcPort} · API http://127.0.0.1:${apiPort}`);
  await new Promise(resolve => { process.once('SIGINT', resolve); process.once('SIGTERM', resolve); });
} finally { if (api) await api.close(); await env.stop(); }
