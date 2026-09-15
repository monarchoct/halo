import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { setTimeout } from 'node:timers/promises';
import { createPublicClient, createWalletClient, defineChain, http } from 'viem';
import { root } from '../scripts/compile.mjs';

async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}

export async function startChain({ forkUrl, forkBlock, port: requestedPort } = {}) {
  const port = requestedPort ?? await freePort();
  const platform = process.platform === 'win32' ? 'win32-amd64' : process.platform === 'darwin'
    ? `darwin-${process.arch === 'arm64' ? 'arm64' : 'amd64'}` : `linux-${process.arch === 'arm64' ? 'arm64' : 'amd64'}`;
  const binary = path.join(root, 'node_modules', '@foundry-rs', `anvil-${platform}`, 'bin', process.platform === 'win32' ? 'anvil.exe' : 'anvil');
  if (!fs.existsSync(binary)) throw new Error(`Missing local Anvil binary: ${binary}`);
  fs.mkdirSync(path.join(root, 'test-results'), { recursive: true });
  const log = fs.openSync(path.join(root, 'test-results', `anvil-${port}.log`), 'w');
  const args = ['--host', '127.0.0.1', '--port', String(port), '--chain-id', '31337', '--hardfork', 'cancun', '--silent'];
  if (forkUrl) args.push('--fork-url', forkUrl, '--fork-block-number', String(forkBlock));
  const child = spawn(binary, args,
    { stdio: ['ignore', log, log], windowsHide: true });
  fs.closeSync(log);
  let spawnError;
  child.on('error', error => { spawnError = error; });
  const chain = defineChain({ id: 31337, name: 'HALO local verification', nativeCurrency: { name: 'Test Ether', symbol: 'ETH', decimals: 18 },
    rpcUrls: { default: { http: [`http://127.0.0.1:${port}`] } } });
  const transport = http(chain.rpcUrls.default.http[0], { retryCount: 0, timeout: forkUrl ? 30000 : 1000 });
  const client = createPublicClient({ chain, transport, pollingInterval: 25 });
  const stop = () => { if (child.exitCode === null && !child.killed) child.kill(); };
  process.once('exit', stop);
  let ready = false;
  for (let i = 0; i < 150; i++) {
    if (spawnError || child.exitCode !== null) throw spawnError ?? new Error(`Anvil exited with ${child.exitCode}`);
    try { await client.getBlockNumber(); ready = true; break; } catch { await setTimeout(100); }
  }
  if (!ready) { stop(); throw new Error('Anvil did not become ready'); }
  const wallet = createWalletClient({ chain, transport, pollingInterval: 25 });
  const accounts = await wallet.getAddresses();
  if (await client.getChainId() !== 31337) { stop(); throw new Error('Refusing to test on a non-local chain ID'); }
  return { client, wallet, accounts, stop: async () => {
    process.removeListener('exit', stop);
    if (child.exitCode !== null) return;
    const exited = new Promise(resolve => child.once('exit', resolve));
    stop();
    await exited;
  } };
}
