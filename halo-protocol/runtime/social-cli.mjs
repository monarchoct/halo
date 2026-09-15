import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { createPublicClient, http } from 'viem';
import { containerRunnerSchema, createContainerRunner } from './browser/container-runner.mjs';
import { socialBindingSchema } from './browser/schema.mjs';
import { createSocialHandler } from './social.mjs';
import { createOutboxDispatcher } from './outbox.mjs';
import { openDatabase, verifySchema } from '../services/persistence/database.mjs';
import { createJobStore } from '../services/persistence/store.mjs';
import { assertSupportedDeployment } from '../sdk/networks.mjs';
import { parseRawCid, identify } from '../sdk/artifacts.mjs';
import { safeFetch } from '../sdk/safe-fetch.mjs';

if (!process.argv[2]) throw new Error('Usage: node runtime/social-cli.mjs social.json [--once] [--publish] [--local-test]');
const file = path.resolve(process.argv[2]), resolve = value => path.resolve(path.dirname(file), value);
const config = z.object({ deploymentFile: z.string(), bindingsFile: z.string().optional(),
  database: z.object({ connectionEnvironment: z.string().regex(/^[A-Z][A-Z0-9_]*$/), caFile: z.string().optional() }).strict(),
  browser: containerRunnerSchema.omit({ deploymentFile: true, localTest: true }),
  artifactGateways: z.array(z.string().url()).min(1).max(8),
  confirmations: z.number().int().min(1).max(128).default(4),
  pollSeconds: z.number().int().min(5).max(60).default(10), leaseSeconds: z.number().int().min(30).max(600).default(120),
}).strict().parse(JSON.parse(fs.readFileSync(file)));
const localTest = process.argv.includes('--local-test'), publish = process.argv.includes('--publish');
const deploymentFile = resolve(config.deploymentFile), deployment = JSON.parse(fs.readFileSync(deploymentFile));
assertSupportedDeployment(deployment);
if (localTest ? deployment.environment !== 'local' || publish : deployment.environment === 'local') throw new Error('Local social workers require --local-test and cannot publish');
if (!localTest && config.confirmations < 2) throw new Error('Public social publication requires multiple confirmations');
const gateways = config.artifactGateways.map(value => {
  const url = new URL(value);
  const loopback = localTest && url.protocol === 'http:' && ['127.0.0.1', '[::1]'].includes(url.hostname);
  if ((!loopback && url.protocol !== 'https:') || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error('Use public HTTPS artifact gateway origins');
  return { origin: url.origin, localOrigins: loopback ? [url.origin] : [] };
});
const content = { async get(uri) {
  const cid = parseRawCid(uri);
  return Promise.any(gateways.map(async gateway => {
    const response = await safeFetch(`${gateway.origin}/ipfs/${cid}`, { localOrigins: gateway.localOrigins, maxBytes: 262144, timeoutMs: 10000 });
    if ((await identify(response.bytes)).cid !== cid) throw new Error('Artifact gateway returned different content');
    return response.bytes;
  }));
} };
const bindingEntries = config.bindingsFile ? z.array(z.object({ agent: z.string().regex(/^0x[0-9a-fA-F]{40}$/), platform: z.enum(['x', 'fomo']),
  binding: socialBindingSchema }).strict()).max(20000).parse(JSON.parse(fs.readFileSync(resolve(config.bindingsFile)))) : [];
const bindings = new Map();
for (const entry of bindingEntries) {
  const key = `${entry.agent.toLowerCase()}:${entry.platform}`;
  if (bindings.has(key)) throw new Error('Duplicate agent social-account configuration');
  bindings.set(key, entry.binding);
}
const runBrowser = createContainerRunner({ ...config.browser, deploymentFile, localTest,
  stateDirectory: resolve(config.browser.stateDirectory), egressFile: resolve(config.browser.egressFile),
  ...(config.browser.operatorKeyFile ? { operatorKeyFile: resolve(config.browser.operatorKeyFile) } : {}) });
const client = createPublicClient({ transport: http(deployment.rpcUrl, { timeout: 15000, retryCount: 1 }) });
if (await client.getChainId() !== deployment.chainId) throw new Error('Social worker RPC differs from its deployment');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const artifacts = Object.fromEntries(['AgentRegistry', 'AgentVault'].map(name => [name, JSON.parse(fs.readFileSync(path.join(root, `artifacts/${name}.json`)))]));
const databaseUrl = process.env[config.database.connectionEnvironment];
if (!databaseUrl) throw new Error('Configured social-worker database credential is missing');
const database = openDatabase({ url: databaseUrl, local: localTest, ...(config.database.caFile ? { ca: fs.readFileSync(resolve(config.database.caFile), 'utf8') } : {}) });
const abort = new AbortController();
process.once('SIGTERM', () => abort.abort()); process.once('SIGINT', () => abort.abort());
try {
  await verifySchema(database);
  const store = await createJobStore({ database, deployment });
  const handler = createSocialHandler({ client, deployment, artifacts, content, store, runBrowser, publish,
    confirmations: config.confirmations, bindings: async (agent, platform) => bindings.get(`${agent}:${platform}`) });
  const dispatcher = createOutboxDispatcher({ store, workerId: `social:${randomUUID()}`, leaseSeconds: config.leaseSeconds,
    signal: abort.signal, handlers: { 'social-post': handler } });
  console.log(JSON.stringify({ service: 'halo-social-worker', chainId: deployment.chainId, publish, localTest }));
  while (!abort.signal.aborted) {
    try {
      const result = await dispatcher.deliverOnce('social-post');
      console.log(JSON.stringify({ service: 'halo-social-outbox', ...result }));
    } catch { if (!abort.signal.aborted) console.log(JSON.stringify({ service: 'halo-social-outbox', status: 'dependency-unavailable' })); }
    if (process.argv.includes('--once')) break;
    await new Promise(resolve => {
      const done = () => { clearTimeout(timer); abort.signal.removeEventListener('abort', done); resolve(); };
      const timer = setTimeout(done, config.pollSeconds * 1000);
      abort.signal.addEventListener('abort', done, { once: true }); if (abort.signal.aborted) done();
    });
  }
} finally { await database.close(); }
