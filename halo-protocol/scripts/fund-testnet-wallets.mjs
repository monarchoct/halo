#!/usr/bin/env node
/**
 * Split test ETH from the deployer to the operator and creator wallets on a public TEST network.
 *   HALO_DEPLOYER_KEY=0x... node scripts/fund-testnet-wallets.mjs deploy/testnet/config.json <operator> <creator> [--each 0.003]
 * Refuses mainnet; keeps at least 0.002 ETH on the deployer for the contract deployment (~26M gas at 0.01 gwei).
 */
import fs from 'node:fs';
import { createPublicClient, createWalletClient, defineChain, http, isAddress, parseEther, formatEther } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

const [configFile, operator, creator] = process.argv.slice(2);
const eachIndex = process.argv.indexOf('--each');
const each = parseEther(eachIndex > 0 ? process.argv[eachIndex + 1] : '0.003');
if (!configFile || !isAddress(operator ?? '') || !isAddress(creator ?? '')) throw new Error('Usage: fund-testnet-wallets.mjs <config.json> <operator> <creator> [--each ETH]');
const config = JSON.parse(fs.readFileSync(configFile, 'utf8'));
if (config.environment === 'mainnet') throw new Error('Never on mainnet');
const key = process.env.HALO_DEPLOYER_KEY;
if (!/^0x[0-9a-fA-F]{64}$/.test(key ?? '')) throw new Error('HALO_DEPLOYER_KEY must be set in the environment');
const account = privateKeyToAccount(key);
const chain = defineChain({ id: config.chainId, name: config.chainName, nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 }, rpcUrls: { default: { http: [config.rpcUrl] } } });
const client = createPublicClient({ chain, transport: http(config.rpcUrl) }), wallet = createWalletClient({ chain, account, transport: http(config.rpcUrl) });
const balance = await client.getBalance({ address: account.address });
const reserve = parseEther('0.002');
if (balance < each * 2n + reserve) throw new Error(`Deployer holds ${formatEther(balance)} ETH; needs ${formatEther(each * 2n + reserve)} to fund both wallets and keep the deployment reserve`);
for (const [name, to] of [['operator', operator], ['creator', creator]]) {
  const hash = await wallet.sendTransaction({ to, value: each });
  const receipt = await client.waitForTransactionReceipt({ hash });
  console.log(`${name} ${to} +${formatEther(each)} ETH · ${receipt.status} · ${hash}`);
}
console.log(`deployer keeps ${formatEther(await client.getBalance({ address: account.address }))} ETH`);
