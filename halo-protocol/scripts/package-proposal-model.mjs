import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { z } from 'zod';
import { root } from './compile.mjs';
import { canonicalJson } from '../sdk/manifest.mjs';
import { proposalSchema } from '../runtime/proposals.mjs';
const folder = path.join(root, 'models/proposal-qwen35-4b');
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const lockFile = 'models/proposal-qwen35-4b/assets.lock.json';
const lock = JSON.parse(fs.readFileSync(path.join(root, lockFile)));
// Refinements are independently checked after generation; this schema constrains its structural shape.
const base = z.toJSONSchema(proposalSchema, { target: 'draft-7', unrepresentable: 'any' });
const common = { version: base.properties.version, module: { const: 'halo-qwen35-4b-v1', type: 'string' }, rationale: base.properties.rationale };
function variant(kind, properties) {
  const fields = { ...common, kind: { const: kind, type: 'string' }, ...properties };
  return { type: 'object', additionalProperties: false, properties: fields, required: Object.keys(fields) };
}
const references = { ...base.properties.sourceIds, minItems: 1 };
const trade = { name: { const: '', type: 'string' }, symbol: { const: '', type: 'string' }, sourceIds: references,
  child: base.properties.child, amount: base.properties.amount };
const schema = { $schema: base.$schema, oneOf: [
  variant('launch', { name: { type: 'string', pattern: '^[A-Za-z0-9][A-Za-z0-9 _-]{0,63}$' },
    symbol: { type: 'string', pattern: '^[A-Z0-9]{1,12}$' }, sourceIds: references }),
  variant('hold', { name: { const: '', type: 'string' }, symbol: { const: '', type: 'string' }, sourceIds: { type: 'array', maxItems: 0, items: base.properties.sourceIds.items } }),
  variant('buy', trade), variant('sell', trade),
] };
// llama.cpp expands bounded string repetition into grammar rules. Long Unicode strings exceed
// its grammar-complexity ceiling; retain the byte/token limits and authoritative Zod length checks.
function grammarShape(value) {
  if (!value || typeof value !== 'object') return;
  if (value.type === 'string') delete value.maxLength;
  for (const child of Object.values(value)) if (typeof child === 'object') grammarShape(child);
}
grammarShape(schema);
fs.writeFileSync(path.join(folder, 'schema.json'), canonicalJson(schema) + '\n');
const files = [lockFile, 'models/proposal-qwen35-4b/schema.json', 'runtime/prompts/public-model.md', 'runtime/inference.mjs', 'runtime/proposals.mjs'];
const release = { version: 'halo.proposal-release.v1', alias: 'halo-qwen35-4b-v1',
  assets: { modelSha256: lock.model.sha256, runtimeCommit: lock.runtime.commit, lockSha256: sha(fs.readFileSync(path.join(root, lockFile))) },
  files: files.map(file => ({ path: file, sha256: sha(fs.readFileSync(path.join(root, file))) })),
  generation: { temperature: 0.3, seed: 42, max_tokens: 1024, reasoning_effort: 'none' },
  disclosure: 'Public Qwen3.5-4B Q8_0 baseline, not a trained profitable strategy. Model authorship is not cryptographically proven. GPU numerics can vary.' };
const bytes = Buffer.from(canonicalJson(release) + '\n');
fs.writeFileSync(path.join(folder, 'release.json'), bytes);
fs.writeFileSync(path.join(folder, 'release.sha256'), sha(bytes) + '\n');
const web = path.resolve(root, '../halo-web');
fs.writeFileSync(path.join(web, 'lib/generated/ProposalModel.json'), JSON.stringify({ name: 'Qwen3.5 · 4B', alias: release.alias, releaseSha256: sha(bytes), modelSha256: lock.model.sha256 }) + '\n');
fs.mkdirSync(path.join(web, 'public/models'), { recursive: true });
fs.writeFileSync(path.join(web, 'public/models', `${sha(bytes)}.json`), bytes);
console.log(`Public proposal release: ${sha(bytes)}`);
