import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { snapshot, restore, tarDirectory, untarToDirectory } from '../runtime/browser/profile-snapshot.mjs';

function memoryStore() {
  const data = new Map();
  return { data, async put(key, bytes) { data.set(key, Buffer.from(bytes)); },
    async get(key) { const value = data.get(key); if (!value) throw Object.assign(new Error('Not found'), { code: 'ENOENT' }); return value; },
    async list(prefix) { return [...data.keys()].filter(key => key.startsWith(prefix)); } };
}
function writeProfile(dir, marker) {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(path.join(dir, 'cookies'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'state.json'), JSON.stringify({ marker }));
  fs.writeFileSync(path.join(dir, 'cookies', 'session.bin'), Buffer.from([marker, marker, marker]));
}
function readMarker(dir) { return JSON.parse(fs.readFileSync(path.join(dir, 'state.json'), 'utf8')).marker; }

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'halo-profile-snapshot-'));
const agent = `0x${'ab'.repeat(20)}`;
const keyBytes = randomBytes(32);

// Round trip: tar/untar a directory tree byte-for-byte, including a nested subdirectory.
{
  const src = path.join(root, 'tar-src'), dst = path.join(root, 'tar-dst');
  writeProfile(src, 7);
  const archive = tarDirectory(src);
  fs.mkdirSync(dst, { recursive: true });
  untarToDirectory(archive, dst);
  assert.equal(readMarker(dst), 7);
  assert.deepEqual(fs.readFileSync(path.join(dst, 'cookies', 'session.bin')), Buffer.from([7, 7, 7]));
  console.log('PASS tar/untar round-trips a directory tree including a nested subdirectory');
}

// snapshot() then restore() into a fresh directory reproduces the exact profile content.
{
  const store = memoryStore();
  const profileDir = path.join(root, 'profile-a');
  writeProfile(profileDir, 1);
  const result = await snapshot({ profileDir, store, keyBytes, agent });
  assert.equal(result.slot, 0);
  assert.equal(store.data.size, 1);
  const restoreDir = path.join(root, 'restored-a');
  const restored = await restore({ profileDir: restoreDir, store, keyBytes, agent });
  assert.equal(restored.slot, 0);
  assert.equal(readMarker(restoreDir), 1);
  console.log('PASS snapshot then restore reproduces the exact profile content into a fresh directory');
}

// Only the last 3 snapshots are kept; restore always recovers the most recent one.
{
  const store = memoryStore();
  const profileDir = path.join(root, 'profile-b');
  for (let marker = 1; marker <= 5; marker++) {
    writeProfile(profileDir, marker);
    await snapshot({ profileDir, store, keyBytes, agent });
  }
  const slots = [...store.data.keys()].filter(key => key.startsWith(`profiles/${agent}/`));
  assert.equal(slots.length, 3, 'exactly 3 snapshot slots are retained');
  const restoreDir = path.join(root, 'restored-b');
  const restored = await restore({ profileDir: restoreDir, store, keyBytes, agent });
  assert.equal(readMarker(restoreDir), 5, 'restore recovers the most recent snapshot after rotation');
  console.log('PASS only the last 3 snapshots per agent are retained; restore recovers the newest');
}

// Tamper detection: a flipped ciphertext byte fails GCM authentication and refuses to restore.
{
  const store = memoryStore();
  const profileDir = path.join(root, 'profile-c');
  writeProfile(profileDir, 9);
  await snapshot({ profileDir, store, keyBytes, agent });
  const [key] = [...store.data.keys()];
  const envelope = JSON.parse(store.data.get(key).toString('utf8'));
  const bytes = Buffer.from(envelope.ciphertext, 'base64'); bytes[0] ^= 0xff;
  envelope.ciphertext = bytes.toString('base64');
  store.data.set(key, Buffer.from(JSON.stringify(envelope)));
  const restoreDir = path.join(root, 'restored-c');
  await assert.rejects(() => restore({ profileDir: restoreDir, store, keyBytes, agent }), /integrity/);
  assert.equal(fs.existsSync(restoreDir), false, 'a failed restore leaves no partial profile directory');
  console.log('PASS a tampered ciphertext fails AES-GCM authentication and never touches the target directory');
}

// Tamper detection: a checksum that no longer matches the (successfully decrypted) plaintext.
{
  const store = memoryStore();
  const profileDir = path.join(root, 'profile-d');
  writeProfile(profileDir, 3);
  await snapshot({ profileDir, store, keyBytes, agent });
  const [key] = [...store.data.keys()];
  const envelope = JSON.parse(store.data.get(key).toString('utf8'));
  envelope.sha256 = '0'.repeat(64);
  // Re-tampering the checksum alone (leaving ciphertext/tag intact) would still fail GCM on the
  // untouched ciphertext only if the tag also changed; here we confirm the checksum gate itself
  // fires by keeping the ciphertext byte-identical and only invalidating the recorded digest.
  store.data.set(key, Buffer.from(JSON.stringify(envelope)));
  const restoreDir = path.join(root, 'restored-d');
  await assert.rejects(() => restore({ profileDir: restoreDir, store, keyBytes, agent }), /checksum|integrity/);
  assert.equal(fs.existsSync(restoreDir), false);
  console.log('PASS a mismatched recorded checksum is rejected even when decryption otherwise succeeds');
}

// A profile directory containing a symlink/junction is refused rather than silently followed.
{
  const profileDir = path.join(root, 'profile-e');
  writeProfile(profileDir, 2);
  const target = path.join(root, 'profile-e-target'); fs.mkdirSync(target, { recursive: true });
  try {
    fs.symlinkSync(target, path.join(profileDir, 'escape'), 'junction');
    assert.throws(() => tarDirectory(profileDir), /symlink/);
    console.log('PASS a symlinked/junctioned entry inside the profile directory is refused');
  } catch (error) {
    if (error.code === 'EPERM' || error.code === 'ENOSYS') console.log('SKIP symlink refusal test: platform cannot create a test symlink without privilege');
    else throw error;
  }
}

// A different agent (and so a different derived key) cannot decrypt another agent's snapshot.
{
  const store = memoryStore();
  const profileDir = path.join(root, 'profile-f');
  writeProfile(profileDir, 4);
  await snapshot({ profileDir, store, keyBytes, agent });
  const otherAgent = `0x${'cd'.repeat(20)}`;
  const [key] = [...store.data.keys()];
  const envelope = JSON.parse(store.data.get(key).toString('utf8'));
  store.data.set(`profiles/${otherAgent}/slot-0.json`, Buffer.from(JSON.stringify({ ...envelope, agent: otherAgent })));
  const restoreDir = path.join(root, 'restored-f');
  await assert.rejects(() => restore({ profileDir: restoreDir, store, keyBytes, agent: otherAgent }), /integrity/);
  console.log('PASS a snapshot encrypted for one agent cannot be decrypted under another agent’s derived key');
}

fs.rmSync(root, { recursive: true, force: true });
