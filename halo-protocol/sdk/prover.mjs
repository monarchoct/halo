import fs from 'node:fs';
import path from 'node:path';
import { runPublicPython } from './python-process.mjs';
import { decodeFunctionData, parseAbi, toHex } from 'viem';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const proofAbi = parseAbi(['function verifyProof(bytes proof, uint256[] instances) returns (bool)']);

/** The prover receives only public inputs. Wallet credentials never enter its process. */
export async function proveDecision({ commitment, facts, outputDirectory, python,
  releaseDirectory = path.join(root, 'models/core-v1/release'), releaseSha256, timeoutMs = 60_000 }) {
  if (!python || !releaseSha256) throw new Error('An explicit Python executable and pinned proving release hash are required');
  const folder = path.resolve(outputDirectory);
  fs.mkdirSync(folder, { recursive: true });
  const request = path.join(folder, 'request.json');
  fs.writeFileSync(request, JSON.stringify({ commitment, facts: facts.map(value => {
    if (value !== 0n && value !== 1n && value !== 0 && value !== 1) throw new Error('Decision facts must be Boolean');
    return Number(value);
  }) }));
  await runPublicPython({ python, script: path.join(root, 'models/core-v1/prove_action.py'), directory: folder, timeoutMs,
    args: ['--request', request, '--release', path.resolve(releaseDirectory), '--release-sha256', releaseSha256, '--output', folder] });
  const calldata = toHex(fs.readFileSync(path.join(folder, 'calldata.bytes')));
  const { args: [proof, instances] } = decodeFunctionData({ abi: proofAbi, data: calldata });
  const expectedBytes = [...Buffer.from(commitment.slice(2), 'hex')].map(BigInt);
  const expected = [...expectedBytes, ...facts.map(BigInt), ...expectedBytes, facts.every(value => BigInt(value) === 1n) ? 1n : 0n];
  if (instances.length !== expected.length || instances.some((value, index) => value !== expected[index])) {
    throw new Error('Prover output does not match the requested action inputs');
  }
  return { proof, instances, result: JSON.parse(fs.readFileSync(path.join(folder, 'result.json'), 'utf8')) };
}
