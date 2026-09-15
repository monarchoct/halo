import { decodeEventLog, getAddress, keccak256, toHex } from 'viem';
import { assertSupportedDeployment } from '../sdk/networks.mjs';
import { gasWithHeadroom } from '../sdk/transaction-gas.mjs';
import { jsonSafe } from '../sdk/chain-reader.mjs';

const same = (a, b) => a.toLowerCase() === b.toLowerCase();
const historyError = keccak256(toHex('InsufficientHistory()')).slice(0, 10);

/** Permissionless mechanical work. All collected funds and swap destinations are fixed by the agent's contracts. */
export function createSettlementWorker({ client, wallet, account, deployment, artifacts, maxGasCostWei,
  minimumMarginWei = 0n, confirmations = 2, submitTransactions = false }) {
  assertSupportedDeployment(deployment);
  if (!account || BigInt(maxGasCostWei ?? 0) <= 0n) throw new Error('Settlement requires a gas-paying account and explicit gas budget');
  const keeper = getAddress(typeof account === 'string' ? account : account.address);
  const read = (address, contract, functionName, args = []) => client.readContract({ address, abi: artifacts[contract].abi, functionName, args });
  const running = new Set();

  async function sourcesFor(agent, agentToken) {
    const count = Number(await read(agent, 'AgentVault', 'childCount'));
    if (!Number.isSafeInteger(count) || count < 0) throw new Error('Invalid child count');
    const block = await client.getBlock();
    // Rotate deterministic pages so older agents with many children do not starve later token markets.
    const page = count ? Number((block.timestamp / 900n) % BigInt(Math.ceil(count / 15))) : 0;
    const children = await Promise.all(Array.from({ length: Math.min(15, Math.max(0, count - page * 15)) },
      (_, i) => read(agent, 'AgentVault', 'children', [BigInt(page * 15 + i)])));
    return Promise.all([agentToken, ...children].map(async token => {
      const curve = await read(deployment.curveFactory, 'CurveFactory', 'curveOf', [token]);
      const parent = await read(curve, 'HaloCurve', 'quote');
      let baseToConvert = 0n;
      if (await read(curve, 'HaloCurve', 'graduated')) {
        const vault = await read(curve, 'HaloCurve', 'liquidityVault');
        const [pending, collection] = await Promise.all([
          read(vault, 'LockedLiquidityVault', 'unconvertedBaseFees'),
          client.simulateContract({ address: vault, abi: artifacts.LockedLiquidityVault.abi, functionName: 'collectFees', account }),
        ]);
        baseToConvert = pending + collection.result[1];
      }
      return { token, parent, baseToConvert };
    }));
  }

  async function settleAsset(agent, treasury, asset, sources) {
    let batch = sources.map(({ token, baseToConvert }) => ({ token, baseToConvert }));
    const deadline = (await client.getBlock()).timestamp + 300n;
    const collectCall = () => ({ address: treasury, abi: artifacts.AgentFeeTreasury.abi, functionName: 'collect', args: [batch, deadline], account });
    let collected;
    // Oversized LP fees can be collected in bounded pieces; a cold/unsafe base market can still yield quote fees.
    for (let attempt = 0; attempt < 8; attempt++) {
      try { collected = (await client.simulateContract(collectCall())).result; break; }
      catch (error) {
        if (!batch.some(item => item.baseToConvert > 0n)) throw error;
        const abandonBase = attempt >= 6 || error.message.includes(historyError) || error.message.includes('InsufficientHistory');
        batch = batch.map(item => ({ ...item, baseToConvert: abandonBase ? 0n : item.baseToConvert / 2n }));
      }
    }
    if (!collected) return { status: 'collection-unavailable', agent, asset };
    let amount = collected[same(asset, deployment.rootHalo) ? 0 : 1];
    if (amount === 0n) return { status: 'no-convertible-fees', agent, asset };
    let quoted;
    let call;
    // Never force a large sale. Simulations use the actual contracts' depth, price and backing checks.
    for (let attempt = 0; attempt < 12 && amount > 0n; attempt++, amount /= 2n) {
      call = { address: treasury, abi: artifacts.AgentFeeTreasury.abi, functionName: 'claimAndSettle',
        args: [batch, asset, amount, 0n, deadline], account };
      try { quoted = (await client.simulateContract(call)).result; break; }
      catch (error) {
        if (error.message.includes(historyError) || error.message.includes('InsufficientHistory'))
          return { status: 'waiting-for-market-history', agent, asset };
      }
    }
    if (!quoted) return { status: 'market-unavailable', agent, asset };
    const gross = quoted[0] + quoted[1];
    const minGross = (gross * 9950n + 9999n) / 10000n;
    call.args[3] = minGross;
    const { request, result } = await client.simulateContract(call);
    const gas = gasWithHeadroom(await client.estimateContractGas(call));
    const fee = await client.estimateFeesPerGas();
    const gasCeiling = gas * (fee.maxFeePerGas ?? fee.gasPrice);
    if (gasCeiling > BigInt(maxGasCostWei)) return jsonSafe({ status: 'gas-budget-exceeded', agent, asset, gasCeiling });
    const maximumReward = await read(treasury, 'AgentFeeTreasury', 'maximumWorkReward');
    const guaranteedReward = minGross / 100n < maximumReward ? minGross / 100n : maximumReward;
    if (guaranteedReward < gasCeiling + BigInt(minimumMarginWei))
      return jsonSafe({ status: 'unprofitable', agent, asset, amount, gasCeiling, guaranteedReward });
    if (!submitTransactions) return jsonSafe({ status: 'ready', agent, treasury, asset, amount,
      netOutput: result[0], keeperPayment: result[1], gasCeiling, sources: batch });

    const hash = await wallet.writeContract({ ...request, gas, ...fee });
    const receipt = await client.waitForTransactionReceipt({ hash, confirmations, timeout: 60000 });
    if (receipt.status !== 'success') throw new Error(`Settlement transaction reverted: ${hash}`);
    const funded = receipt.logs.filter(log => same(log.address, treasury)).map(log => {
      try { return decodeEventLog({ abi: artifacts.AgentFeeTreasury.abi, ...log }); } catch { return null; }
    }).find(log => log?.eventName === 'OperatingFunded');
    if (!funded || !same(funded.args.keeper, keeper) || !same(funded.args.asset, asset)
        || funded.args.input !== amount || funded.args.grossOutput < minGross
        || (await client.getBlock({ blockNumber: receipt.blockNumber })).hash !== receipt.blockHash)
      throw new Error('Settlement receipt does not match the prepared operation');
    return jsonSafe({ status: 'confirmed', agent, treasury, transactionHash: hash, blockNumber: receipt.blockNumber,
      blockHash: receipt.blockHash, ...funded.args, gasUsed: receipt.gasUsed, gasCostWei: receipt.gasUsed * receipt.effectiveGasPrice });
  }

  async function runAgent(address) {
    const agent = getAddress(address);
    if (!deployment.feeSettlement) return { status: 'legacy-deployment', agent };
    if (running.has(agent)) return { status: 'already-running', agent };
    running.add(agent);
    try {
      if (await client.getChainId() !== deployment.chainId) throw new Error('Wrong settlement chain');
      if (!(await read(deployment.registry, 'AgentRegistry', 'isAgent', [agent]))) throw new Error('Agent is outside this registry');
      if (!(await read(agent, 'AgentVault', 'active'))) return { status: 'inactive', agent };
      const treasury = await read(agent, 'AgentVault', 'feeTreasury');
      const [settlement, factory, operating, boundAgent, agentToken] = await Promise.all([
        read(treasury, 'AgentFeeTreasury', 'settlement'), read(treasury, 'AgentFeeTreasury', 'curveFactory'),
        read(treasury, 'AgentFeeTreasury', 'operatingToken'), read(treasury, 'AgentFeeTreasury', 'agent'),
        read(agent, 'AgentVault', 'agentToken'),
      ]);
      if (!same(settlement, deployment.feeSettlement) || !same(factory, deployment.curveFactory)
          || !same(operating, deployment.operatingToken) || !same(boundAgent, agent)) throw new Error('Settlement deployment mismatch');
      const sources = await sourcesFor(agent, agentToken);
      const results = [];
      for (const asset of [deployment.rootHalo, agentToken]) {
        results.push(await settleAsset(agent, treasury, asset, sources.filter(source => same(source.parent, asset))));
      }
      return { status: 'settlement-round', agent, results };
    } finally { running.delete(agent); }
  }

  async function runRound({ offset = 0, limit = 2 } = {}) {
    if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isInteger(limit) || limit < 1 || limit > 20)
      throw new Error('Invalid settlement page');
    if (!deployment.feeSettlement) return { status: 'legacy-deployment', nextOffset: 0, results: [] };
    const count = Number(await read(deployment.registry, 'AgentRegistry', 'agentCount'));
    const results = [];
    for (let i = offset; i < Math.min(count, offset + limit); i++) {
      const agent = await read(deployment.registry, 'AgentRegistry', 'agents', [BigInt(i)]);
      try { results.push(await runAgent(agent)); }
      catch { results.push({ status: 'settlement-dependency-unavailable', agent }); }
    }
    return { nextOffset: offset + limit >= count ? 0 : offset + limit, results };
  }
  return { runAgent, runRound };
}
