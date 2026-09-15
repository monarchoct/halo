import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { root } from './compile.mjs';
import { compileCore } from './compile-core.mjs';

const source = path.resolve(process.argv[2] ?? path.join(root, '../../work/core-proof'));
const destination = path.join(root, 'models/core-v1/release');
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const model = fs.readFileSync(path.join(root, 'models/core-v1/model.onnx'));
if (sha256(model) !== '77d2eba11110e97767e99c15787f796886f41164295b32e7df9d5d4330ce3f89') throw new Error('Wrong core model');
if (!fs.readFileSync(path.join(source, 'CoreVerifier.sol')).equals(fs.readFileSync(path.join(root, 'models/core-v1/Halo2Verifier.sol')))) {
  throw new Error('Proving material does not match the committed verifier source');
}
fs.mkdirSync(destination, { recursive: true });
const files = {};
for (const name of ['settings.json', 'core.ezkl', 'pk.key', 'vk.key', 'kzg12.srs']) {
  const bytes = fs.readFileSync(path.join(source, name));
  files[name] = { sha256: sha256(bytes), bytes: bytes.length };
  fs.writeFileSync(path.join(destination, name), bytes);
}
const artifact = compileCore();
const manifest = { version: 'halo-core-v1', ezklVersion: '23.0.5', modelSha256: sha256(model),
  verifierRuntimeCodeHash: artifact.runtimeCodeHash, files,
  notice: 'Public proving material, not a private signing key. Verify this manifest hash against the release configuration.' };
const bytes = Buffer.from(JSON.stringify(manifest, null, 2) + '\n');
fs.writeFileSync(path.join(destination, 'manifest.json'), bytes);
fs.writeFileSync(path.join(destination, 'manifest.sha256'), sha256(bytes) + '\n');
console.log(`Packaged public proving material: ${sha256(bytes)}`);
