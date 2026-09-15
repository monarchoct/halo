import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { root } from '../scripts/compile.mjs';
import { loadPublicModel } from '../runtime/inference.mjs';
import { agentManifestSchema } from '../sdk/manifest.mjs';
const releaseFile = path.join(root, 'models/proposal-qwen35-4b/release.json');
const input = { interests: 'Space communities', evidence: [{ id: 'a'.repeat(64), title: 'Public evidence', summary: 'Observation', url: 'https://example.com/evidence' }], usedSources: [], canLaunch: true };
const proposal = { version: 'halo.proposal.v1', module: 'halo-qwen35-4b-v1', kind: 'launch', name: 'Orbit Commons', symbol: 'ORBIT', sourceIds: ['a'.repeat(64)], rationale: 'Uncertain community narrative' };
let response = { model: proposal.module, choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(proposal) } }] };
let calls = 0;
const model = loadPublicModel({ releaseFile, backendUrl: 'http://127.0.0.1:8080/v1', authorization: 'Bearer PRIVATE', transport: async (url, options) => {
  calls++; assert.equal(url, 'http://127.0.0.1:8080/v1/chat/completions');
  assert.deepEqual(options.localOrigins, ['http://127.0.0.1:8080']);
  const request = JSON.parse(options.body); assert.equal(request.tools, undefined); assert.equal(request.messages.length, 2);
  assert.equal(request.model, proposal.module); assert(!options.body.includes('PRIVATE'));
  return { bytes: Buffer.from(JSON.stringify(response)) };
} });
const result = await model.generate(input);
assert.deepEqual(result.proposal, proposal); assert(!JSON.stringify(result.transcript).includes('PRIVATE'));
for (const changed of [
  { model: 'uncommitted-model', choices: response.choices },
  { ...response, choices: [{ ...response.choices[0], finish_reason: 'length' }] },
  { ...response, choices: [{ ...response.choices[0], message: { content: '{}', tool_calls: [{}] } }] },
  { ...response, choices: [{ ...response.choices[0], message: { content: JSON.stringify({ ...proposal, recipient: '0x' + '1'.repeat(40) }) } }] },
]) { const original = response; response = changed; await assert.rejects(() => model.generate(input)); response = original; }
const before = calls;
await assert.rejects(() => model.generate({ ...input, interests: 'x'.repeat(50000) }), /budget/);
assert.equal(calls, before);
for (const backendUrl of ['http://169.254.169.254/v1', 'http://localhost:8080/v1', 'https://user:pass@example.com/v1', 'https://example.com/v1?key=x'])
  assert.throws(() => loadPublicModel({ releaseFile, backendUrl }));
// Existing activated manifests remain valid; a model commitment must not silently use an API endpoint or rules mode.
const existing = { version: 'halo.agent.v1', chainId: 31337, identity: { name: 'Example', symbol: 'EX', description: '' },
  models: { mode: 'public-baseline', core: 'halo-core-v1', releaseSha256: 'a'.repeat(64), proposalEndpoint: '', reproducibility: 'public-rules' },
  policy: { maxPositionBps: 1000, maxDailyDebitBps: 1000, maxLaunchesPerDay: 1, maxSlippageBps: 300, intervalSeconds: 900, workReward: '50000000000000', childGraduationTarget: '1000000000000000000000000' },
  fees: { tradingBps: 100, operationsBps: 6000, haloBps: 2000, creator: '0x' + '1'.repeat(40) }, graduationTarget: '1000000000000000000000000' };
assert.equal(agentManifestSchema.parse(existing).models.mode, 'public-baseline');
const committed = { ...existing, models: { ...existing.models, mode: 'public-model', proposalReleaseSha256: model.releaseSha256, reproducibility: 'public-weights' } };
assert.equal(agentManifestSchema.parse(committed).models.mode, 'public-model');
for (const changed of [{ proposalReleaseSha256: undefined }, { proposalEndpoint: 'http://127.0.0.1:8080/v1' }, { reproducibility: 'public-rules' }])
  assert.throws(() => agentManifestSchema.parse({ ...committed, models: { ...committed.models, ...changed } }));
const copyRoot = path.join(root, 'test-results/inference-release-copy');
for (const file of model.release.files) {
  const destination = path.join(copyRoot, file.path); fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.copyFileSync(path.join(root, file.path), destination);
}
const copyRelease = path.join(copyRoot, 'models/proposal-qwen35-4b/release.json'); fs.copyFileSync(releaseFile, copyRelease);
fs.appendFileSync(path.join(copyRoot, 'runtime/prompts/public-model.md'), '\nChanged prompt');
assert.throws(() => loadPublicModel({ releaseFile: copyRelease, backendUrl: 'http://127.0.0.1:8080/v1' }), /differs/);
console.log('PASS inference boundaries: committed artifacts, model identity, incomplete output, tool/recipient rejection, bounded input, credentials, endpoint separation and legacy manifests');
