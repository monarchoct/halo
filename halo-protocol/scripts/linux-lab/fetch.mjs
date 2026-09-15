import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import { Transform } from 'node:stream';

const here = path.dirname(fileURLToPath(import.meta.url));
const destination = path.resolve(here, '../../../../work/linux-lab/assets');
const lock = JSON.parse(fs.readFileSync(path.join(here, 'assets.lock.json')));
fs.mkdirSync(destination, { recursive: true });
async function digest(file, algorithm) {
  const hash = createHash(algorithm);
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}
// Independent immutable downloads; nothing is executed by this script.
const results = await Promise.allSettled(lock.assets.map(async asset => {
  if (path.basename(asset.file) !== asset.file) throw new Error('Invalid asset path');
  const file = path.join(destination, asset.file);
  if (fs.existsSync(file)) {
    if (await digest(file, asset.algorithm) !== asset.digest) throw new Error(`Existing asset mismatch: ${asset.file}`);
    console.log(`Verified existing ${asset.file}`); return;
  }
  const response = await fetch(asset.url, { signal: AbortSignal.timeout(900_000) });
  if (!response.ok) throw new Error(`${asset.file}: HTTP ${response.status}`);
  let received = 0, reported = Date.now();
  const progress = new Transform({ transform(chunk, encoding, callback) {
    received += chunk.length;
    if (Date.now() - reported > 10_000) {
      console.log(`${asset.file}: ${(received / 1024 ** 2).toFixed(1)} MiB`); reported = Date.now();
    }
    callback(null, chunk);
  }});
  const partial = `${file}.part`;
  await pipeline(response.body, progress, fs.createWriteStream(partial, { flags: 'wx' }));
  if (await digest(partial, asset.algorithm) !== asset.digest) throw new Error(`Downloaded asset mismatch: ${asset.file}`);
  fs.renameSync(partial, file);
  console.log(`Verified ${asset.file}: ${received} bytes`);
}));
for (const result of results) if (result.status === 'rejected') console.error(result.reason);
if (results.some(result => result.status === 'rejected')) process.exitCode = 1;
