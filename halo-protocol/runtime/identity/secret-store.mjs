import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const REF = /^[a-f0-9]{32,64}$/;

function loadKey(keyFile) {
  const key = fs.readFileSync(keyFile);
  if (key.length !== 32) throw new Error('HALO_SECRET_KEY_FILE must contain exactly 32 raw bytes');
  return key;
}

/** Minimal encrypted-at-rest secret store (AES-256-GCM, one file per secret). Used to hold
 * OAuth refresh tokens keyed by a social binding's opaque secret_ref -- never the binding
 * table itself. Swap this module for a KMS-backed implementation behind the same
 * {put,get,delete} interface before production use: this reference has no key rotation,
 * no audit log and no hardware-backed key protection. Never log a ref's decrypted value. */
export function createSecretStore({ keyFile = process.env.HALO_SECRET_KEY_FILE, directory } = {}) {
  if (!keyFile) throw new Error('HALO_SECRET_KEY_FILE is required');
  if (!directory) throw new Error('Secret store directory is required');
  const key = loadKey(keyFile);
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const file = ref => { if (!REF.test(ref)) throw new Error('Invalid secret reference'); return path.join(directory, `${ref}.bin`); };
  return {
    newRef() { return crypto.randomBytes(32).toString('hex'); },
    async put(ref, value) {
      const iv = crypto.randomBytes(12);
      const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
      const ciphertext = Buffer.concat([cipher.update(Buffer.from(JSON.stringify(value), 'utf8')), cipher.final()]);
      fs.writeFileSync(file(ref), Buffer.concat([iv, cipher.getAuthTag(), ciphertext]), { mode: 0o600 });
    },
    async get(ref) {
      let blob;
      try { blob = fs.readFileSync(file(ref)); } catch (error) { if (error.code === 'ENOENT') return undefined; throw error; }
      if (blob.length < 28) throw new Error('Corrupt secret record');
      const iv = blob.subarray(0, 12), tag = blob.subarray(12, 28), ciphertext = blob.subarray(28);
      const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
      decipher.setAuthTag(tag);
      return JSON.parse(Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8'));
    },
    async delete(ref) {
      try { fs.unlinkSync(file(ref)); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    },
  };
}
