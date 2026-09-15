import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { z } from 'zod';
import { canonicalJson } from '../sdk/manifest.mjs';
import { safeFetch } from '../sdk/safe-fetch.mjs';
import { proposalSchema } from './proposals.mjs';

const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const releaseSchema = z.object({
  version: z.literal('halo.proposal-release.v1'), alias: z.literal('halo-qwen35-4b-v1'),
  assets: z.object({ modelSha256: digest, runtimeCommit: z.string().regex(/^[a-f0-9]{40}$/), lockSha256: digest }).strict(),
  files: z.array(z.object({ path: z.string(), sha256: digest }).strict()).min(3).max(10),
  generation: z.object({ temperature: z.number().min(0).max(1), seed: z.number().int(), max_tokens: z.number().int().min(256).max(2048),
    reasoning_effort: z.literal('none') }).strict(),
  disclosure: z.string(),
}).strict();

/** This binding is operator configuration. Agent manifests cannot select a private endpoint. */
export function loadPublicModel({ releaseFile, backendUrl, authorization, transport = safeFetch }) {
  const bytes = fs.readFileSync(releaseFile), releaseSha256 = sha(bytes);
  const release = releaseSchema.parse(JSON.parse(bytes));
  const root = path.resolve(path.dirname(releaseFile), '../..');
  const files = new Map();
  for (const file of release.files) {
    const resolved = path.resolve(root, file.path);
    if (!resolved.startsWith(root + path.sep)) throw new Error('Release file escapes the project');
    const content = fs.readFileSync(resolved);
    if (sha(content) !== file.sha256) throw new Error(`Public model release differs at ${file.path}`);
    files.set(file.path, content);
  }
  const lockBytes = files.get('models/proposal-qwen35-4b/assets.lock.json');
  if (!lockBytes || sha(lockBytes) !== release.assets.lockSha256) throw new Error('Model asset lock does not match release');
  const lock = JSON.parse(lockBytes);
  if (lock.model.sha256 !== release.assets.modelSha256 || lock.runtime.commit !== release.assets.runtimeCommit) throw new Error('Model assets differ');
  const prompt = files.get('runtime/prompts/public-model.md')?.toString();
  const schema = JSON.parse(files.get('models/proposal-qwen35-4b/schema.json') ?? 'null');
  if (!prompt || !schema) throw new Error('Public prompt and output schema are required');
  const url = new URL(backendUrl);
  if (url.username || url.password || url.search || url.hash || !url.pathname.endsWith('/v1')) throw new Error('Configure an explicit inference /v1 base URL without credentials');
  const local = ['127.0.0.1', '[::1]'].includes(url.hostname);
  if (local ? url.protocol !== 'http:' : url.protocol !== 'https:') throw new Error('Inference requires loopback HTTP or public HTTPS');
  const localOrigins = local ? [url.origin] : [];
  return { releaseSha256, release, bytes, sourceFiles: [...files].map(([name, content]) => ({ name, bytes: content })),
    async generate(input) {
      // This is a public, bounded snapshot. Never forward arbitrary manifest fields or operator secrets.
      const observed = { ...input, evidence: input.evidence.slice(0, 12).map(item => ({ ...item, summary: item.summary.slice(0, 800) })) };
      const user = canonicalJson(observed);
      if (Buffer.byteLength(user) > 48000) throw new Error('Public model context exceeds the pinned input budget');
      const request = { model: release.alias, messages: [{ role: 'system', content: prompt }, { role: 'user', content: user }],
        ...release.generation, stream: false, response_format: { type: 'json_schema', json_schema: { name: 'halo_proposal', strict: true, schema } } };
      const body = Buffer.from(canonicalJson(request));
      const started = Date.now();
      const result = await transport(`${url.href}/chat/completions`, { method: 'POST', body, maxBytes: 32768, timeoutMs: 90000, localOrigins,
        headers: { 'Content-Type': 'application/json', 'Content-Length': String(body.length), ...(authorization ? { Authorization: authorization } : {}) } });
      const response = JSON.parse(result.bytes);
      const choice = response.choices?.[0];
      if (response.model !== release.alias || response.choices?.length !== 1 || choice?.finish_reason !== 'stop'
        || typeof choice.message?.content !== 'string' || choice.message.tool_calls?.length) throw new Error('Incomplete or unexpected inference response');
      const proposal = proposalSchema.parse(JSON.parse(choice.message.content));
      if (proposal.module !== release.alias) throw new Error('Proposal module differs from committed release');
      return { proposal, transcript: { version: 'halo.inference-transcript.v1', releaseSha256,
        modelSha256: release.assets.modelSha256, requestSha256: sha(body), responseSha256: sha(result.bytes),
        request, response, elapsedSeconds: (Date.now() - started) / 1000,
        disclosure: 'Operator-published inference transcript; the spending proof does not prove this model ran or exclude human authorship.' } };
    },
  };
}
