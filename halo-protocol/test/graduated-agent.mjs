import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { decodeEventLog, encodeAbiParameters, getContractAddress, keccak256, maxUint256, parseEther, toHex, zeroAddress, zeroHash } from 'viem';
import { compile, root } from '../scripts/compile.mjs';
import { startChain } from './helpers.mjs';
import { deploySettlement } from './settlement-fixture.mjs';
import { mineHookSalt } from '../sdk/hook-salt.mjs';
import { proveDecision } from '../sdk/prover.mjs';
import { gasWithHeadroom } from '../sdk/transaction-gas.mjs';
import { identify } from '../sdk/artifacts.mjs';
import { canonicalJson } from '../sdk/manifest.mjs';
import { createOperator } from '../runtime/operator.mjs';
import { createApi } from '../services/api/server.mjs';
import { robinhoodForkConfig } from './robinhood-fork-config.mjs';

const artifacts = process.argv.includes('--no-compile')
  ? Object.fromEntries(fs.readdirSync(path.join(root, 'artifacts')).filter(name => name.endsWith('.json'))
    .map(name => [name.slice(0, -5), JSON.parse(fs.readFileSync(path.join(root, 'artifacts', name)))])) : compile({ test: true });
const preview = process.argv.includes('--preview');
const fork = process.argv.includes('--robinhood-fork') ? await robinhoodForkConfig() : null;
if (fork && preview) throw new Error('The persistent preview must use its own disposable genesis, not a public fork');
if (fork) console.log(`Read-only Robinhood fork at ${fork.forkBlock}; all execution stays on local Anvil`);
const env = await startChain(fork ?? (preview ? { port: 8547 } : {}));
const { client, wallet, accounts } = env;
const [deployer, creator, donor, protocol, operator, copier] = accounts;
const python = process.env.HALO_PYTHON ?? path.join(root, '../../work/halo-python', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
const releaseSha256 = fs.readFileSync(path.join(root, 'models/core-v1/release/manifest.sha256'), 'utf8').trim();
const passed = [], proofs = [];
let transactions = 0;
let previewApi;
const publicBytes = new Map();
// This suite tests content-address integrity in memory; independent IPFS hosting is a separate acceptance gate.
const store = {
  async putBytes(bytes) { const id = await identify(bytes); publicBytes.set(`ipfs://${id.cid}`, bytes); return { ...id, uri: `ipfs://${id.cid}` }; },
  async put(value) { return this.putBytes(Buffer.from(canonicalJson(value))); },
  async get(uri) { assert(publicBytes.has(uri), `Missing artifact ${uri}`); return publicBytes.get(uri); },
};
const read = (address, name, functionName, args = []) => client.readContract({ address, abi: artifacts[name].abi, functionName, args });
async function receipt(hash) {
  const value = await client.waitForTransactionReceipt({ hash });
  assert.equal(value.status, 'success', hash); transactions++; return value;
}
async function send(address, name, functionName, args = [], account = deployer) {
  const { request } = await client.simulateContract({ address, abi: artifacts[name].abi, functionName, args, account });
  return receipt(await wallet.writeContract({ ...request, gas: gasWithHeadroom(await client.estimateContractGas(request)) }));
}
async function deploy(name, args = []) {
  return (await receipt(await wallet.deployContract({ abi: artifacts[name].abi, bytecode: artifacts[name].bytecode, args, account: deployer }))).contractAddress;
}
async function rejects(address, name, functionName, args, reason, account = operator) {
  const selector = keccak256(toHex(`${reason}()`)).slice(0, 10);
  await assert.rejects(() => client.simulateContract({ address, abi: artifacts[name].abi, functionName, args, account }),
    error => error.message.includes(reason) || error.message.includes(selector), `Expected ${reason} from ${name}.${functionName}`);
}
function event(value, name, eventName, address) {
  return value.logs.filter(log => !address || log.address.toLowerCase() === address.toLowerCase())
    .map(log => { try { return decodeEventLog({ abi: artifacts[name].abi, ...log }); } catch { return null; } })
    .find(log => log?.eventName === eventName)?.args;
}
const pass = label => { passed.push(label); console.log(`PASS ${label}`); };
const deadline = async () => (await client.getBlock()).timestamp + 600n;
async function advance(seconds = 901) {
  await client.request({ method: 'evm_increaseTime', params: [seconds] });
  await client.request({ method: 'evm_mine', params: [] });
}
async function sandbox(fn) {
  const id = await client.request({ method: 'evm_snapshot', params: [] });
  try { await fn(); } finally { assert(await client.request({ method: 'evm_revert', params: [id] })); }
}

try {
  const halo = await deploy('TestToken'), weth = await deploy('TestToken');
  const dependency = JSON.parse(fs.readFileSync(path.join(root, 'node_modules/@uniswap/v4-core/out/PoolManager.sol/PoolManager.json')));
  artifacts.UniswapPoolManager = { abi: dependency.abi, bytecode: dependency.bytecode.object };
  const manager = fork?.manager ?? await deploy('UniswapPoolManager', [deployer]);
  if (fork) assert.equal(keccak256(await client.getCode({ address: manager })), fork.evidence.poolManagerCodeHash);
  const deploymentNonce = BigInt(await client.getTransactionCount({ address: deployer, blockTag: 'pending' }));
  const adapterAddress = getContractAddress({ from: deployer, nonce: deploymentNonce });
  const factoryAddress = getContractAddress({ from: deployer, nonce: deploymentNonce + 1n });
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
  const manifest = { version: 'halo.agent.v1', chainId: 31337,
    identity: { name: 'Graduation operator', symbol: 'GRAD', description: 'Public narrative and portfolio test' },
    models: { mode: 'custom-api', core: 'halo-core-v1', releaseSha256, proposalEndpoint: 'https://example.com/test-provider', reproducibility: 'external-provider' },
    policy: { ...policy, workReward: policy.workReward.toString(), childGraduationTarget: policy.childGraduationTarget.toString() },
    fees: { tradingBps: 100, operationsBps: 6000, haloBps: 2000, creator }, graduationTarget: parseEther('1000000').toString() };
  const publishedManifest = await store.put(manifest);
  const created = event(await send(registry, 'AgentRegistry', 'createAgent', ['Graduation operator', 'GRAD',
    publishedManifest.hash, publishedManifest.uri, parseEther('1000000'), policy, fees], creator), 'AgentRegistry', 'AgentCreated');
  const { agent, token, curve } = created;
  const router = await read(agent, 'AgentVault', 'tradeRouter');
  assert.equal(router.toLowerCase(), (await read(market.settlement, 'FeeSettlementRouter', 'tradeRouter')).toLowerCase());
  await send(halo, 'TestToken', 'approve', [curve, maxUint256]);
  await send(curve, 'HaloCurve', 'buy', [parseEther('10000'), 1n, agent, await deadline()]);
  await send(curve, 'HaloCurve', 'buy', [parseEther('100000'), 1n, deployer, await deadline()]);
  await send(weth, 'TestToken', 'transfer', [agent, await read(agent, 'AgentVault', 'reserveRequired', [30n])]);
  await send(agent, 'AgentVault', 'activate', [], creator);
  const initialCapital = await read(agent, 'AgentVault', 'capitalBasis');
  async function action(fields = {}) {
    return { kind: 0, nonce: await read(agent, 'AgentVault', 'nonce'), deadline: await deadline(), child: zeroAddress,
      amount: 0n, minOutput: 0n, beneficiary: operator, evidenceHash: keccak256(toHex('graduated-trade-public-evidence')),
      snapshotId: zeroHash, name: '', symbol: '', metadataURI: '', ...fields };
  }
  async function prove(value, label) {
    const [commitment, facts] = await read(agent, 'AgentVault', 'decisionContext', [value]);
    const proof = await proveDecision({ commitment, facts, python, releaseSha256,
      outputDirectory: path.join(root, 'test-results/graduated-proofs', label) });
    proofs.push({ label, commitment, facts: facts.map(Number), seconds: proof.result.elapsedSeconds });
    return proof;
  }
  async function tradeAction(child, kind, amount) {
    const observed = event(await send(agent, 'AgentVault', 'snapshotTrade', [child, kind, amount], operator), 'AgentVault', 'TradeObserved', agent);
    await client.request({ method: 'evm_mine', params: [] });
    return action({ child, kind, amount, snapshotId: observed.snapshotId,
      minOutput: await read(agent, 'AgentVault', 'minimumSnapshotOutput', [observed.snapshotId]) });
  }
  const narrative = await store.put({ version: 'halo.decision-evidence.v1', chainId: 31337, agent,
    proposal: { sourceIds: [] }, manifestHash: publishedManifest.hash, manifestURI: publishedManifest.uri });
  const launch = await action({ kind: 1, name: 'Persistent child', symbol: 'PERSIST', metadataURI: narrative.uri,
    evidenceHash: `0x${narrative.sha256}` });
  await send(agent, 'AgentVault', 'execute', [launch, (await prove(launch, 'launch')).proof], operator);
  const child = await read(agent, 'AgentVault', 'children', [0n]);
  const childCurve = await read(factory, 'CurveFactory', 'curveOf', [child]);
  await advance();
  const preBuy = await tradeAction(child, 2, parseEther('100'));
  await send(agent, 'AgentVault', 'execute', [preBuy, (await prove(preBuy, 'curve-buy')).proof], operator);
  assert.equal(await read(agent, 'AgentVault', 'positionCost', [child]), preBuy.amount);
  await advance();
  const transition = await tradeAction(child, 2, parseEther('10'));
  const transitionProof = await prove(transition, 'before-graduation');
  await send(token, 'HaloToken', 'approve', [childCurve, maxUint256]);
  const graduation = await send(childCurve, 'HaloCurve', 'buy', [parseEther('2000000'), 1n, deployer, await deadline()]);
  assert.equal(await read(childCurve, 'HaloCurve', 'graduated'), true);
  await rejects(agent, 'AgentVault', 'execute', [transition, transitionProof.proof], 'InvalidSnapshot');
  await rejects(agent, 'AgentVault', 'snapshotTrade', [child, 2, parseEther('1000')], 'InsufficientHistory');
  pass('real curve inventory survives graduation; a pre-graduation proof cannot cross markets and cold pools reject observations');
  const liquidityVault = await read(childCurve, 'HaloCurve', 'liquidityVault');
  const key = await read(liquidityVault, 'LockedLiquidityVault', 'marketKey');
  const poolId = event(graduation, 'V4GraduationAdapter', 'PoolGraduated', adapter).poolId;
  const poolSlot = keccak256(encodeAbiParameters([{ type: 'bytes32' }, { type: 'uint256' }], [poolId, 6n]));
  const poolState = () => read(manager, 'UniswapPoolManager', 'extsload', [poolSlot, 4n]);
  const initialLiquidity = await read(liquidityVault, 'LockedLiquidityVault', 'liquidity');
  await advance(1801);
  const beforeQuote = await poolState();
  const quoteReceipt = await send(router, 'AgentTradeRouter', 'quote', [child, true, parseEther('1000')], donor);
  assert.deepEqual(await poolState(), beforeQuote, 'Even a mined quote must revert all pool price, fee growth and liquidity writes');
  assert.equal(quoteReceipt.logs.length, 0);
  await rejects(router, 'AgentTradeRouter', 'unlockCallback', ['0x'], 'Unauthorized');
  await rejects(router, 'AgentTradeRouter', 'quote', [halo, true, 1n], 'InvalidMarket');
  await rejects(router, 'AgentTradeRouter', 'quote', [child, true, parseEther('100000')], 'InsufficientDepth');
  pass('real v4 quote simulation has no pool, balance or event side effects; arbitrary markets, callbacks and excessive impact are rejected');

  const buy = await tradeAction(child, 2, parseEther('1000'));
  const buyProof = await prove(buy, 'graduated-buy');
  assert.equal(buyProof.result.authorization, 1);
  for (const fields of [{ beneficiary: copier }, { amount: buy.amount + 1n }, { child: token }, { minOutput: 1n }]) {
    await assert.rejects(() => client.simulateContract({ address: agent, abi: artifacts.AgentVault.abi, functionName: 'execute',
      args: [{ ...buy, ...fields }, buyProof.proof], account: copier }));
  }
  await sandbox(async () => {
    const tooStrict = { ...buy, minOutput: maxUint256 };
    const strictProof = await prove(tooStrict, 'exact-output-enforced');
    const before = [await read(agent, 'AgentVault', 'nonce'), await read(token, 'HaloToken', 'balanceOf', [agent]), await poolState()];
    await rejects(agent, 'AgentVault', 'execute', [tooStrict, strictProof.proof], 'InvalidTrade');
    assert.deepEqual([await read(agent, 'AgentVault', 'nonce'), await read(token, 'HaloToken', 'balanceOf', [agent]), await poolState()], before);
  });
  pass('proof bindings reject changed beneficiary, amount, token and weakened minimum; actual output enforcement atomically rejects an impossible floor');
  await sandbox(async () => {
    await send(token, 'HaloToken', 'approve', [market.swapRouter, maxUint256]);
    const zeroForOne = key.currency0.toLowerCase() === token.toLowerCase();
    await send(market.swapRouter, 'UniswapPoolSwapTest', 'swap', [key,
      { zeroForOne, amountSpecified: -parseEther('100000'), sqrtPriceLimitX96: zeroForOne ? 4295128740n : 1461446703485210103287273052203988822378723970341n },
      { takeClaims: false, settleUsingBurn: false }, '0x']);
    assert.equal((await read(agent, 'AgentVault', 'decisionContext', [buy]))[1][9], 0n);
    await rejects(agent, 'AgentVault', 'execute', [buy, buyProof.proof], 'InvalidProof');
    await rejects(agent, 'AgentVault', 'snapshotTrade', [child, 2, parseEther('1000')], 'UnsafeMarket');
  });
  pass('a manipulated graduated pool invalidates the live decision fact and the previously valid proof');
  const beforeParent = await read(token, 'HaloToken', 'balanceOf', [agent]);
  const beforeChild = await read(child, 'HaloToken', 'balanceOf', [agent]);
  const beforeReward = await read(weth, 'TestToken', 'balanceOf', [operator]);
  const bought = await send(agent, 'AgentVault', 'execute', [buy, buyProof.proof], copier);
  const buyEvent = event(bought, 'AgentVault', 'ActionExecuted', agent);
  assert.equal(beforeParent - await read(token, 'HaloToken', 'balanceOf', [agent]), buy.amount);
  assert.equal(await read(child, 'HaloToken', 'balanceOf', [agent]) - beforeChild, buyEvent.result);
  assert(buyEvent.result >= buy.minOutput);
  assert.equal(await read(weth, 'TestToken', 'balanceOf', [operator]), beforeReward + policy.workReward);
  assert.equal(await read(token, 'HaloToken', 'allowance', [agent, router]), 0n);
  assert.equal(await read(agent, 'AgentVault', 'positionCost', [child]), preBuy.amount + buy.amount);
  await rejects(agent, 'AgentVault', 'execute', [buy, buyProof.proof], 'InvalidAction');
  pass('an independent submitter executes a real graduated buy, debits exact trading capital and pays only the proof-bound operator');
  await advance();
  const held = await read(child, 'HaloToken', 'balanceOf', [agent]);
  const sell = await tradeAction(child, 3, held);
  const sellProof = await prove(sell, 'graduated-sell');
  const beforeSale = await read(token, 'HaloToken', 'balanceOf', [agent]);
  const sold = await send(agent, 'AgentVault', 'execute', [sell, sellProof.proof], operator);
  const sellEvent = event(sold, 'AgentVault', 'ActionExecuted', agent);
  assert.equal(await read(child, 'HaloToken', 'balanceOf', [agent]), 0n);
  assert.equal(await read(token, 'HaloToken', 'balanceOf', [agent]) - beforeSale, sellEvent.result);
  assert.equal(await read(agent, 'AgentVault', 'positionCost', [child]), 0n);
  const pnl = sellEvent.result - preBuy.amount - buy.amount;
  assert.equal(await read(agent, 'AgentVault', 'realizedPnl'), pnl);
  assert.equal(await read(agent, 'AgentVault', 'capitalBasis'), initialCapital + pnl);
  assert.equal(await read(child, 'HaloToken', 'allowance', [agent, router]), 0n);
  assert.equal(await read(liquidityVault, 'LockedLiquidityVault', 'liquidity'), initialLiquidity);
  assert.equal(await read(token, 'HaloToken', 'balanceOf', [router]), 0n);
  assert.equal(await read(child, 'HaloToken', 'balanceOf', [router]), 0n);
  pass('the same agent sells curve and graduated inventory through v4 with exact realized P&L and permanently unchanged LP principal');
  await advance();
  const stale = await tradeAction(child, 2, parseEther('1000'));
  stale.deadline = (await client.getBlock()).timestamp + 1200n;
  const staleProof = await prove(stale, 'stale-graduated-snapshot');
  await advance(901);
  await rejects(agent, 'AgentVault', 'execute', [stale, staleProof.proof], 'InvalidSnapshot');
  await rejects(agent, 'AgentVault', 'withdrawBeforeActivation', [token, 1n], 'Unauthorized', creator);
  pass('graduated observations expire and activation still removes the creator withdrawal path');
  const feed = http.createServer((_request, response) => response.end(JSON.stringify([{ name: 'Public orbital project update',
    body: 'A controlled source fixture for a portfolio proposal, not market evidence.',
    published_at: new Date().toISOString(), html_url: 'https://example.com/public-orbital-update' }])));
  await new Promise(resolve => feed.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${feed.address().port}`;
  const runtimeSteps = [], runtimeResults = [];
  let providerKind = 'buy', providerAmount = parseEther('100').toString();
  const configuration = { client, wallet, account: operator, artifacts, store, python,
    directory: path.join(root, 'test-results/graduated-operator'), confirmations: 1, maxGasCostWei: parseEther('0.01'),
    computeCostWei: 0n, minimumMarginWei: 0n, allowLocalLoss: false,
    deployment: { environment: 'local', chainId: 31337, chainName: 'Disposable graduated test', rpcUrl: client.chain.rpcUrls.default.http[0],
      registry, decisionVerifier: verifier, curveFactory: factory, operatingToken: weth, rootHalo: halo,
      feeSettlement: market.settlement, tradeRouter: router, haloSymbol: 'tHALO', operatingSymbol: 'tWETH',
      deploymentBlock: fork?.evidence.forkBlock ?? '0', coreReleaseSha256: releaseSha256 },
    sources: [{ type: 'github-releases', url: origin }], localOrigins: [origin],
    onStep: async value => runtimeSteps.push(value),
    proposalTransport: async (url, options) => {
      assert.equal(url, manifest.models.proposalEndpoint);
      const input = JSON.parse(options.body);
      assert(input.portfolio.children.some(item => item.address.toLowerCase() === child.toLowerCase() && item.graduated));
      assert.equal(input.portfolio.quoteToken.toLowerCase(), token.toLowerCase());
      return { bytes: Buffer.from(JSON.stringify({ version: 'halo.proposal.v1', module: 'controlled-provider-fixture',
        kind: providerKind, name: '', symbol: '', child, amount: providerAmount,
        sourceIds: [input.evidence[0].id], rationale: 'Controlled test proposal for real on-chain portfolio execution.' })) };
    },
  };
  let mineTimer;
  try {
    const runtimeDry = createOperator({ ...configuration, submitTransactions: false });
    const beforeDry = await client.getBlock({ blockTag: 'latest' });
    const dry = await runtimeDry.runCycle(agent);
    assert.equal(dry.status, 'observation-required', JSON.stringify(dry));
    assert.equal((await client.getBlock({ blockTag: 'latest' })).number, beforeDry.number);
    const runtime = createOperator(configuration);
    // Only this disposable local chain gets blocks for the real worker's two-confirmation observation requirement.
    mineTimer = setInterval(() => { client.request({ method: 'evm_mine', params: [] }).catch(() => {}); }, 200);
    const boughtByRuntime = await runtime.runCycle(agent);
    assert.equal(boughtByRuntime.status, 'confirmed', JSON.stringify(boughtByRuntime));
    assert.equal(boughtByRuntime.kind, 'buy');
    assert(BigInt(boughtByRuntime.observationGasCostWei) > 0n);
    assert(BigInt(boughtByRuntime.gasCostWei) < policy.workReward);
    runtimeResults.push(boughtByRuntime); transactions += 2;
    assert.equal((await runtime.runCycle(agent)).status, 'not-due');
    await advance();
    providerKind = 'sell'; providerAmount = (await read(child, 'HaloToken', 'balanceOf', [agent])).toString();
    const soldByRuntime = await runtime.runCycle(agent);
    assert.equal(soldByRuntime.status, 'confirmed', JSON.stringify(soldByRuntime));
    assert.equal(soldByRuntime.kind, 'sell');
    assert.equal(await read(child, 'HaloToken', 'balanceOf', [agent]), 0n);
    runtimeResults.push(soldByRuntime); transactions += 2;
    const publicEvidence = JSON.parse(await store.get(soldByRuntime.evidenceURI));
    assert.equal(publicEvidence.proposal.kind, 'sell');
    assert(publicEvidence.observation.snapshotId && publicEvidence.portfolio.children.length === 1);
    for (const stage of ['observe', 'research', 'propose', 'prove', 'simulate', 'submit', 'confirm'])
      assert(runtimeSteps.some(step => step.stage === stage), stage);
    pass('the real operator consumes typed model proposals, records observations, proves and executes graduated buys and sells with public receipts and both gas costs');
    pass('operator dry runs make zero chain writes and duplicate cycles do not execute twice; the proposal provider is a disclosed test fixture');
  } finally {
    clearInterval(mineTimer);
    await new Promise(resolve => feed.close(resolve));
  }
  fs.writeFileSync(path.join(root, `test-results/graduated-agent${fork ? '-fork' : ''}.json`), JSON.stringify({ completedAt: new Date().toISOString(),
    ...(fork?.evidence ?? {}),
    environment: 'Disposable Anvil 31337; real Uniswap v4 and EZKL; mock HALO and operating token',
    transactions, passed, proofs, runtimeResults, buyGas: bought.gasUsed.toString(), sellGas: sold.gasUsed.toString(), realizedPnl: pnl.toString(),
    exclusions: ['No public-chain transaction, hosted model or sustained profitability test',
      'Pre-graduation discretionary snapshots remain slippage observations, not a market oracle',
      'TWAP bounds do not prove resistance to sustained thin-market manipulation',
      'Proposal inference uses a controlled transport fixture and content-addressed artifacts are held in memory in this suite'] }, null, 2) + '\n');
  console.log(`PASS ${passed.length} graduated-agent scenarios; ${transactions} successful local executions`);
  if (preview) {
    const deployment = { ...configuration.deployment, apiUrl: 'http://127.0.0.1:8789',
      chainName: 'HALO graduated-trading preview', poolManager: manager, graduationAdapter: adapter, hook: mined.address,
      disclosure: 'Disposable local chain, test tokens and controlled proposal fixtures. This is not a continuously running model or public deployment.' };
    previewApi = await createApi({ client, deployment, artifacts, artifactDirectory: path.join(root, 'test-results/trading-artifacts') });
    await previewApi.listen({ host: '127.0.0.1', port: 8789 });
    const state = (await previewApi.inject({ method: 'GET', url: `/v1/agents/${agent}` })).json();
    assert.equal(state.tradeRouter.toLowerCase(), router.toLowerCase());
    assert.equal(state.children[0].graduated, true);
    const history = (await previewApi.inject({ method: 'GET', url: `/v1/agents/${agent}/actions` })).json();
    assert.equal(history.actions.length, Number(state.nonce));
    assert.equal(history.actions[0].kind, 3);
    fs.writeFileSync(path.join(root, '../halo-web/public/deployment-trading.json'), JSON.stringify(deployment, null, 2) + '\n');
    fs.writeFileSync(path.join(root, 'test-results/trading-deployment.json'), JSON.stringify(deployment, null, 2) + '\n');
    fs.writeFileSync(path.join(root, 'test-results/trading-preview.json'), JSON.stringify({ checkedAt: new Date().toISOString(),
      agent, child, state, history, runtimeResults, disclosure: deployment.disclosure }, null, 2) + '\n');
    console.log(`Trading preview ready: http://localhost:5173/agents/${agent}?preview=trading | RPC 8547 | API 8789`);
    await new Promise(resolve => { process.once('SIGINT', resolve); process.once('SIGTERM', resolve); });
  }
} finally { if (previewApi) await previewApi.close(); await env.stop(); }
