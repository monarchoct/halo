import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { decodeEventLog, getContractAddress, maxUint256, parseEther } from 'viem';
import { root } from '../scripts/compile.mjs';
import { LIQUIDITY_SUPPLY as L } from '../sdk/curve.mjs';
import { mineHookSalt } from '../sdk/hook-salt.mjs';

export async function runV4Scenarios({ artifacts, client, accounts, rootToken, deploy, send, read, rejects, pass, managerAddress }) {
  const [deployer, creator, operations, protocol, stranger] = accounts;
  for (const name of ['PoolManager', 'PoolSwapTest']) {
    const dependency = JSON.parse(fs.readFileSync(path.join(root, 'node_modules/@uniswap/v4-core/out', `${name}.sol`, `${name}.json`)));
    artifacts[`Uniswap${name}`] = { abi: dependency.abi, bytecode: dependency.bytecode.object,
      provenance: '@uniswap/v4-core 1.0.2 package artifact; local test deployment only' };
  }
  const manager = managerAddress ?? await deploy('UniswapPoolManager', [deployer]);
  const deploymentNonce = BigInt(await client.getTransactionCount({ address: deployer, blockTag: 'pending' }));
  const expectedAdapter = getContractAddress({ from: deployer, nonce: deploymentNonce });
  const expectedFactory = getContractAddress({ from: deployer, nonce: deploymentNonce + 1n });
  const mined = mineHookSalt({ adapter: expectedAdapter, manager, hookBytecode: artifacts.HaloPoolHook.bytecode });
  const adapter = await deploy('V4GraduationAdapter', [manager, expectedFactory, mined.salt]);
  const factory = await deploy('CurveFactory', [rootToken, protocol, adapter]);
  assert.equal(adapter.toLowerCase(), expectedAdapter.toLowerCase());
  assert.equal(factory.toLowerCase(), expectedFactory.toLowerCase());
  const hook = await read(adapter, 'V4GraduationAdapter', 'hook');
  assert.equal(hook.toLowerCase(), mined.address.toLowerCase());
  assert.equal(BigInt(hook) & 0x3fffn, 0x2040n);
  const target = parseEther('1000000');
  const fees = { tradingBps: 100, operationsBps: 6000, haloBps: 2000, operations, creator };
  const receipt = await send(factory, 'CurveFactory', 'create', ['Real v4 graduation', 'V4TEST', rootToken, target, fees, 'ipfs://v4-test'], creator);
  const launch = receipt.logs.map(log => { try { return decodeEventLog({ abi: artifacts.CurveFactory.abi, ...log }); } catch { return null; } })
    .find(log => log?.eventName === 'TokenLaunched').args;
  const key = { currency0: BigInt(launch.token) < BigInt(rootToken) ? launch.token : rootToken,
    currency1: BigInt(launch.token) < BigInt(rootToken) ? rootToken : launch.token, fee: 10000, tickSpacing: 60, hooks: hook };
  await assert.rejects(() => client.simulateContract({ address: manager, abi: artifacts.UniswapPoolManager.abi,
    functionName: 'initialize', args: [key, 2n ** 96n], account: stranger }), /revert/i);
  await rejects(adapter, 'V4GraduationAdapter', 'graduate', [launch.token, rootToken, L, target, 100, launch.splitter], 'Unauthorized', stranger);
  pass('v4 hook address permissions verified; pool pre-initialization and fake migration rejected');

  await send(rootToken, 'TestToken', 'approve', [launch.curve, target * 2n]);
  const deadline = (await client.getBlock()).timestamp + 86400n;
  const completing = await send(launch.curve, 'HaloCurve', 'buy', [target * 2n, 1n, deployer, deadline]);
  if (!(await read(launch.curve, 'HaloCurve', 'graduated'))) {
    const failures = completing.logs.map(log => { try { return decodeEventLog({ abi: artifacts.HaloCurve.abi, ...log }); } catch { return null; } })
      .filter(log => log?.eventName === 'GraduationDeferred');
    throw new Error(`Real v4 migration deferred: ${JSON.stringify(failures)}`);
  }
  const vault = await read(launch.curve, 'HaloCurve', 'liquidityVault');
  const locked = await read(vault, 'LockedLiquidityVault', 'liquidity');
  assert(locked > 0n);
  const migrated = completing.logs.map(log => { try { return decodeEventLog({ abi: artifacts.V4GraduationAdapter.abi, ...log }); } catch { return null; } })
    .find(log => log?.eventName === 'PoolGraduated').args;
  const amount0 = key.currency0.toLowerCase() === launch.token.toLowerCase() ? L : target;
  const amount1 = amount0 === L ? target : L;
  const numerator = migrated.sqrtPriceX96 ** 2n * amount0;
  const denominator = (2n ** 192n) * amount1;
  const difference = numerator > denominator ? numerator - denominator : denominator - numerator;
  assert(difference * 1_000_000n < denominator, 'Migration price differs by more than one part per million');
  assert.equal(await read(rootToken, 'TestToken', 'balanceOf', [launch.curve]), 0n);
  assert.equal(await read(launch.token, 'HaloToken', 'balanceOf', [launch.curve]), 0n);
  assert((await read(rootToken, 'TestToken', 'balanceOf', [manager])) > target - 10n ** 12n);
  pass('actual Uniswap v4 pool receives graduation reserves with matching price and a locked full-range position');

  const router = await deploy('UniswapPoolSwapTest', [manager]);
  await send(rootToken, 'TestToken', 'approve', [router, maxUint256]);
  await send(launch.token, 'HaloToken', 'approve', [router, maxUint256]);
  const quoteIsZero = key.currency0.toLowerCase() === rootToken.toLowerCase();
  const limits = direction => direction ? 4295128740n : 1461446703485210103287273052203988822378723970341n;
  const feesBefore = await read(launch.splitter, 'FeeSplitter', 'totalDeposited');
  await send(router, 'UniswapPoolSwapTest', 'swap', [key,
    { zeroForOne: quoteIsZero, amountSpecified: -parseEther('1000'), sqrtPriceLimitX96: limits(quoteIsZero) },
    { takeClaims: false, settleUsingBurn: false }, '0x']);
  await send(vault, 'LockedLiquidityVault', 'collectFees', [], stranger);
  assert((await read(launch.splitter, 'FeeSplitter', 'totalDeposited')) > feesBefore);
  assert.equal(await read(vault, 'LockedLiquidityVault', 'liquidity'), locked);
  await send(router, 'UniswapPoolSwapTest', 'swap', [key,
    { zeroForOne: !quoteIsZero, amountSpecified: -parseEther('1000'), sqrtPriceLimitX96: limits(!quoteIsZero) },
    { takeClaims: false, settleUsingBurn: false }, '0x']);
  await send(vault, 'LockedLiquidityVault', 'collectFees', [], stranger);
  assert((await read(vault, 'LockedLiquidityVault', 'unconvertedBaseFees')) > 0n);
  assert.equal(await read(vault, 'LockedLiquidityVault', 'liquidity'), locked);
  await rejects(vault, 'LockedLiquidityVault', 'seed', [1n], 'Unauthorized', creator);
  await rejects(vault, 'LockedLiquidityVault', 'unlockCallback', ['0x'], 'Unauthorized', creator);
  await rejects(launch.curve, 'HaloCurve', 'graduate', [], 'Closed', stranger);
  pass('real v4 swaps earn claimable quote fees; base fees are explicitly pending conversion; principal remains locked');

  await rejects(hook, 'HaloPoolHook', 'consult', [migrated.poolId, 1800], 'InsufficientHistory');
  await client.request({ method: 'evm_increaseTime', params: [1801] });
  await client.request({ method: 'evm_mine', params: [] });
  await send(hook, 'HaloPoolHook', 'checkpoint', [migrated.poolId], stranger);
  const [, observedSeconds] = await read(hook, 'HaloPoolHook', 'consult', [migrated.poolId, 1800]);
  assert(observedSeconds >= 1800n);
  pass('v4 price observations reject insufficient history and become usable after the required window');

  const baseFees = await read(vault, 'LockedLiquidityVault', 'unconvertedBaseFees');
  const baseBefore = await read(launch.token, 'HaloToken', 'balanceOf', [vault]);
  const depositBefore = await read(launch.splitter, 'FeeSplitter', 'totalDeposited');
  const validUntil = (await client.getBlock()).timestamp + 600n;
  await rejects(vault, 'LockedLiquidityVault', 'convertBaseFees', [baseFees + 1n, 0n, validUntil], 'InvalidState');
  await rejects(vault, 'LockedLiquidityVault', 'convertBaseFees', [baseFees, 0n, 0n], 'InvalidState');
  await rejects(vault, 'LockedLiquidityVault', 'convertBaseFees', [baseFees, maxUint256, validUntil], 'InvalidState');
  await send(vault, 'LockedLiquidityVault', 'convertBaseFees', [baseFees, 0n, validUntil], stranger);
  assert.equal(await read(vault, 'LockedLiquidityVault', 'unconvertedBaseFees'), 0n);
  assert.equal(await read(launch.token, 'HaloToken', 'balanceOf', [vault]), baseBefore - baseFees);
  assert((await read(launch.splitter, 'FeeSplitter', 'totalDeposited')) > depositBefore);
  assert.equal(await read(vault, 'LockedLiquidityVault', 'liquidity'), locked);
  pass('collected base fees convert through the actual v4 pool; output splits without spending locked principal or seed residuals');
}
