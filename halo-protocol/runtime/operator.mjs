import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { decodeEventLog, keccak256, toHex, zeroAddress, zeroHash } from 'viem';
import { chainReader, jsonSafe } from '../sdk/chain-reader.mjs';
import { agentManifestSchema, canonicalJson } from '../sdk/manifest.mjs';
import { safeFetch } from '../sdk/safe-fetch.mjs';
import { evidenceUri } from '../sdk/artifacts.mjs';
import { runPublicPython } from '../sdk/python-process.mjs';
import { proveDecision } from '../sdk/prover.mjs';
import { collectEvidence } from './research.mjs';
import { customProposal, proposalSchema } from './proposals.mjs';
import { assertSupportedDeployment } from '../sdk/networks.mjs';
import { gasWithHeadroom } from '../sdk/transaction-gas.mjs';
import { prepareTradeObservation } from './trade-observation.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

/** Permissionless executor. Its signer pays gas; it has no privileged agent role. */
export function createOperator({ client, wallet, account, deployment, artifacts, store, python, directory,
  sources, localOrigins = [], manifestHints = {}, confirmations = 2, computeCostWei = 0n, minimumMarginWei = 0n,
  maxGasCostWei, allowLocalLoss = false, submitTransactions = true, onStep = async () => {}, proposalTransport, publicModels = [] }) {
  assertSupportedDeployment(deployment);
  if (!account || !maxGasCostWei || BigInt(maxGasCostWei) <= 0n) throw new Error('Explicit operator account and gas-cost limit are required');
  if (allowLocalLoss && (deployment.environment !== 'local' || deployment.chainId !== 31337)) throw new Error('Loss-making test work is restricted to local Anvil');
  const beneficiary = typeof account === 'string' ? account : account.address;
  const reader = chainReader({ client, deployment, artifacts });
  const inFlight = new Set();
  const read = (address, name, fn, args = []) => client.readContract({ address, abi: artifacts[name].abi, functionName: fn, args });
  const record = (folder, name, value) => {
    fs.mkdirSync(folder, { recursive: true });
    const destination = path.join(folder, `${name}.json`), temporary = `${destination}.${crypto.randomUUID()}.tmp`;
    fs.writeFileSync(temporary, canonicalJson(jsonSafe(value))); fs.renameSync(temporary, destination);
  };
  async function createdEvent(agent, toBlock) {
    for (let fromBlock = BigInt(deployment.deploymentBlock); fromBlock <= toBlock; fromBlock += 5000n) {
      const values = await client.getContractEvents({ address: deployment.registry, abi: artifacts.AgentRegistry.abi,
        eventName: 'AgentCreated', args: { agent }, fromBlock, toBlock: fromBlock + 4999n < toBlock ? fromBlock + 4999n : toBlock, strict: true });
      if (values.length) return values[0];
    }
    throw new Error('Agent creation is not yet confirmed');
  }
  async function manifestFor(state, toBlock) {
    const event = await createdEvent(state.address, toBlock);
    let uri = manifestHints[state.manifestHash] ?? event.args.manifestURI;
    let bytes;
    try { bytes = uri.startsWith('ipfs://') ? await store.get(uri) : (await safeFetch(uri, { localOrigins })).bytes; }
    catch (error) {
      // Older local agents used an HTTP manifest URL. Their first public launch can carry a recoverable copy.
      if (BigInt(state.childCount) === 0n) throw error;
      const firstChild = await read(state.address, 'AgentVault', 'children', [0n]);
      const digest = await read(state.address, 'AgentVault', 'narrativeEvidence', [firstChild]);
      const prior = JSON.parse(await store.get(evidenceUri(digest)));
      if (prior.manifestHash !== state.manifestHash || !prior.manifestURI?.startsWith('ipfs://')) throw error;
      uri = prior.manifestURI;
      bytes = await store.get(uri);
    }
    if (keccak256(toHex(bytes)) !== state.manifestHash) throw new Error('Manifest does not match its on-chain commitment');
    const manifest = agentManifestSchema.parse(JSON.parse(bytes));
    if (manifest.chainId !== deployment.chainId || manifest.models.releaseSha256 !== deployment.coreReleaseSha256
      || manifest.identity.name !== state.name || manifest.identity.symbol !== state.symbol
      || BigInt(manifest.graduationTarget) !== state.market.target) throw new Error('Manifest identity or decision release differs from the chain');
    for (const [key, value] of Object.entries(manifest.policy)) if (BigInt(value) !== BigInt(state.policy[key])) throw new Error(`Manifest policy differs at ${key}`);
    for (const key of ['tradingBps', 'operationsBps', 'haloBps']) if (manifest.fees[key] !== state.fees[key]) throw new Error(`Manifest fees differ at ${key}`);
    if (manifest.fees.creator.toLowerCase() !== state.fees.creator.toLowerCase()) throw new Error('Manifest payout differs from the chain');
    const publication = await store.putBytes(bytes);
    return { manifest, publication };
  }
  async function sourceHistory(state) {
    const usedSources = [];
    if (BigInt(state.childCount) > 10000n) throw new Error('Agent history exceeds this operator’s configured capacity');
    // Reconstruct from every on-chain child, not the API's paginated projection or a private memory file.
    for (let index = 0n; index < BigInt(state.childCount); index++) {
      const child = await read(state.address, 'AgentVault', 'children', [index]);
      const digest = await read(state.address, 'AgentVault', 'narrativeEvidence', [child]);
      const evidence = JSON.parse(await store.get(evidenceUri(digest)));
      if (evidence.version !== 'halo.decision-evidence.v1' || evidence.agent.toLowerCase() !== state.address.toLowerCase()
        || evidence.chainId !== deployment.chainId || !Array.isArray(evidence.proposal?.sourceIds)) throw new Error('Prior narrative evidence cannot be recovered');
      usedSources.push(...evidence.proposal.sourceIds);
    }
    return [...new Set(usedSources)];
  }
  async function runCycle(agent, { expectedNonce, beforeSubmit = async () => {}, onSubmitted = async () => {} } = {}) {
    const key = agent.toLowerCase();
    if (inFlight.has(key)) return { status: 'already-running', agent };
    inFlight.add(key);
    const started = Date.now();
    let folder;
    let traceNonce;
    const runId = crypto.randomUUID();
    const step = async (stage, summary, extra = {}) => {
      if (traceNonce === undefined) return;
      try { await onStep({ runId, agent, nonce: traceNonce.toString(), stage, summary, ...extra }); }
      catch { /* Public reporting availability must not become an execution authority. */ }
    };
    try {
      await reader.status();
      const block = await client.getBlock();
      const safeBlock = block.number >= BigInt(confirmations) ? block.number - BigInt(confirmations) : 0n;
      const state = await reader.agent(agent, block.number);
      if (expectedNonce !== undefined && state.nonce !== BigInt(expectedNonce)) return { status: 'superseded', agent, nonce: state.nonce.toString() };
      if (!state.active) return { status: 'not-active', agent };
      if (state.lastExecutedAt !== 0n && block.timestamp < state.lastExecutedAt + BigInt(state.policy.intervalSeconds)) return { status: 'not-due', agent };
      if (state.operatingBalance < state.policy.workReward) return { status: 'unfunded', agent };
      traceNonce = state.nonce;
      await step('observe', 'Reading the immutable policy, treasury and confirmed creation record.');
      const { manifest, publication } = await manifestFor(state, safeBlock);
      // Keep the process working directory below Windows' process-creation path limit.
      folder = path.resolve(directory, `${deployment.chainId}-${key.slice(2, 10)}-${state.nonce}-${crypto.randomUUID().slice(0, 8)}`);
      const history = await sourceHistory(state);
      await step('research', 'Retrieving public sources and recovering prior token narratives from IPFS.');
      const research = await collectEvidence({ store, sources, localOrigins, now: new Date(Number(block.timestamp) * 1000) });
      if (!research.evidence.length) { await step('skip', 'No retrievable public evidence is available. No action was submitted.'); return { status: 'no-evidence', agent, unavailable: research.unavailable }; }
      const [dayIndex, dailyLaunches, sevenDays, dailyDebit] = await Promise.all([read(agent, 'AgentVault', 'dayIndex'),
        read(agent, 'AgentVault', 'dailyLaunches'), read(agent, 'AgentVault', 'reserveRequired', [7n]), read(agent, 'AgentVault', 'dailyDebit')]);
      const launches = dayIndex === block.timestamp / 86400n ? dailyLaunches : 0n;
      const request = { interests: manifest.identity.description, evidence: research.evidence, usedSources: history,
        canLaunch: launches < BigInt(state.policy.maxLaunchesPerDay) && state.operatingBalance >= sevenDays + state.policy.workReward };
      if (manifest.models.mode !== 'public-baseline') request.portfolio = jsonSafe({
        quoteToken: state.agentToken, quoteSymbol: state.symbol, tradingBalance: state.tradingBalance,
        capitalBasis: state.capitalBasis, realizedPnl: state.realizedPnl, policy: state.policy,
        dailyDebit: dayIndex === block.timestamp / 86400n ? dailyDebit : 0n,
        canIncreaseExposure: state.operatingBalance >= sevenDays + state.policy.workReward,
        complete: BigInt(state.children.length) === state.childCount,
        children: state.children.map(item => ({ address: item.address, name: item.name, symbol: item.symbol,
          balance: item.balance, costBasis: item.costBasis, graduated: item.graduated, curve: item.curve,
          quoteToken: item.quote, decimals: item.decimals, quoteDecimals: item.quoteDecimals })),
        amountConvention: 'Integer raw input units: parent token for buy, child token for sell. Routes and output floors are selected by contracts.' });
      record(folder, 'proposal-input', request);
      const script = path.join(root, 'runtime/propose.py');
      let proposal, inference = null;
      if (manifest.models.mode === 'public-model') {
        const model = publicModels.find(item => item.releaseSha256 === manifest.models.proposalReleaseSha256);
        if (!model) throw new Error('This operator does not serve the committed public proposal release');
        const generated = await model.generate(request);
        proposal = proposalSchema.parse(generated.proposal);
        const release = await store.putBytes(model.bytes);
        const files = [];
        for (const file of model.sourceFiles) files.push({ path: file.name, ...(await store.putBytes(file.bytes)) });
        const bundle = await store.put({ version: 'halo.proposal-bundle.v1', releaseSha256: model.releaseSha256, releaseURI: release.uri,
          files, weights: 'Retrieved from the immutable revision and SHA-256 in assets.lock.json. Independent full-weight replication remains a hosting requirement.' });
        const transcript = await store.put(generated.transcript);
        inference = { releaseSha256: model.releaseSha256, releaseURI: release.uri, bundleURI: bundle.uri, transcriptURI: transcript.uri,
          modelSha256: model.release.assets.modelSha256, elapsedSeconds: generated.transcript.elapsedSeconds };
        record(folder, 'inference', inference);
        record(folder, 'proposal', proposal);
      } else if (manifest.models.mode === 'custom-api') {
        proposal = await customProposal(manifest.models.proposalEndpoint, request, { transport: proposalTransport });
        record(folder, 'proposal', proposal);
      } else {
        await runPublicPython({ python, script, directory: folder, args: ['--request', path.join(folder, 'proposal-input.json'), '--output', path.join(folder, 'proposal.json')] });
        proposal = proposalSchema.parse(JSON.parse(fs.readFileSync(path.join(folder, 'proposal.json'))));
      }
      const launch = proposal.kind === 'launch';
      const trade = proposal.kind === 'buy' || proposal.kind === 'sell';
      if (!Array.isArray(proposal.sourceIds)
        || proposal.sourceIds.some(id => !research.evidence.some(item => item.id === id) || (launch && history.includes(id)))) throw new Error('Proposal refers to unavailable or previously launched sources');
      if (launch && (!request.canLaunch || !proposal.sourceIds.length || Buffer.byteLength(proposal.name) > 64 || !/^[A-Z0-9]{1,12}$/.test(proposal.symbol))) throw new Error('Proposal exceeds its launch envelope');
      if (trade && (!state.children.some(item => item.address.toLowerCase() === proposal.child.toLowerCase())
        || (proposal.kind === 'buy' && !request.portfolio.canIncreaseExposure))) throw new Error('Proposal exceeds its owned portfolio or reserve envelope');
      let observation = null;
      if (trade) {
        const position = state.children.find(item => item.address.toLowerCase() === proposal.child.toLowerCase());
        const amount = BigInt(proposal.amount);
        const debit = dayIndex === block.timestamp / 86400n ? dailyDebit : 0n;
        if (proposal.kind === 'buy' ? amount > state.tradingBalance
          || amount + debit > state.capitalBasis * BigInt(state.policy.maxDailyDebitBps) / 10000n
          || amount + position.costBasis > state.capitalBasis * BigInt(state.policy.maxPositionBps) / 10000n
          : amount > position.balance) throw new Error('Trade exceeds the immutable allocation or owned balance');
        observation = await prepareTradeObservation({ client, wallet, account, agent, abi: artifacts.AgentVault.abi,
          child: proposal.child, kind: proposal.kind === 'buy' ? 2 : 3, amount: BigInt(proposal.amount), nonce: state.nonce,
          graduated: position.graduated,
          submitTransactions, confirmations, maxGasCostWei, reward: state.policy.workReward, computeCostWei, minimumMarginWei,
          allowLocalLoss, beforeSubmit, record: (name, value) => record(folder, name, value) });
        if (observation.status !== 'observed') {
          await step('skip', observation.status === 'observation-required'
            ? 'Dry run: the trade needs a confirmed on-chain observation before proving. No transaction was submitted.'
            : 'The trade observation exceeds the operator cost budget. No transaction was submitted.');
          return jsonSafe({ ...observation, agent });
        }
      }
      const evidence = await store.put({ version: 'halo.decision-evidence.v1', chainId: deployment.chainId, registry: deployment.registry,
        agent: state.address, nonce: state.nonce.toString(), manifestHash: state.manifestHash, manifestURI: publication.uri,
        observedBlock: block.number.toString(), observedBlockHash: block.hash, observedAt: block.timestamp.toString(),
        proposalModuleSha256: manifest.models.mode === 'public-baseline' ? sha(fs.readFileSync(script)) : null,
        modelMode: manifest.models.mode, proposalEndpoint: manifest.models.proposalEndpoint, inference,
        proposal, portfolio: request.portfolio ?? null, observation: observation ? jsonSafe(observation) : null,
        sources: research.evidence, unavailable: research.unavailable,
        disclosure: 'Advisory proposal. Source existence is observed, source truth, provider inference and market demand are not proven.' });
      await step('propose', launch ? `Proposed ${proposal.name}: ${proposal.rationale}` : proposal.rationale, { evidenceURI: evidence.uri });
      const action = { kind: launch ? 1 : proposal.kind === 'buy' ? 2 : proposal.kind === 'sell' ? 3 : 0,
        nonce: state.nonce, deadline: (await client.getBlock()).timestamp + 600n,
        child: trade ? proposal.child : zeroAddress, amount: trade ? BigInt(proposal.amount) : 0n,
        minOutput: observation?.minOutput ?? 0n, beneficiary,
        // SHA-256 raw-block convention makes the evidence CID recoverable from the event, including Hold actions.
        evidenceHash: `0x${evidence.sha256}`, snapshotId: observation?.snapshotId ?? zeroHash,
        name: launch ? proposal.name : '', symbol: launch ? proposal.symbol : '', metadataURI: launch ? evidence.uri : '' };
      const [commitment, facts] = await read(agent, 'AgentVault', 'decisionContext', [action]);
      if (!facts.every(value => value === 1n)) { await step('skip', 'The current contract policy rejected this proposal.'); return { status: 'policy-denied', agent, facts: facts.map(Number) }; }
      await step('prove', 'Generating the committed ONNX decision-core proof. This does not prove the advisory model’s reasoning.');
      const proof = await proveDecision({ commitment, facts, python, releaseSha256: deployment.coreReleaseSha256, outputDirectory: path.join(folder, 'proof') });
      record(folder, 'prepared', { action, commitment, evidence, manifest: publication, proofResult: proof.result });
      // Recheck the observation block before spending operator gas. Vault checks the latest live state again.
      if ((await client.getBlock({ blockNumber: block.number })).hash !== block.hash) throw new Error('Observed block was reorganized');
      await step('simulate', 'Simulating the exact transaction and checking this operator’s gas and compute budget.');
      const call = { account, address: agent, abi: artifacts.AgentVault.abi, functionName: 'execute', args: [action, proof.proof] };
      const { request: transaction } = await client.simulateContract(call);
      const estimatedGas = await client.estimateContractGas(call);
      const gas = gasWithHeadroom(estimatedGas);
      const estimate = await client.estimateFeesPerGas();
      const maxFeePerGas = estimate.maxFeePerGas ?? estimate.gasPrice;
      const observationGasCost = observation?.gasCostWei ?? 0n;
      const gasCeiling = gas * maxFeePerGas + observationGasCost;
      if (gasCeiling > BigInt(maxGasCostWei)) { await step('skip', 'The transaction exceeds this operator’s gas budget.'); return { status: 'gas-budget-exceeded', agent, gasCeiling: gasCeiling.toString() }; }
      if (!allowLocalLoss && state.policy.workReward < gasCeiling + BigInt(computeCostWei) + BigInt(minimumMarginWei)) { await step('skip', 'The committed reward does not cover this operator’s estimated costs. No transaction was submitted.'); return { status: 'unprofitable', agent, gasCeiling: gasCeiling.toString(), reward: state.policy.workReward.toString() }; }
      if (!submitTransactions) { await step('skip', 'Dry run complete: proof and simulation passed; transaction submission is disabled.'); return jsonSafe({ status: 'ready', agent, action, evidenceURI: evidence.uri, gasCeiling, proofSeconds: proof.result.elapsedSeconds }); }
      await beforeSubmit({ agent, nonce: state.nonce.toString(), commitment });
      const hash = await wallet.writeContract({ ...transaction, gas, ...estimate });
      record(folder, 'submitted', { transactionHash: hash, action, evidence, gasCeiling });
      await onSubmitted(hash);
      await step('submit', 'Transaction submitted. Waiting for the chain receipt.', { transactionHash: hash, evidenceURI: evidence.uri });
      const receipt = await client.waitForTransactionReceipt({ hash, confirmations: Math.max(1, confirmations), timeout: 60000 });
      if (receipt.status !== 'success') throw new Error('Operator action reverted');
      const executed = receipt.logs.filter(log => log.address.toLowerCase() === agent.toLowerCase())
        .map(log => { try { return decodeEventLog({ abi: artifacts.AgentVault.abi, ...log }); } catch { return null; } })
        .find(event => event?.eventName === 'ActionExecuted' && event.args.actionCommitment === commitment);
      if (!executed || executed.args.beneficiary.toLowerCase() !== beneficiary.toLowerCase() || executed.args.workReward !== state.policy.workReward
        || executed.args.nonce !== action.nonce || executed.args.kind !== action.kind || executed.args.amount !== action.amount
        || executed.args.evidenceHash !== action.evidenceHash || (trade && executed.args.child.toLowerCase() !== action.child.toLowerCase())
        || (await client.getBlock({ blockNumber: receipt.blockNumber })).hash !== receipt.blockHash)
        throw new Error('Receipt does not confirm the canonical committed work and beneficiary');
      const result = jsonSafe({ status: 'confirmed', agent, transactionHash: hash, blockNumber: receipt.blockNumber, blockHash: receipt.blockHash,
        nonce: state.nonce, kind: proposal.kind, child: executed.args.child, name: proposal.name, evidenceURI: evidence.uri,
        operator: beneficiary, workReward: executed.args.workReward, gasUsed: receipt.gasUsed,
        gasCostWei: receipt.gasUsed * receipt.effectiveGasPrice + observationGasCost,
        observationGasCostWei: observationGasCost, observationTransactionHash: observation?.transactionHash ?? null,
        amount: action.amount, output: executed.args.result,
        computeBudgetWei: BigInt(computeCostWei), inference, totalSeconds: (Date.now() - started) / 1000, proofSeconds: proof.result.elapsedSeconds });
      record(folder, 'confirmed', result);
      await step('confirm', launch ? `${proposal.name} was launched and the operator was paid.`
        : trade ? `The ${proposal.kind} settled and the operator was paid.` : 'Hold completed and the operator was paid.',
        { transactionHash: hash, evidenceURI: evidence.uri });
      try { result.receiptURI = (await store.put({ version: 'halo.operator-receipt.v1', ...result })).uri; }
      catch { result.publicReceiptPending = true; }
      return result;
    } catch (error) {
      const cause = typeof error.walk === 'function' ? error.walk(value => !!value.data?.errorName) : undefined;
      const result = { status: 'retryable-error', agent, error: error.shortMessage ?? error.message,
        ...(cause?.data?.errorName ? { contractError: cause.data.errorName } : {}) };
      if (folder) record(folder, 'error', result);
      await step('error', cause?.data?.errorName ? `Contract rejected the action: ${cause.data.errorName}.` : 'The operator could not complete this cycle. Inspect its public outcome and retry conditions.');
      return result;
    } finally { inFlight.delete(key); }
  }
  async function runRound({ offset = 0, limit = 20 } = {}) {
    const count = Number(await read(deployment.registry, 'AgentRegistry', 'agentCount'));
    const results = [];
    for (let index = offset; index < Math.min(count, offset + limit); index++) results.push(await runCycle(await read(deployment.registry, 'AgentRegistry', 'agents', [BigInt(index)])));
    return { total: count, nextOffset: offset + results.length >= count ? 0 : offset + results.length, results };
  }
  return { runCycle, runRound };
}
