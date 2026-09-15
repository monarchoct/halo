import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import { Transform, Readable } from 'node:stream';
import { root } from './compile.mjs';

const lock = JSON.parse(fs.readFileSync(path.join(root, 'models/proposal-qwen35-4b/assets.lock.json')));
const directory = path.resolve(root, '../../work/inference-assets');
fs.mkdirSync(directory, { recursive: true });
async function verify(file, item) {
  if (!fs.existsSync(file) || fs.statSync(file).size !== item.size) return false;
  const hash = crypto.createHash('sha256');
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
  return hash.digest('hex') === item.sha256;
}
for (const item of [lock.runtime, lock.cuda, lock.model]) {
  if (path.basename(item.file) !== item.file || !/^[a-f0-9]{64}$/.test(item.sha256)) throw new Error('Invalid asset lock');
  const destination = path.join(directory, item.file);
  if (await verify(destination, item)) { console.log(`Verified existing ${item.file}`); continue; }
  const response = await fetch(item.url, { signal: AbortSignal.timeout(1800000) });
  if (!response.ok) throw new Error(`Asset download failed: HTTP ${response.status}`);
  let count = 0, lastReport = 0;
  const hash = crypto.createHash('sha256');
  const check = new Transform({ transform(chunk, encoding, done) {
    count += chunk.length;
    if (count > item.size) return done(new Error('Asset exceeds pinned size'));
    hash.update(chunk);
    if (Date.now() - lastReport > 10000) { console.log(`${item.file}: ${(100 * count / item.size).toFixed(1)}%`); lastReport = Date.now(); }
    done(null, chunk);
  } });
  await pipeline(Readable.fromWeb(response.body), check, fs.createWriteStream(`${destination}.part`));
  if (count !== item.size || hash.digest('hex') !== item.sha256) throw new Error(`Asset integrity failed: ${item.file}`);
  fs.renameSync(`${destination}.part`, destination);
  console.log(`Downloaded and SHA-256 verified ${item.file}`);
}
console.log(`Inference assets ready in ${directory}`);
