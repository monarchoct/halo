import { getAddress, zeroAddress } from 'viem';

export const jsonSafe = value => JSON.parse(JSON.stringify(value, (_, item) => typeof item === 'bigint' ? item.toString() : item));

/** Stateless reads: another operator can serve the same view using only a deployment manifest and RPC. */
export function chainReader({ client, deployment, artifacts }) {
  const read = (address, contract, functionName, args = [], blockNumber) => client.readContract({
    address, abi: artifacts[contract].abi, functionName, args, blockNumber,
  });
  function named(contract, fn, value) {
    const outputs = artifacts[contract].abi.find(entry => entry.type === 'function' && entry.name === fn).outputs;
    return Object.fromEntries(outputs.map((output, index) => [output.name, value[index]]));
  }
  async function fields(address, contract, names, blockNumber) {
    const values = await Promise.all(names.map(name => read(address, contract, name, [], blockNumber)));
    return Object.fromEntries(names.map((name, index) => [name, values[index]]));
  }
  async function status() {
    const [chainId, block, registryCode, verifier] = await Promise.all([client.getChainId(), client.getBlock(),
      client.getCode({ address: deployment.registry }), read(deployment.registry, 'AgentRegistry', 'decisionVerifier')]);
    if (chainId !== deployment.chainId || !registryCode || registryCode === '0x'
      || verifier.toLowerCase() !== deployment.decisionVerifier.toLowerCase()) throw new Error('Deployment does not match this chain');
    return { available: true, chainId, chainName: deployment.chainName, environment: deployment.environment,
      blockNumber: block.number, blockTimestamp: block.timestamp, deployment,
      agentCount: await read(deployment.registry, 'AgentRegistry', 'agentCount', [], block.number) };
  }
  async function token(address, blockNumber) {
    address = getAddress(address);
    blockNumber ??= await client.getBlockNumber();
    const curve = await read(deployment.curveFactory, 'CurveFactory', 'curveOf', [address], blockNumber);
    if (curve === zeroAddress) throw Object.assign(new Error('Token was not created by this HALO deployment'), { statusCode: 404 });
    const [identity, market] = await Promise.all([
      fields(address, 'HaloToken', ['name', 'symbol', 'decimals', 'totalSupply'], blockNumber),
      fields(curve, 'HaloCurve', ['quote', 'sold', 'target', 'graduated', 'liquidityVault', 'tradingFeeBps', 'feeSplitter'], blockNumber),
    ]);
    const [quoteIdentity, totalFees] = await Promise.all([
      fields(market.quote, 'HaloToken', ['symbol', 'decimals'], blockNumber),
      read(market.feeSplitter, 'FeeSplitter', 'totalDeposited', [], blockNumber),
    ]);
    return { address, curve, ...identity, ...market, quoteSymbol: quoteIdentity.symbol,
      quoteDecimals: quoteIdentity.decimals, totalFees, observedBlock: blockNumber };
  }
  async function agent(address, blockNumber, includeFeeAccounting = true) {
    address = getAddress(address);
    blockNumber ??= await client.getBlockNumber();
    if (!(await read(deployment.registry, 'AgentRegistry', 'isAgent', [address], blockNumber))) {
      throw Object.assign(new Error('Agent not found'), { statusCode: 404 });
    }
    const state = await fields(address, 'AgentVault', ['creator', 'agentToken', 'active', 'nonce', 'lastExecutedAt',
      'capitalBasis', 'realizedPnl', 'totalWorkPaid', 'childCount', 'manifestHash', 'policyHash', 'coreId', 'policy', 'fees'], blockNumber);
    if (deployment.tradeRouter) {
      state.tradeRouter = await read(address, 'AgentVault', 'tradeRouter', [], blockNumber);
      if (state.tradeRouter.toLowerCase() !== deployment.tradeRouter.toLowerCase()) throw new Error('Agent trade router configuration mismatch');
    }
    state.policy = named('AgentVault', 'policy', state.policy);
    state.fees = named('AgentVault', 'fees', state.fees);
    const [market, operatingBalance, tradingBalance, children, reserveRequired] = await Promise.all([
      token(state.agentToken, blockNumber), read(deployment.operatingToken, 'HaloToken', 'balanceOf', [address], blockNumber),
      read(state.agentToken, 'HaloToken', 'balanceOf', [address], blockNumber),
      Promise.all(Array.from({ length: Math.min(Number(state.childCount), 100) }, (_, i) => read(address, 'AgentVault', 'children', [BigInt(i)], blockNumber))),
      read(address, 'AgentVault', 'reserveRequired', [30n], blockNumber),
    ]);
    const childMarkets = await Promise.all(children.map(child => token(child, blockNumber)));
    const holdings = await Promise.all(childMarkets.map(async market => ({ ...market,
      balance: await read(market.address, 'HaloToken', 'balanceOf', [address], blockNumber),
      costBasis: await read(address, 'AgentVault', 'positionCost', [market.address], blockNumber),
    })));
    let feeAccounting = null;
    if (deployment.feeSettlement && includeFeeAccounting) {
      const treasury = await read(address, 'AgentVault', 'feeTreasury', [], blockNumber);
      const totals = await fields(treasury, 'AgentFeeTreasury', ['totalOperatingReceived', 'totalKeeperPaid', 'settlement'], blockNumber);
      if (totals.settlement.toLowerCase() !== deployment.feeSettlement.toLowerCase()) throw new Error('Fee settlement configuration mismatch');
      const assets = [{ address: deployment.rootHalo, symbol: deployment.haloSymbol, decimals: market.quoteDecimals },
        { address: state.agentToken, symbol: market.symbol, decimals: market.decimals }];
      const balances = await Promise.all(assets.map(async asset => {
        const relevant = [market, ...childMarkets].filter(source => source.quote.toLowerCase() === asset.address.toLowerCase());
        const [pending, claims] = await Promise.all([
          read(treasury, 'AgentFeeTreasury', 'pending', [asset.address], blockNumber),
          Promise.all(relevant.map(async source => {
            const [unclaimed, totalClaimed, recognized] = await Promise.all([
              read(source.feeSplitter, 'FeeSplitter', 'claimable', [treasury], blockNumber),
              read(source.feeSplitter, 'FeeSplitter', 'totalClaimedBy', [treasury], blockNumber),
              read(treasury, 'AgentFeeTreasury', 'recognizedClaims', [source.feeSplitter], blockNumber),
            ]);
            return unclaimed + totalClaimed - recognized;
          })),
        ]);
        return { ...asset, pending, claimable: claims.reduce((sum, value) => sum + value, 0n) };
      }));
      feeAccounting = { treasury, ...totals, balances, completeSources: children.length === Number(state.childCount),
        sourceCount: childMarkets.length + 1, excludesUncollectedLiquidityFees: true };
    }
    return { address, ...state, name: market.name, symbol: market.symbol, market,
      operatingBalance, tradingBalance, reserveRequired, children: holdings, feeAccounting,
      runwaySeconds: operatingBalance / state.policy.workReward * BigInt(state.policy.intervalSeconds), observedBlock: blockNumber };
  }
  async function agents({ offset = 0, limit = 20 } = {}) {
    const blockNumber = await client.getBlockNumber();
    const count = Number(await read(deployment.registry, 'AgentRegistry', 'agentCount', [], blockNumber));
    const amount = Math.max(0, Math.min(limit, count - offset, 20));
    const addresses = await Promise.all(Array.from({ length: amount }, (_, i) => read(deployment.registry,
      'AgentRegistry', 'agents', [BigInt(offset + i)], blockNumber)));
    return { total: count, offset, limit: amount, observedBlock: blockNumber,
      agents: await Promise.all(addresses.map(address => agent(address, blockNumber, false))) };
  }
  async function actions(address) {
    if (!(await read(deployment.registry, 'AgentRegistry', 'isAgent', [address]))) throw Object.assign(new Error('Agent not found'), { statusCode: 404 });
    const latest = await client.getBlockNumber();
    const from = BigInt(deployment.deploymentBlock);
    const logs = [];
    // A bounded recent read path. The durable indexer backfills older history separately.
    const start = latest - from > 50_000n ? latest - 50_000n : from;
    for (let begin = start; begin <= latest; begin += 5_000n) {
      const end = begin + 4_999n > latest ? latest : begin + 4_999n;
      logs.push(...await client.getContractEvents({ address, abi: artifacts.AgentVault.abi,
        eventName: 'ActionExecuted', fromBlock: begin, toBlock: end, strict: true }));
    }
    return { completeHistory: start === from, fromBlock: start, toBlock: latest,
      actions: logs.reverse().map(log => ({ ...log.args, transactionHash: log.transactionHash,
        blockNumber: log.blockNumber, logIndex: log.logIndex })) };
  }
  return { status, token, agent, agents, actions, read };
}
