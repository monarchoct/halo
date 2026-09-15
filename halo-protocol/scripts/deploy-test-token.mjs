#!/usr/bin/env node
/**
 * Deploy a test root token on a public TEST network and write its address into a deploy config.
 * The real HALO token is supplied outside the protocol; this exists so testnet can run before it exists.
 *
 *   HALO_DEPLOYER_KEY=0x... node scripts/deploy-test-token.mjs deploy/testnet/config.json [--name "Test HALO"] [--symbol tHALO]
 *
 * Refuses to run against mainnet. Mints the fixed supply to the deployer, who then funds creators.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createPublicClient, createWalletClient, defineChain, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { root } from './compile.mjs';

const arg = (name, fallback) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : fallback; };
const file = path.resolve(process.argv[2] ?? '');
if (!process.argv[2]) throw new Error('Usage: HALO_DEPLOYER_KEY=0x... node scripts/deploy-test-token.mjs <config.json>');
const config = JSON.parse(fs.readFileSync(file, 'utf8'));
if (config.environment === 'mainnet') throw new Error('Test tokens are never deployed to mainnet');
const key = process.env.HALO_DEPLOYER_KEY;
if (!/^0x[0-9a-fA-F]{64}$/.test(key ?? '')) throw new Error('HALO_DEPLOYER_KEY must be a 32-byte hex private key in the environment');
const account = privateKeyToAccount(key);
const chain = defineChain({ id: config.chainId, name: config.chainName, nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 }, rpcUrls: { default: { http: [config.rpcUrl] } } });
const client = createPublicClient({ chain, transport: http(config.rpcUrl, { timeout: 30000 }) }), wallet = createWalletClient({ chain, account, transport: http(config.rpcUrl, { timeout: 30000 }) });
if (await client.getChainId() !== config.chainId) throw new Error('RPC chain id differs from the configuration');
const artifact = JSON.parse(fs.readFileSync(path.join(root, 'artifacts/HaloToken.json'), 'utf8'));
const balance = await client.getBalance({ address: account.address });
if (balance === 0n) throw new Error(`Deployer ${account.address} has no ETH on chain ${config.chainId}`);
console.log(`Deploying ${arg('name', 'Test HALO')} ($${arg('symbol', config.haloSymbol ?? 'tHALO')}) as ${account.address} (${Number(balance) / 1e18} ETH)`);
const hash = await wallet.deployContract({ abi: artifact.abi, bytecode: artifact.bytecode, args: [arg('name', 'Test HALO'), arg('symbol', config.haloSymbol ?? 'tHALO'), account.address] });
const receipt = await client.waitForTransactionReceipt({ hash, confirmations: 2 });
if (receipt.status !== 'success') throw new Error(`Token deployment reverted: ${hash}`);
config.rootHalo = receipt.contractAddress;
fs.writeFileSync(file, JSON.stringify(config, null, 2) + '\n');
console.log(`Test root token ${receipt.contractAddress} · tx ${hash} · written to ${path.relative(root, file)} as rootHalo`);
