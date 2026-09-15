import { createHash, randomUUID } from 'node:crypto';
import { keccak256, toHex } from 'viem';
import { canonicalJson } from '../../sdk/manifest.mjs';
import { safeFetch } from '../../sdk/safe-fetch.mjs';

export const browserFrameMessage = frame => `HALO_BROWSER_FRAME_V1\n${canonicalJson(frame)}`;
export const imageDigest = bytes => `0x${createHash('sha256').update(bytes).digest('hex')}`;
export function imageInfo(bytes) {
  if (bytes.length >= 33 && bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')) && bytes.toString('ascii', 12, 16) === 'IHDR')
    return { mimeType: 'image/png', width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
  if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    let cursor = 2;
    while (cursor + 4 < bytes.length) {
      if (bytes[cursor++] !== 0xff) break;
      while (bytes[cursor] === 0xff) cursor++;
      const marker = bytes[cursor++];
      if (marker === 0xd9 || marker === 0xda) break;
      if (marker === 1 || (marker >= 0xd0 && marker <= 0xd7)) continue;
      const length = bytes.readUInt16BE(cursor);
      if (length < 2 || cursor + length > bytes.length) break;
      if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker) && length >= 8)
        return { mimeType: 'image/jpeg', width: bytes.readUInt16BE(cursor + 5), height: bytes.readUInt16BE(cursor + 3) };
      cursor += length;
    }
  }
  throw new Error('Only bounded PNG/JPEG screen captures are supported');
}

/** Screens are attestations by a named operator, never proof of exclusive model control. */
export function createBrowserPublisher({ wallet, account, deployment, agent, endpoint,
  source = 'production-browser', localOrigins = [], sessionId = randomUUID() }) {
  const operator = typeof account === 'string' ? account : account.address;
  let sequence = 0, previousHash = `0x${'0'.repeat(64)}`;
  let pending;
  return async ({ png, width = 0, height = 0, siteOrigin, activity, state = 'viewing' }) => {
    // An uncertain HTTP response retries the identical signed frame before taking a new one.
    if (!pending) {
      const frame = { version: 'halo.browser-frame.v1', chainId: deployment.chainId, registry: deployment.registry,
        agent, operator, sessionId, sequence, previousHash, timestamp: new Date().toISOString(), source,
        siteOrigin, activity, state, width, height, mimeType: png ? imageInfo(png).mimeType : null, imageHash: png ? imageDigest(png) : null };
      const message = browserFrameMessage(frame);
      pending = { frame, hash: keccak256(toHex(message)), signature: await wallet.signMessage({ account, message }),
        ...(png ? { pngBase64: Buffer.from(png).toString('base64') } : {}) };
    }
    const body = Buffer.from(canonicalJson(pending));
    await safeFetch(`${endpoint}/v1/browser/frames`, { method: 'POST', body, maxBytes: 16384, localOrigins,
      headers: { 'Content-Type': 'application/json', 'Content-Length': String(body.length) } });
    const accepted = pending; previousHash = pending.hash; sequence++; pending = undefined;
    return accepted;
  };
}
