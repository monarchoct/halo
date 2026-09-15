import { decodeEventLog } from 'viem';
import { gasWithHeadroom } from '../sdk/transaction-gas.mjs';

/** Recover or create a canonical on-chain observation. The model never supplies the output floor or route. */
export async function prepareTradeObservation({ client, wallet, account, agent, abi, child, kind, amount, nonce, graduated,
  submitTransactions, confirmations = 2, maxGasCostWei, reward, computeCostWei = 0n, minimumMarginWei = 0n,
  allowLocalLoss = false, beforeSubmit = async () => {}, record = async () => {} }) {
  const read = (functionName, args = []) => client.readContract({ address: agent, abi, functionName, args });
  const block = await client.getBlock();
  if (await read('nonce') !== nonce || !await read('isChild', [child])) throw new Error('Trade ownership or nonce changed');
  const logs = await client.getContractEvents({ address: agent, abi, eventName: 'TradeObserved',
    args: { child, nonce }, fromBlock: block.number > 4999n ? block.number - 4999n : 0n, toBlock: block.number, strict: true });
  for (const log of logs.reverse()) {
    if (log.args.kind !== kind || log.args.amount !== amount || block.timestamp > log.args.timestamp + 840n || log.blockNumber >= block.number) continue;
    // Reading the stored tuple also rejects a log from a noncanonical RPC projection. decisionContext rechecks the market phase.
    const observation = await read('tradeSnapshots', [log.args.snapshotId]);
    if (observation[0] !== nonce || observation[4] !== amount || observation[6].toLowerCase() !== child.toLowerCase() || observation[7] !== kind
      || Boolean(observation[8]) !== graduated) continue;
    return { status: 'observed', snapshotId: log.args.snapshotId, minOutput: await read('minimumSnapshotOutput', [log.args.snapshotId]),
      transactionHash: log.transactionHash, gasCostWei: 0n, reused: true };
  }
  const call = { address: agent, abi, functionName: 'snapshotTrade', args: [child, kind, amount], account };
  const { request } = await client.simulateContract(call);
  const gas = gasWithHeadroom(await client.estimateContractGas(request));
  const fees = await client.estimateFeesPerGas();
  const gasCeiling = gas * (fees.maxFeePerGas ?? fees.gasPrice);
  if (gasCeiling > BigInt(maxGasCostWei)) return { status: 'gas-budget-exceeded', gasCeiling };
  if (!allowLocalLoss && gasCeiling + BigInt(computeCostWei) + BigInt(minimumMarginWei) >= reward)
    return { status: 'unprofitable', gasCeiling };
  // A dry run cannot fabricate a persisted observation or claim that an action proof is already executable.
  if (!submitTransactions) return { status: 'observation-required', gasCeiling, child, kind, amount };
  await beforeSubmit({ agent, nonce: nonce.toString(), stage: 'trade-observation' });
  const hash = await wallet.writeContract({ ...request, gas, ...fees });
  await record('observation-submitted', { transactionHash: hash, child, kind, amount, nonce, gasCeiling });
  const receipt = await client.waitForTransactionReceipt({ hash, confirmations: Math.max(2, confirmations), timeout: 60000 });
  if (receipt.status !== 'success') throw new Error('Trade observation reverted');
  const observed = receipt.logs.filter(log => log.address.toLowerCase() === agent.toLowerCase()).map(log => {
    try { return decodeEventLog({ abi, ...log }); } catch { return null; }
  }).find(log => log?.eventName === 'TradeObserved' && log.args.nonce === nonce && log.args.child.toLowerCase() === child.toLowerCase()
    && log.args.kind === kind && log.args.amount === amount);
  if (!observed || (await client.getBlock({ blockNumber: receipt.blockNumber })).hash !== receipt.blockHash)
    throw new Error('Canonical observation receipt is missing');
  const result = { status: 'observed', snapshotId: observed.args.snapshotId,
    minOutput: await read('minimumSnapshotOutput', [observed.args.snapshotId]), transactionHash: hash,
    gasCostWei: receipt.gasUsed * receipt.effectiveGasPrice, reused: false };
  await record('observation-confirmed', result);
  return result;
}
