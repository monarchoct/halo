import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { createSecretStore } from '../runtime/identity/secret-store.mjs';

const passed = [];
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'halo-secret-store-'));
const keyFile = path.join(directory, 'key.bin');
fs.writeFileSync(keyFile, crypto.randomBytes(32));

const store = createSecretStore({ keyFile, directory: path.join(directory, 'secrets') });
const ref = store.newRef();
assert.match(ref, /^[a-f0-9]{64}$/);
assert.equal(await store.get(ref), undefined);
passed.push('An unwritten reference reads back as undefined');

await store.put(ref, { accessToken: 'super-secret-token', refreshToken: 'super-secret-refresh' });
const raw = fs.readFileSync(path.join(directory, 'secrets', `${ref}.bin`));
assert.equal(raw.includes('super-secret-token'), false);
assert.equal(raw.includes('super-secret-refresh'), false);
passed.push('The plaintext secret never appears in its encrypted-at-rest file');

const roundTrip = await store.get(ref);
assert.deepEqual(roundTrip, { accessToken: 'super-secret-token', refreshToken: 'super-secret-refresh' });
passed.push('A stored secret round-trips exactly through the same key');

await store.put(ref, { accessToken: 'rotated-token' });
assert.deepEqual(await store.get(ref), { accessToken: 'rotated-token' });
passed.push('Re-putting the same reference replaces its value');

await store.delete(ref);
assert.equal(await store.get(ref), undefined);
await store.delete(ref); // deleting twice must not throw
passed.push('Deleting a secret removes it; deleting an already-absent secret is a no-op');

const otherKeyFile = path.join(directory, 'other-key.bin');
fs.writeFileSync(otherKeyFile, crypto.randomBytes(32));
const otherStore = createSecretStore({ keyFile: otherKeyFile, directory: path.join(directory, 'secrets') });
const secondRef = store.newRef();
await store.put(secondRef, { accessToken: 'cross-key-should-not-decrypt' });
await assert.rejects(() => otherStore.get(secondRef));
passed.push('A different key cannot decrypt another key\'s secret (authentication tag rejects it)');

await assert.rejects(() => store.put('not-a-valid-ref', {}), /Invalid secret reference/);
await assert.rejects(() => store.delete('../escape'), /Invalid secret reference/);
passed.push('Malformed references are rejected before touching the filesystem');

assert.throws(() => createSecretStore({ directory: path.join(directory, 'secrets') }), /HALO_SECRET_KEY_FILE/);
assert.throws(() => createSecretStore({ keyFile, directory: undefined }), /directory is required/);
const shortKeyFile = path.join(directory, 'short-key.bin');
fs.writeFileSync(shortKeyFile, crypto.randomBytes(16));
assert.throws(() => createSecretStore({ keyFile: shortKeyFile, directory: path.join(directory, 'secrets') }), /32 raw bytes/);
passed.push('Missing key file, missing directory and a wrong-length key are all rejected');

fs.rmSync(directory, { recursive: true, force: true });
console.log(`PASS ${passed.length} secret-store scenarios`);
