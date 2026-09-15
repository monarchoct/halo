import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createPublicClient, http } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { createBrowserApi } from '../services/browser/server.mjs';
import { createBrowserForwarder, readPublicFile } from '../runtime/browser/forwarder.mjs';
import { SafeFetchHttpError } from '../sdk/safe-fetch.mjs';
import { root } from '../scripts/compile.mjs';

const deployment = JSON.parse(fs.readFileSync(path.join(root, 'test-results/local-deployment.json')));
assert.equal(deployment.chainId, 31337); assert.equal(deployment.environment, 'local');
const agent = JSON.parse(fs.readFileSync(path.join(root, 'test-results/last-local-operator.json'))).agent;
const account = privateKeyToAccount(generatePrivateKey()), wallet = { signMessage: args => account.signMessage({ message: args.message }) };
const base = path.join(root, 'test-results/browser-forwarder-tests', randomUUID());
fs.mkdirSync(base, { recursive: true });
let clock = Date.now();
const app = await createBrowserApi({ client: createPublicClient({ transport: http(deployment.rpcUrl) }), deployment,
  artifacts: { AgentRegistry: JSON.parse(fs.readFileSync(path.join(root, 'artifacts/AgentRegistry.json'))) },
  directory: path.join(base, 'relay'), clock: () => clock });
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a/s8AAAAASUVORK5CYII=', 'base64');
let lost = false, failBefore = false;
const deliveries = [];
async function transport(url, options = {}) {
  if (failBefore && options.method === 'POST') { failBefore = false; throw new Error('Network absent before acceptance'); }
  const response = await app.inject({ method: options.method ?? 'GET', url: new URL(url).pathname,
    ...(options.body ? { payload: JSON.parse(options.body), headers: { 'Content-Type': 'application/json' } } : {}) });
  if (response.statusCode < 200 || response.statusCode >= 300) throw new SafeFetchHttpError(response.statusCode);
  if (options.method === 'POST') { deliveries.push(JSON.parse(options.body)); if (lost) { lost = false; throw new Error('Response lost after relay acceptance'); } }
  return { bytes: response.rawPayload };
}
function setup(name) {
  const reports = path.join(base, name, 'public'), stateFile = path.join(base, name, 'operator', 'delivery.json');
  fs.mkdirSync(reports, { recursive: true });
  const jobId = name.charCodeAt(0).toString(16).repeat(32);
  const config = { wallet, account, deployment, agent, endpoint: 'http://127.0.0.1:8792', reportDirectory: reports, stateFile,
    jobId, platform: 'fomo', source: 'development-capture', localOrigins: ['http://127.0.0.1:8792'], transport, now: () => clock };
  const write = (sequence, changes = {}) => {
    const record = { version: 'halo.browser-report.v1', jobId, sequence, timestamp: new Date(clock).toISOString(),
      siteOrigin: 'https://fomo.family', state: 'viewing', activity: 'Disposable delivery fixture, not a social session.',
      width: 1, height: 1, imageFile: `${String(sequence).padStart(6, '0')}.png`, ...changes };
    if (record.imageFile) fs.writeFileSync(path.join(reports, record.imageFile), png);
    fs.writeFileSync(path.join(reports, `${String(sequence).padStart(6, '0')}.json`), JSON.stringify(record));
  };
  return { config, write, reports, stateFile };
}
const passed = [];
try {
  let f = setup('alpha'); f.write(0); lost = true;
  await assert.rejects(createBrowserForwarder(f.config).drain(), /Response lost/);
  const pending = JSON.parse(fs.readFileSync(f.stateFile)).pending.record;
  assert.equal(pending.hash, deliveries.at(-1).hash);
  let forwarder = createBrowserForwarder(f.config);
  assert.equal((await forwarder.drain())[0].status, 'delivered');
  assert.equal(deliveries.at(-1).hash, pending.hash); assert.equal(deliveries.at(-1).signature, pending.signature);
  let history = (await app.inject({ url: `/v1/agents/${agent}/browser` })).json().frames;
  assert.equal(history.length, 1);
  passed.push('Restart retries the identical signed frame after a lost acknowledgement');
  f.write(1, { state: 'private', activity: 'Authentication is private.', width: 0, height: 0, imageFile: undefined });
  await Promise.all([forwarder.drain(), forwarder.drain()]);
  history = (await app.inject({ url: `/v1/agents/${agent}/browser` })).json().frames;
  assert.equal(history.length, 2); assert.equal(history.at(-1).frame.state, 'private'); assert.equal(history.at(-1).frame.imageHash, null);
  assert.equal((await app.inject({ url: `/v1/browser/frames/${history.at(-1).hash}/image` })).statusCode, 404);
  passed.push('Serialized delivery preserves private-state image suppression');
  assert.throws(() => createBrowserForwarder({ ...f.config, agent: '0x0000000000000000000000000000000000000001' }), /another execution/);
  passed.push('A delivery journal cannot be reused for another agent');
  f = setup('bravo'); f.write(0); lost = true;
  await assert.rejects(createBrowserForwarder(f.config).drain());
  clock += 360000;
  const postCount = deliveries.length;
  assert.equal((await createBrowserForwarder(f.config).drain())[0].status, 'recovered');
  assert.equal(deliveries.length, postCount);
  passed.push('Old uncertain delivery is resolved by its retained receipt without reposting');
  f = setup('charlie'); f.write(0); failBefore = true;
  await assert.rejects(createBrowserForwarder(f.config).drain());
  clock += 360000;
  await createBrowserForwarder(f.config).drain();
  const gap = deliveries.at(-1).frame;
  assert.equal(gap.state, 'error'); assert.equal(gap.imageHash, null); assert.equal(gap.sequence, 0);
  passed.push('An expired unsent capture becomes an explicit image-free delivery gap');
  f.write(1, { timestamp: new Date(clock - 5000).toISOString() });
  await createBrowserForwarder(f.config).drain();
  assert.equal(deliveries.at(-1).frame.state, 'error');
  clock += 3000; f.write(2);
  await createBrowserForwarder(f.config).drain();
  assert.equal(deliveries.at(-1).frame.state, 'viewing');
  passed.push('Backlog cannot move stream time backwards; a fresh capture resumes normally');
  f = setup('delta'); f.write(0, { jobId: 'f'.repeat(64) });
  await assert.rejects(createBrowserForwarder(f.config).drain(), /another execution/);
  f.write(0, { siteOrigin: 'https://x.com' });
  await assert.rejects(createBrowserForwarder(f.config).drain(), /another execution/);
  passed.push('Untrusted worker reports cannot choose another job or social origin');
  f.write(0, { state: 'needs-account' });
  await assert.rejects(createBrowserForwarder(f.config).drain(), /Private states/);
  f.write(0, { width: 1280 });
  await assert.rejects(createBrowserForwarder(f.config).drain(), /dimensions differ/);
  passed.push('Private images and false dimensions are rejected before signing');
  assert.throws(() => readPublicFile(f.reports, '../operator/delivery.json', 8192), /filename/);
  fs.mkdirSync(path.join(f.reports, '000003.json'));
  assert.throws(() => readPublicFile(f.reports, '000003.json', 8192), /Unsafe/);
  fs.writeFileSync(path.join(f.reports, '000004.json'), Buffer.alloc(8193));
  assert.throws(() => readPublicFile(f.reports, '000004.json', 8192), /Unsafe/);
  passed.push('Report ingestion rejects path traversal, directories and oversized files');
  assert.throws(() => createBrowserForwarder({ ...f.config, stateFile: path.join(f.reports, 'signing.json') }), /disjoint/);
  passed.push('The browser output cannot contain the operator signing journal');
  fs.writeFileSync(path.join(root, 'test-results/browser-forwarder.json'), JSON.stringify({ checkedAt: new Date().toISOString(),
    scope: 'Real local registry; in-process relay HTTP interface; synthetic public test image; no social posts or financial transactions', passed }, null, 2));
  console.log(`PASS ${passed.length} browser forwarder scenarios with real local registry validation`);
} finally { await app.close(); }
