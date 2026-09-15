import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

const output = process.argv[2];
if (!output) throw new Error('Usage: node scripts/fetch-proof-srs.mjs <output-file>');
const url = 'https://kzg.ezkl.xyz/kzg12.srs';
const expected = '28b151069f41abc121baa6d2eaa8f9e4c4d8326ddbefee2bd9c0776b80ac6fad';
const response = await fetch(url, { signal: AbortSignal.timeout(30000) });
if (!response.ok) throw new Error(`Public SRS HTTP ${response.status}`);
const bytes = Buffer.from(await response.arrayBuffer());
if (createHash('sha256').update(bytes).digest('hex') !== expected) throw new Error('SRS checksum mismatch');
fs.mkdirSync(path.dirname(path.resolve(output)), { recursive: true });
fs.writeFileSync(output, bytes);
console.log(`Verified EZKL public kzg12 SRS (${bytes.length} bytes)`);
