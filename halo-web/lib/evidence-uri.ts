import type { Hash } from "viem";

/** Canonical raw-block CIDv1, SHA-256 digest. Same representation as the public operator SDK. */
export function evidenceUri(hash: Hash): string {
  if (!/^0x[0-9a-fA-F]{64}$/.test(hash)) throw new Error("Invalid evidence digest");
  const bytes = [1, 0x55, 0x12, 32, ...Array.from({ length: 32 }, (_, i) => Number.parseInt(hash.slice(2 + i * 2, 4 + i * 2), 16))];
  const alphabet = "abcdefghijklmnopqrstuvwxyz234567";
  let bits = 0, buffer = 0, encoded = "";
  for (const byte of bytes) { buffer = (buffer << 8) | byte; bits += 8; while (bits >= 5) { bits -= 5; encoded += alphabet[(buffer >>> bits) & 31]; } }
  if (bits) encoded += alphabet[(buffer << (5 - bits)) & 31];
  return `ipfs://b${encoded}`;
}
