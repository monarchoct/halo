import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createPublicClient, http, keccak256, toHex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { root } from '../scripts/compile.mjs';
import { traceMessage } from '../runtime/trace.mjs';
import { createTransparencyApi } from '../services/transparency/server.mjs';

// Uses existing disposable-chain data, but never sends a transaction or publishes externally.
const deployment = JSON.parse(fs.readFileSync(path.join(root, 'test-results/local-deployment.json')));
assert.equal(deployment.environment, 'local'); assert.equal(deployment.chainId, 31337);
const artifacts = Object.fromEntries(fs.readdirSync(path.join(root, 'artifacts')).filter(name => name.endsWith('.json')).map(name => [name.slice(0, -5), JSON.parse(fs.readFileSync(path.join(root, 'artifacts', name)))]));
const result = JSON.parse(fs.readFileSync(path.join(root, 'test-results/last-local-operator.json')));
assert.equal(result.status, 'confirmed');
const account = privateKeyToAccount(`0x${crypto.randomBytes(32).toString('hex')}`);
const directory = path.join(root, 'test-results/trace-tests', crypto.randomUUID());
const config = { client: createPublicClient({ transport: http(deployment.rpcUrl) }), deployment, artifacts, directory };
let app = await createTransparencyApi(config);
const initial = { version: 'halo.step.v1', chainId: 31337, registry: deployment.registry, operator: account.address,
  agent: result.agent, nonce: result.nonce, runId: crypto.randomUUID(), index: 0, previousHash: `0x${'0'.repeat(64)}`,
  timestamp: new Date().toISOString(), stage: 'observe', summary: 'Testing public report verification.' };
async function sign(step) { const message = traceMessage(step); return { step, hash: keccak256(toHex(message)), signature: await account.signMessage({ message }) }; }
async function post(record) { return app.inject({ method: 'POST', url: '/v1/steps', payload: record }); }
try {
  const first = await sign(initial);
  assert.equal((await post({ ...first, step: { ...first.step, summary: 'Tampered report' } })).statusCode, 400);
  assert.equal((await post(first)).statusCode, 200);
  assert.equal((await post(first)).json().duplicate, true);
  const second = await sign({ ...initial, index: 1, previousHash: first.hash, stage: 'research', summary: 'Public research progress.' });
  assert.equal((await post(second)).statusCode, 200);
  const conflicting = await sign({ ...second.step, summary: 'Conflicting replacement' });
  assert.equal((await post(conflicting)).statusCode, 409);
  const stolenReceipt = await sign({ ...initial, index: 2, previousHash: second.hash, stage: 'confirm', transactionHash: result.transactionHash, summary: 'Claiming another operator’s work.' });
  assert.equal((await post(stolenReceipt)).statusCode, 400);
  const foreign = await sign({ ...initial, runId: crypto.randomUUID(), chainId: 1 });
  assert.equal((await post(foreign)).statusCode, 400);
  await app.close();
  app = await createTransparencyApi(config);
  const restored = (await app.inject({ method: 'GET', url: `/v1/agents/${initial.agent}/steps` })).json().steps;
  assert.equal(restored.length, 2);
  assert.equal(restored[1].hash, second.hash);
  fs.writeFileSync(path.join(root, 'test-results/transparency.json'), JSON.stringify({ checkedAt: new Date().toISOString(), passed: [
    'Tampered signed summaries rejected', 'Duplicate reports are idempotent', 'Conflicting step replacement rejected',
    'Another operator cannot claim a transaction receipt', 'Wrong chain rejected', 'Signed journal survives service restart',
  ] }, null, 2));
  console.log('PASS 6 transparency checks: signatures, replay, step history, receipt beneficiary, chain binding and restart');
} finally { await app.close(); }
