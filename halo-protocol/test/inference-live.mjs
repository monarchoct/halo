import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { root } from '../scripts/compile.mjs';
import { loadPublicModel } from '../runtime/inference.mjs';
import { collectEvidence } from '../runtime/research.mjs';
import { kuboReplica, replicatedArtifacts } from '../sdk/artifacts.mjs';
import { safeFetch } from '../sdk/safe-fetch.mjs';
const key = fs.readFileSync(path.resolve(root, '../../work/inference-assets/local-inference-key.txt'), 'utf8').trim();
const model = loadPublicModel({ releaseFile: path.join(root, 'models/proposal-qwen35-4b/release.json'), backendUrl: 'http://127.0.0.1:8080/v1', authorization: `Bearer ${key}`,
  transport: async (url, options) => { const response = await safeFetch(url, options); fs.writeFileSync(path.join(root, 'test-results/live-inference-response.json'), response.bytes); return response; } });
const peers = JSON.parse(fs.readFileSync(path.join(root, 'test-results/local-ipfs.json'))).peers;
const store = replicatedArtifacts({ replicas: peers.map(apiUrl => kuboReplica({ apiUrl })) });
const research = await collectEvidence({ store });
assert(research.evidence.length > 0, 'Real public research is required');
const input = { interests: 'Space exploration and open-source AI culture. Discover original playful community narratives from public developments.', evidence: research.evidence, usedSources: [], canLaunch: true };
const result = await model.generate(input);
assert(result.proposal.sourceIds.every(id => research.evidence.some(item => item.id === id)));
const publication = await store.put(result.transcript);
fs.writeFileSync(path.join(root, 'test-results/live-inference.json'), JSON.stringify({ ...result, transcriptURI: publication.uri, replicas: publication.replicas,
  publicEvidenceCount: research.evidence.length, unavailable: research.unavailable, scope: 'Actual local GPU inference and real public sources. No chain transaction in this probe.' }, null, 2));
console.log(JSON.stringify({ proposal: result.proposal, seconds: result.transcript.elapsedSeconds, usage: result.transcript.response.usage, transcriptURI: publication.uri }, null, 2));
