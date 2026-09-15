import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { createPublicClient, http } from 'viem';
import { containerRunnerSchema, createContainerRunner } from './browser/container-runner.mjs';
import { socialBindingSchema } from './browser/schema.mjs';
import { createSocialHandler } from './social.mjs';
import { createXOAuth } from './social/x-oauth.mjs';
import { createXApi } from './social/x-api.mjs';
import { createOutboxDispatcher } from './outbox.mjs';
import { createSecretStore } from './identity/secret-store.mjs';
import { openDatabase, verifySchema } from '../services/persistence/database.mjs';
import { createJobStore } from '../services/persistence/store.mjs';
import { createSocialBindingStore } from '../services/persistence/social-bindings.mjs';
import { assertSupportedDeployment } from '../sdk/networks.mjs';
import { parseRawCid, identify } from '../sdk/artifacts.mjs';
import { safeFetch } from '../sdk/safe-fetch.mjs';

if (!process.argv[2]) throw new Error('Usage: node runtime/social-cli.mjs social.json [--once] [--publish] [--local-test]');
const file = path.resolve(process.argv[2]), resolve = value => path.resolve(path.dirname(file), value);
const config = z.object({ deploymentFile: z.string(), bindingsFile: z.string().optional(),
  database: z.object({ connectionEnvironment: z.string().regex(/^[A-Z][A-Z0-9_]*$/), caFile: z.string().optional() }).strict(),
  browser: containerRunnerSchema.omit({ deploymentFile: true, localTest: true }),
  x: z.object({ clientIdEnvironment: z.string().regex(/^[A-Z][A-Z0-9_]*$/), clientSecretEnvironment: z.string().regex(/^[A-Z][A-Z0-9_]*$/),
    redirectUri: z.string().url() }).strict().optional(),
  secretKeyFile: z.string().optional(), secretDirectory: z.string().optional(), observeAfterApiPost: z.boolean().default(false),
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
// bindingsFile is now an optional operator override for browser DOM-automation selectors only
// (FOMO/browser-session). It never supplies a connected profile: that always comes from the
// creator-signed connect flow recorded in halo_social_bindings.
const selectorSchema = socialBindingSchema.omit({ profileUrl: true });
const overrideEntries = config.bindingsFile ? z.array(z.object({ agent: z.string().regex(/^0x[0-9a-fA-F]{40}$/), platform: z.literal('fomo'),
  selectors: selectorSchema }).strict()).max(20000).parse(JSON.parse(fs.readFileSync(resolve(config.bindingsFile)))) : [];
const selectorOverrides = new Map();
for (const entry of overrideEntries) {
  const key = `${entry.agent.toLowerCase()}:${entry.platform}`;
  if (selectorOverrides.has(key)) throw new Error('Duplicate agent browser-automation override');
  selectorOverrides.set(key, entry.selectors);
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
const secretStore = config.secretKeyFile
  ? createSecretStore({ keyFile: resolve(config.secretKeyFile), directory: resolve(config.secretDirectory ?? 'social-secrets') }) : undefined;
const xOAuth = config.x ? createXOAuth({ clientId: process.env[config.x.clientIdEnvironment], clientSecret: process.env[config.x.clientSecretEnvironment],
  redirectUri: config.x.redirectUri }) : undefined;
const xApi = config.x ? createXApi() : undefined;
async function publishToX({ platform, profileUrl, text, secretRef }, { signal } = {}) {
  if (platform !== 'x' || !xApi || !xOAuth || !secretStore) throw new Error('X API publication is not configured on this worker');
  const secret = await secretStore.get(secretRef);
  if (!secret?.accessToken) { const error = new Error('X credentials are missing'); error.code = 'credentials-expired'; throw error; }
  try { return await xApi.createPost({ text, accessToken: secret.accessToken, profileUrl }, { signal }); }
  catch (error) {
    if (error?.code !== 'credentials-expired' || !secret.refreshToken) throw error;
    const refreshed = await xOAuth.refresh({ refreshToken: secret.refreshToken }, { signal });
    await secretStore.put(secretRef, { accessToken: refreshed.access_token, refreshToken: refreshed.refresh_token ?? secret.refreshToken });
    return await xApi.createPost({ text, accessToken: refreshed.access_token, profileUrl }, { signal });
  }
}
const abort = new AbortController();
process.once('SIGTERM', () => abort.abort()); process.once('SIGINT', () => abort.abort());
try {
  await verifySchema(database);
  const store = await createJobStore({ database, deployment });
  const socialStore = await createSocialBindingStore({ database, deployment });
  async function connections(agent, platform) {
    const row = await socialStore.find(agent, platform);
    if (!row) return undefined;
    if (row.method === 'oauth') return { method: 'oauth', state: row.state, profileUrl: row.profile_url, secretRef: row.secret_ref };
    const override = selectorOverrides.get(`${agent.toLowerCase()}:${platform}`);
    if (!override) throw new Error('Operator has not configured browser automation selectors for this connected account');
    return { method: 'browser-session', state: row.state, profileUrl: row.profile_url, ...override };
  }
  const handler = createSocialHandler({ client, deployment, artifacts, content, store, runBrowser, publish,
    confirmations: config.confirmations, bindings: connections, publishApi: config.x ? publishToX : undefined,
    observeAfterApiPost: config.observeAfterApiPost, reportConnectionState: (agent, platform, state) => socialStore.setState(agent, platform, state) });
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
