import crypto from 'node:crypto';
import { CID } from 'multiformats/cid';
import { sha256 } from 'multiformats/hashes/sha2';
import * as Digest from 'multiformats/hashes/digest';
import { keccak256, toHex } from 'viem';
import { canonicalJson } from './manifest.mjs';
import { safeFetch } from './safe-fetch.mjs';

export async function identify(bytes) {
  const digest = await sha256.digest(bytes);
  return { cid: CID.createV1(0x55, digest).toString(), hash: keccak256(toHex(bytes)), sha256: Buffer.from(digest.digest).toString('hex') };
}
export function evidenceUri(hash) {
  if (!/^0x[0-9a-fA-F]{64}$/.test(hash)) throw new Error('Invalid evidence digest');
  return `ipfs://${CID.createV1(0x55, Digest.create(0x12, Buffer.from(hash.slice(2), 'hex'))).toString()}`;
}
export function parseRawCid(uri) {
  const value = uri.startsWith('ipfs://') ? uri.slice(7) : uri;
  const cid = CID.parse(value);
  if (cid.version !== 1 || cid.code !== 0x55 || cid.multihash.code !== 0x12 || cid.multihash.size !== 32 || cid.toString() !== value) throw new Error('Only canonical SHA-256 raw-block CIDs are accepted');
  return value;
}

/** The operator configures this endpoint. No model or public manifest can select an administrative RPC. */
export function kuboReplica({ apiUrl, authorization }) {
  const base = new URL(apiUrl);
  if (base.pathname !== '/' || base.search || base.hash || base.username || base.password) throw new Error('Kubo API configuration must contain only an origin');
  const localOrigins = base.protocol === 'http:' && ['127.0.0.1', '[::1]'].includes(base.hostname) ? [base.origin] : [];
  const rpc = async (method, query = '', options = {}) => safeFetch(`${base.origin}/api/v0/${method}${query}`, {
    method: 'POST', timeoutMs: 10000, localOrigins, ...options,
    headers: { ...(authorization ? { Authorization: authorization } : {}), ...options.headers },
  });
  return {
    async identity() { return JSON.parse((await rpc('id')).bytes).ID; },
    async get(cid) { return (await rpc('block/get', `?arg=${parseRawCid(cid)}`)).bytes; },
    async put(bytes) {
      if (bytes.length > 262144) throw new Error('Public artifact exceeds 256 KiB');
      const boundary = `halo-${crypto.randomBytes(16).toString('hex')}`;
      const body = Buffer.concat([Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="artifact.json"\r\nContent-Type: application/octet-stream\r\n\r\n`), bytes, Buffer.from(`\r\n--${boundary}--\r\n`)]);
      const response = await rpc('block/put', '?cid-codec=raw&mhtype=sha2-256&pin=true', { body,
        headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}`, 'Content-Length': String(body.length) } });
      const cid = JSON.parse(response.bytes).Key;
      if ((await identify(bytes)).cid !== cid) throw new Error('IPFS node returned a different content identifier');
      const pins = JSON.parse((await rpc('pin/ls', `?arg=${cid}&type=recursive`)).bytes);
      if (!pins.Keys?.[cid]) throw new Error('IPFS node did not report a recursive pin');
      return cid;
    },
  };
}

export function replicatedArtifacts({ replicas, minimumCopies = 3 }) {
  if (minimumCopies < 1 || replicas.length < minimumCopies) throw new Error('Not enough configured artifact replicas');
  async function get(uri) {
    const cid = parseRawCid(uri);
    return Promise.any(replicas.map(async replica => {
      const bytes = await replica.get(cid);
      if (bytes.length > 262144 || (await identify(bytes)).cid !== cid) throw new Error('Artifact integrity check failed');
      return bytes;
    }));
  }
  async function putBytes(bytes) {
    if (bytes.length > 262144) throw new Error('Public artifact exceeds 256 KiB');
    const expected = await identify(bytes);
    const settled = await Promise.allSettled(replicas.map(async replica => {
      const id = await replica.identity();
      if (typeof id !== 'string' || id.length < 10) throw new Error('Replica identity is missing');
      await replica.put(bytes);
      const retrieved = await replica.get(expected.cid);
      if ((await identify(retrieved)).cid !== expected.cid) throw new Error('Replica retrieval failed integrity check');
      return { id, checkedAt: new Date().toISOString() };
    }));
    const verified = [...new Map(settled.filter(value => value.status === 'fulfilled').map(value => [value.value.id, value.value])).values()];
    if (verified.length < minimumCopies) throw new Error(`Artifact available on ${verified.length}/${minimumCopies} distinct IPFS peers`);
    return { ...expected, uri: `ipfs://${expected.cid}`, replicas: verified };
  }
  return { get, putBytes, put: value => putBytes(Buffer.from(canonicalJson(value))) };
}
