import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { createPublicClient, createWalletClient, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { assertSupportedDeployment } from '../../sdk/networks.mjs';
import { createBrowserForwarder, readPublicFile } from './forwarder.mjs';

if (!process.argv[2]) throw new Error('Usage: node runtime/browser/forward-cli.mjs forwarding.json [--once] [--local-test]');
const file = path.resolve(process.argv[2]);
const config = z.object({ deploymentFile: z.string(), agent: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  operatorAddress: z.string().regex(/^0x[0-9a-fA-F]{40}$/), operatorKeyFile: z.string().optional(),
  jobId: z.string().regex(/^[a-f0-9]{64}$/), platform: z.enum(['x', 'fomo']),
  endpoint: z.string().url(), reportDirectory: z.string(), stateFile: z.string(),
  pollIntervalMs: z.number().int().min(1000).max(10000).default(2000),
  maxRunSeconds: z.number().int().min(30).max(3600).default(900),
}).strict().parse(JSON.parse(fs.readFileSync(file)));
const resolve = value => path.resolve(path.dirname(file), value);
const deployment = JSON.parse(fs.readFileSync(resolve(config.deploymentFile)));
assertSupportedDeployment(deployment);
const local = process.argv.includes('--local-test');
const rpc = new URL(deployment.rpcUrl);
if (local ? deployment.chainId !== 31337 || deployment.environment !== 'local' || rpc.protocol !== 'http:'
  || !['127.0.0.1', 'localhost', '[::1]'].includes(rpc.hostname) || rpc.username || rpc.password || rpc.pathname !== '/' || rpc.search || rpc.hash
  : deployment.environment === 'local')
  throw new Error('Local delivery requires the explicit disposable-chain switch');
const client = createPublicClient({ transport: http(deployment.rpcUrl) });
if (await client.getChainId() !== deployment.chainId) throw new Error('RPC chain differs from the configured deployment');
const reports = fs.realpathSync(resolve(config.reportDirectory));
let account = config.operatorAddress;
if (config.operatorKeyFile) {
  const keyPath = fs.realpathSync(resolve(config.operatorKeyFile));
  if (keyPath.startsWith(`${reports}${path.sep}`)) throw new Error('The browser output must never contain the operator key');
  const key = fs.readFileSync(keyPath, 'utf8').trim();
  if (!/^0x[0-9a-fA-F]{64}$/.test(key)) throw new Error('Invalid operator key file');
  account = privateKeyToAccount(key);
  if (account.address.toLowerCase() !== config.operatorAddress.toLowerCase()) throw new Error('Operator key does not match the configured publisher');
} else if (!local) throw new Error('The independent publisher requires its own operator key file');
const wallet = createWalletClient({ account, transport: http(deployment.rpcUrl) });
const forwarder = createBrowserForwarder({ wallet, account, deployment, agent: config.agent, endpoint: config.endpoint,
  reportDirectory: reports, stateFile: resolve(config.stateFile), jobId: config.jobId, platform: config.platform,
  source: local ? 'local-browser-worker' : 'production-browser', localOrigins: local ? [new URL(config.endpoint).origin] : [] });
const abort = new AbortController();
let stopReason = 'deadline', deliveryComplete = false, lastAttemptFailed = false;
const deadline = setTimeout(() => abort.abort(), config.maxRunSeconds * 1000);
process.once('SIGINT', () => { stopReason = 'interrupted'; abort.abort(); });
process.once('SIGTERM', () => { stopReason = 'interrupted'; abort.abort(); });
const resultSchema = z.object({ version: z.literal('halo.browser-result.v1'), jobId: z.literal(config.jobId),
  reportCount: z.number().int().min(0).max(1000000), result: z.object({ status: z.string().max(60) }).passthrough() }).strict();
try {
  while (!abort.signal.aborted) {
    try {
      const rows = await forwarder.drain();
      lastAttemptFailed = false;
      const cursor = rows.at(-1)?.cursor ?? 0;
      console.log(JSON.stringify({ service: 'halo-browser-forwarder', jobId: config.jobId, cursor, delivered: rows.filter(row => row.status !== 'waiting').length }));
      let result;
      try { result = resultSchema.parse(JSON.parse(readPublicFile(reports, 'result.json', 8192))); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
      if (result && cursor >= result.reportCount) {
        deliveryComplete = true;
        console.log(JSON.stringify({ status: 'delivery-complete', browserOutcome: result.result.status, jobId: config.jobId })); break;
      }
    } catch { lastAttemptFailed = true; console.log(JSON.stringify({ status: 'delivery-retry', jobId: config.jobId })); }
    if (process.argv.includes('--once')) break;
    await new Promise(resolve => {
      const timer = setTimeout(done, config.pollIntervalMs);
      function done() { clearTimeout(timer); abort.signal.removeEventListener('abort', done); resolve(); }
      abort.signal.addEventListener('abort', done, { once: true }); if (abort.signal.aborted) done();
    });
  }
} finally { clearTimeout(deadline); }
if (!deliveryComplete && (!process.argv.includes('--once') || lastAttemptFailed)) {
  process.exitCode = stopReason === 'interrupted' ? 130 : 1;
  console.log(JSON.stringify({ status: 'delivery-incomplete', reason: lastAttemptFailed ? 'unacknowledged-or-invalid-report' : stopReason, jobId: config.jobId }));
}
