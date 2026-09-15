import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { getContractAddress, maxUint256, parseEther, zeroHash } from 'viem';
import { root } from '../scripts/compile.mjs';
import { mineHookSalt } from '../sdk/hook-salt.mjs';

// Disposable local markets only. This helper must never supply root-token allocation or liquidity on a public chain.
export async function deploySettlement({ artifacts, client, accounts, halo, weth, factory, deploy, send, read,
  manager: existingManager, minimumDepth = parseEther('50'), liquidityAmount = parseEther('100000') }) {
  assert.equal(await client.getChainId(), 31337);
  const [deployer] = accounts;
  for (const name of ['PoolManager', 'PoolModifyLiquidityTest', 'PoolSwapTest']) {
    const artifact = JSON.parse(fs.readFileSync(path.join(root, 'node_modules/@uniswap/v4-core/out', `${name}.sol`, `${name}.json`)));
    artifacts[`Uniswap${name}`] = { abi: artifact.abi, bytecode: artifact.bytecode.object };
  }
  const manager = existingManager ?? await deploy('UniswapPoolManager', [deployer]);
  const nonce = BigInt(await client.getTransactionCount({ address: deployer, blockTag: 'pending' }));
  const expected = getContractAddress({ from: deployer, nonce });
  const mined = mineHookSalt({ adapter: expected, manager, hookBytecode: artifacts.HaloPoolHook.bytecode });
  const reference = await deploy('RootReferenceMarket', [manager, halo, weth, 3000, deployer, mined.salt]);
  assert.equal(reference.toLowerCase(), expected.toLowerCase());
  const key = await read(reference, 'RootReferenceMarket', 'marketKey');
  const rootIsZero = BigInt(halo) < BigInt(weth);
  // A mock reference price of 0.01 test operating tokens per test HALO.
  const sqrtPrice = rootIsZero ? (1n << 96n) / 10n : (1n << 96n) * 10n;
  await send(reference, 'RootReferenceMarket', 'initialize', [sqrtPrice]);
  const liquidityRouter = await deploy('UniswapPoolModifyLiquidityTest', [manager]);
  const swapRouter = await deploy('UniswapPoolSwapTest', [manager]);
  for (const token of [halo, weth]) {
    await send(token, 'HaloToken', 'approve', [liquidityRouter, maxUint256]);
    await send(token, 'HaloToken', 'approve', [swapRouter, maxUint256]);
  }
  const liquidity = { tickLower: -887220, tickUpper: 887220, liquidityDelta: liquidityAmount, salt: zeroHash };
  await send(liquidityRouter, 'UniswapPoolModifyLiquidityTest', 'modifyLiquidity', [key, liquidity, '0x']);
  const settlement = await deploy('FeeSettlementRouter', [factory, weth, reference, minimumDepth]);
  return { settlement, reference, manager, key, rootIsZero, liquidityRouter, swapRouter, liquidity, hook: mined.address };
}
