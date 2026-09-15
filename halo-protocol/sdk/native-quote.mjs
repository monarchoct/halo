import { encodeFunctionData, getAddress, zeroAddress } from 'viem';

/** Public, unsigned native purchase adapter. All amounts are integer base units.
 * A quote is evidence at one block, never a guarantee or a signing authority. */
export async function nativePurchaseQuote({ client, deployment, artifacts, token, buyer, amount, slippageBps = 100 }) {
  const router = deployment.nativeBuyRouter;
  if (!router || !artifacts.NativeBuyRouter) throw new Error('Native purchase integration is not configured');
  token = getAddress(token); buyer = getAddress(buyer);
  if (buyer === zeroAddress || !/^[1-9][0-9]{0,38}$/.test(String(amount))
    || !Number.isInteger(slippageBps) || slippageBps < 1 || slippageBps > 2000) throw new Error('Invalid native quote input');
  if (await client.getChainId() !== deployment.chainId) throw new Error('Wrong chain');
  const head = await client.getBlock();
  const abi = artifacts.NativeBuyRouter.abi;
  const read = functionName => client.readContract({ address: router, abi, functionName, blockNumber: head.number });
  const [factory, wrappedNative] = await Promise.all([read('factory'), read('wrappedNative')]);
  if (getAddress(factory) !== getAddress(deployment.curveFactory)) throw new Error('Wrong router factory');
  const { result: [assets, outputs, refunds] } = await client.simulateContract({ address: router, abi,
    functionName: 'quote', args: [token, BigInt(amount)], account: buyer, blockNumber: head.number });
  if (getAddress(assets[0]) !== getAddress(wrappedNative) || getAddress(assets[1]) !== getAddress(deployment.rootHalo)
    || getAddress(assets.at(-1)) !== token || outputs.length !== assets.length - 1 || refunds.length !== outputs.length)
    throw new Error('Router returned an inconsistent path');
  const output = outputs.at(-1);
  const minimumOutput = output * BigInt(10000 - slippageBps) / 10000n;
  if (minimumOutput === 0n) throw new Error('Amount is too small');
  const deadline = head.timestamp + 120n;
  const canonical = await client.getBlock({ blockNumber: head.number });
  if (canonical.hash !== head.hash) throw new Error('Quote block reorganized');
  return {
    version: 'halo.native-purchase.v1', chainId: deployment.chainId,
    blockNumber: head.number.toString(), blockHash: head.hash,
    quoteTimestamp: head.timestamp.toString(), deadline: deadline.toString(),
    buyer, token, inputAsset: 'native:ETH', inputAmount: String(amount),
    outputAmount: output.toString(), minimumOutput: minimumOutput.toString(), slippageBps,
    route: assets, hopOutputs: outputs.map(String),
    refunds: refunds.map((value, i) => ({ asset: i === 0 ? 'native:ETH' : assets[i], amount: value.toString() })),
    fees: { includedInOutput: true, networkGasIncluded: false, denomination: 'per-hop input asset' },
    transaction: { chainId: deployment.chainId, from: buyer, to: router, value: String(amount),
      data: encodeFunctionData({ abi, functionName: 'buy', args: [token, minimumOutput, deadline] }) },
    disclosure: 'Unsigned quote; no broadcast. Intermediate refunds retain their currency. Full ancestry route; no terminal integration implied.',
  };
}
