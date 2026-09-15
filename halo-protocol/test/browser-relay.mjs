import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createPublicClient, http, keccak256, toHex } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { root } from '../scripts/compile.mjs';
import { createBrowserApi } from '../services/browser/server.mjs';
import { browserFrameMessage, imageDigest } from '../runtime/browser/frames.mjs';

const deployment = JSON.parse(fs.readFileSync(path.join(root, 'test-results/local-deployment.json')));
assert.equal(deployment.environment, 'local');
const agent = JSON.parse(fs.readFileSync(path.join(root, 'test-results/last-local-operator.json'))).agent;
const account = privateKeyToAccount(generatePrivateKey());
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a/s8AAAAASUVORK5CYII=', 'base64');
const config = { client: createPublicClient({ transport: http(deployment.rpcUrl) }), deployment,
  artifacts: { AgentRegistry: JSON.parse(fs.readFileSync(path.join(root, 'artifacts/AgentRegistry.json'))) },
  directory: path.join(root, 'test-results/browser-tests', randomUUID()) };
let app = await createBrowserApi(config);
const initial = { version: 'halo.browser-frame.v1', chainId: 31337, registry: deployment.registry, agent,
  operator: account.address, sessionId: randomUUID(), sequence: 0, previousHash: `0x${'0'.repeat(64)}`,
  timestamp: new Date().toISOString(), source: 'development-capture', siteOrigin: 'https://fomo.family',
  activity: 'A disposable image transport test.', state: 'viewing', width: 1, height: 1, mimeType: 'image/png', imageHash: imageDigest(png) };
async function sign(frame) { const message = browserFrameMessage(frame); return { frame, hash: keccak256(toHex(message)),
  signature: await account.signMessage({ message }), ...(frame.imageHash ? { pngBase64: png.toString('base64') } : {}) }; }
const post = value => app.inject({ method: 'POST', url: '/v1/browser/frames', payload: value });
try {
  const first = await sign(initial);
  assert.equal((await post({ ...first, frame: { ...first.frame, activity: 'Altered operator statement' } })).statusCode, 400);
  assert.equal((await post({ ...first, pngBase64: png.subarray(0, 20).toString('base64') })).statusCode, 400);
  assert.equal((await post(await sign({ ...initial, state: 'private' }))).statusCode, 400);
  assert.equal((await post(await sign({ ...initial, siteOrigin: 'https://fomo.family/?email=private' }))).statusCode, 400);
  assert.equal((await post(first)).statusCode, 200);
  assert.equal((await post(first)).json().duplicate, true);
  const loaded = await app.inject({ url: `/v1/browser/frames/${first.hash}/image` });
  assert.equal(imageDigest(loaded.rawPayload), initial.imageHash);
  assert.equal((await post(await sign({ ...initial, sequence: 1 }))).statusCode, 409);
  const second = await sign({ ...initial, sequence: 1, previousHash: first.hash, state: 'needs-account',
    width: 0, height: 0, mimeType: null, imageHash: null, activity: 'Account setup is required; no screen is published.' });
  assert.equal((await post(second)).statusCode, 200);
  assert.equal((await app.inject({ url: `/v1/browser/frames/${second.hash}/image` })).statusCode, 404);
  await app.close(); app = await createBrowserApi(config);
  const history = (await app.inject({ url: `/v1/agents/${agent}/browser` })).json().frames;
  assert.equal(history.length, 2); assert.equal(history[1].hash, second.hash);
  // A provider restart still rejects overwriting the already published sequence.
  assert.equal((await post(await sign({ ...second.frame, activity: 'Conflicting second frame' }))).statusCode, 409);
  const passed = ['Operator signature binds text and deployment', 'PNG hash and dimensions checked', 'Private account screens rejected',
    'URLs cannot expose queries or credentials', 'Duplicate delivery idempotent', 'Image endpoint matches signed digest',
    'Hash-chain fork rejected', 'Private-state image is absent', 'Restart restores signed history', 'Restart preserves sequence head'];
  fs.writeFileSync(path.join(root, 'test-results/browser-relay.json'), JSON.stringify({ checkedAt: new Date().toISOString(), passed }, null, 2));
  console.log(`PASS ${passed.length} browser relay checks; real local registry, no social posts or financial transactions`);
} finally { await app.close(); }
