import fs from 'node:fs';
import path from 'node:path';
import { randomUUID, randomBytes, createHash, createCipheriv, createDecipheriv, hkdfSync } from 'node:crypto';
import { z } from 'zod';

// --- Minimal USTAR reader/writer for a plain directory tree (files and directories only). ---
// No symlinks, devices or long-name GNU extensions beyond the standard ustar prefix split.
// Deterministic (mtime/uid/gid zeroed) so identical profile contents produce identical archives.

function octalField(value, length) { return value.toString(8).padStart(length - 1, '0') + '\0'; }

function splitTarName(relPath) {
  const bytes = Buffer.byteLength(relPath, 'utf8');
  if (bytes <= 100) return { name: relPath, prefix: '' };
  const parts = relPath.split('/');
  for (let i = parts.length - 1; i > 0; i--) {
    const prefix = parts.slice(0, i).join('/'), name = parts.slice(i).join('/');
    if (Buffer.byteLength(prefix, 'utf8') <= 155 && Buffer.byteLength(name, 'utf8') <= 100) return { name, prefix };
  }
  throw new Error(`Profile entry path is too long for a tar archive: ${relPath}`);
}

function tarHeader({ relPath, size, typeflag }) {
  const { name, prefix } = splitTarName(relPath);
  const buf = Buffer.alloc(512);
  buf.write(name, 0, 100, 'utf8');
  buf.write(octalField(typeflag === '5' ? 0o755 : 0o644, 8), 100, 8, 'ascii');
  buf.write(octalField(0, 8), 108, 8, 'ascii');
  buf.write(octalField(0, 8), 116, 8, 'ascii');
  buf.write(octalField(size, 12), 124, 12, 'ascii');
  buf.write(octalField(0, 12), 136, 12, 'ascii');
  buf.write('        ', 148, 8, 'ascii');
  buf.write(typeflag, 156, 1, 'ascii');
  buf.write('ustar\0', 257, 6, 'ascii');
  buf.write('00', 263, 2, 'ascii');
  buf.write(prefix, 345, 155, 'utf8');
  let checksum = 0;
  for (const byte of buf) checksum += byte;
  buf.write(`${checksum.toString(8).padStart(6, '0')}\0 `, 148, 8, 'ascii');
  return buf;
}

function padTo512(buffer) {
  const remainder = buffer.length % 512;
  return remainder === 0 ? buffer : Buffer.concat([buffer, Buffer.alloc(512 - remainder)]);
}

/** Deterministically tar a plain directory tree. Refuses symlinks and anything but files/directories. */
export function tarDirectory(rootDir) {
  const chunks = [];
  function walk(dir, relPrefix) {
    const entries = fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const rel = relPrefix ? `${relPrefix}/${entry.name}` : entry.name;
      const full = path.join(dir, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`Profile directory must not contain symlinks: ${rel}`);
      if (entry.isDirectory()) {
        chunks.push(tarHeader({ relPath: `${rel}/`, size: 0, typeflag: '5' }));
        walk(full, rel);
      } else if (entry.isFile()) {
        const bytes = fs.readFileSync(full);
        chunks.push(tarHeader({ relPath: rel, size: bytes.length, typeflag: '0' }), padTo512(bytes));
      } else throw new Error(`Unsupported profile directory entry: ${rel}`);
    }
  }
  walk(rootDir, '');
  chunks.push(Buffer.alloc(1024));
  return Buffer.concat(chunks);
}

function readOctal(buf) {
  const text = buf.toString('ascii').replace(/\0.*$/s, '').trim();
  return text ? parseInt(text, 8) : 0;
}

/** Inverse of tarDirectory. Refuses path traversal, absolute paths and anything but files/directories. */
export function untarToDirectory(buffer, destDir) {
  let offset = 0;
  while (offset + 512 <= buffer.length) {
    const header = buffer.subarray(offset, offset + 512);
    if (header.every(byte => byte === 0)) break;
    const prefix = header.subarray(345, 500).toString('utf8').replace(/\0.*$/s, '');
    const name = header.subarray(0, 100).toString('utf8').replace(/\0.*$/s, '');
    const relPath = prefix ? `${prefix}/${name}` : name;
    const size = readOctal(header.subarray(124, 136));
    const typeflag = String.fromCharCode(header[156]) || '0';
    offset += 512;
    if (relPath.includes('..') || path.isAbsolute(relPath)) throw new Error(`Refusing an unsafe archive entry path: ${relPath}`);
    const target = path.join(destDir, relPath);
    if (typeflag === '5' || relPath.endsWith('/')) fs.mkdirSync(target, { recursive: true, mode: 0o700 });
    else if (typeflag === '0' || typeflag === '\0') {
      fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
      const content = buffer.subarray(offset, offset + size);
      if (content.length !== size) throw new Error('Truncated archive entry');
      fs.writeFileSync(target, content, { mode: 0o600 });
    } else throw new Error(`Unsupported archive entry type for ${relPath}`);
    offset += Math.ceil(size / 512) * 512;
  }
}

// --- Encrypted, per-agent snapshot envelope over an injected object store. ---

const agentAddress = z.string().regex(/^0x[0-9a-fA-F]{40}$/);
const base64 = z.string().regex(/^[A-Za-z0-9+/]+=*$/);
const envelopeSchema = z.object({
  version: z.literal('halo.profile-snapshot.v1'), agent: agentAddress, createdAt: z.string().datetime(),
  iv: base64, authTag: base64, sha256: z.string().regex(/^[a-f0-9]{64}$/),
  size: z.number().int().min(0), ciphertext: base64,
}).strict();

const SLOTS = 3;
const slotKey = (agent, slot) => `profiles/${agent}/slot-${slot}.json`;

async function readSlots(store, agent) {
  const keys = await store.list(`profiles/${agent}/`);
  const slots = [];
  for (const key of keys) {
    const match = /\/slot-([0-2])\.json$/.exec(key);
    if (!match) continue;
    let envelope;
    try { envelope = envelopeSchema.parse(JSON.parse((await store.get(key)).toString('utf8'))); } catch { continue; }
    if (envelope.agent !== agent) continue;
    slots.push({ key, slot: Number(match[1]), envelope });
  }
  return slots;
}

function deriveKey(keyBytes, agent) {
  if (!keyBytes || keyBytes.length < 16) throw new Error('A per-agent snapshot key requires at least 16 bytes of key material');
  const info = Buffer.from(`halo-profile-snapshot:${agent}`, 'utf8');
  return Buffer.from(hkdfSync('sha256', keyBytes, Buffer.alloc(32), info, 32));
}

/** Tar, encrypt (AES-256-GCM, per-agent HKDF key) and upload one profile directory snapshot, keeping the last 3. */
export async function snapshot({ profileDir, store, keyBytes, agent }) {
  const address = agentAddress.parse(agent).toLowerCase();
  const resolved = fs.realpathSync(profileDir);
  if (!fs.statSync(resolved).isDirectory()) throw new Error('Profile directory does not exist');
  const tar = tarDirectory(resolved);
  const key = deriveKey(keyBytes, address);
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(tar), cipher.final()]);
  const envelope = { version: 'halo.profile-snapshot.v1', agent: address, createdAt: new Date().toISOString(),
    iv: iv.toString('base64'), authTag: cipher.getAuthTag().toString('base64'),
    sha256: createHash('sha256').update(tar).digest('hex'), size: tar.length, ciphertext: ciphertext.toString('base64') };
  const existing = await readSlots(store, address);
  const used = new Set(existing.map(entry => entry.slot));
  const target = [0, 1, 2].find(slot => !used.has(slot))
    ?? existing.reduce((oldest, entry) => entry.envelope.createdAt < oldest.envelope.createdAt ? entry : oldest).slot;
  const key2 = slotKey(address, target);
  await store.put(key2, Buffer.from(JSON.stringify(envelope)));
  return { key: key2, slot: target, sha256: envelope.sha256, size: envelope.size, createdAt: envelope.createdAt };
}

/**
 * Restore the most recent snapshot for `agent` into `profileDir`. Any integrity failure (bad
 * signature/tag, checksum mismatch, corrupt archive) throws before touching `profileDir` at all;
 * a partially-restored profile is never left on disk.
 */
export async function restore({ profileDir, store, keyBytes, agent }) {
  const address = agentAddress.parse(agent).toLowerCase();
  const slots = await readSlots(store, address);
  if (!slots.length) throw new Error('No snapshot is available to restore for this agent');
  const latest = slots.reduce((newest, entry) => entry.envelope.createdAt > newest.envelope.createdAt ? entry : newest);
  const key = deriveKey(keyBytes, address);
  const iv = Buffer.from(latest.envelope.iv, 'base64'), authTag = Buffer.from(latest.envelope.authTag, 'base64');
  if (iv.length !== 12 || authTag.length !== 16) throw new Error('Corrupt snapshot envelope: unexpected IV or authentication tag length');
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);
  let tar;
  try { tar = Buffer.concat([decipher.update(Buffer.from(latest.envelope.ciphertext, 'base64')), decipher.final()]); }
  catch { throw new Error('Snapshot failed integrity verification; refusing to restore'); }
  if (tar.length !== latest.envelope.size || createHash('sha256').update(tar).digest('hex') !== latest.envelope.sha256)
    throw new Error('Snapshot checksum mismatch; refusing to restore');
  const staging = `${profileDir}.restore-${randomUUID()}`;
  fs.mkdirSync(staging, { recursive: true, mode: 0o700 });
  try { untarToDirectory(tar, staging); }
  catch (error) { fs.rmSync(staging, { recursive: true, force: true }); throw error; }
  if (fs.existsSync(profileDir)) fs.rmSync(profileDir, { recursive: true, force: true });
  fs.renameSync(staging, profileDir);
  return { key: latest.key, slot: latest.slot, sha256: latest.envelope.sha256, createdAt: latest.envelope.createdAt };
}
