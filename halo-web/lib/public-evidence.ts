export function rawCid(bytes: Uint8Array): string {
  const alphabet = "abcdefghijklmnopqrstuvwxyz234567";
  const prefixed = new Uint8Array([1, 0x55, 0x12, 32, ...bytes]);
  let bits = 0, value = 0, result = "b";
  for (const byte of prefixed) { value = (value << 8) | byte; bits += 8; while (bits >= 5) { result += alphabet[(value >>> (bits - 5)) & 31]; bits -= 5; } }
  if (bits) result += alphabet[(value << (5 - bits)) & 31];
  return result;
}
export function evidenceCid(hex: string): string {
  if (!/^0x[0-9a-fA-F]{64}$/.test(hex)) throw new Error("Invalid evidence commitment.");
  return rawCid(Uint8Array.from(hex.slice(2).match(/../g)!, byte => parseInt(byte, 16)));
}
export async function publicArtifact(base: string, cid: string) {
  if (!/^bafkrei[a-z2-7]{52}$/.test(cid)) throw new Error("Unsupported public artifact identifier.");
  const response = await fetch(`${base}/ipfs/${cid}`, { signal: AbortSignal.timeout(15000) });
  if (!response.ok || !response.body) throw new Error("Public evidence is unavailable from this gateway.");
  const reader = response.body.getReader(), chunks: Uint8Array[] = []; let size = 0;
  try { while (true) { const item = await reader.read(); if (item.done) break; size += item.value.length;
    if (size > 262144) throw new Error("Evidence exceeds the public artifact limit."); chunks.push(item.value); } }
  finally { await reader.cancel(); }
  const bytes = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  if (rawCid(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))) !== cid) throw new Error("Public evidence failed its content-hash check.");
  return JSON.parse(new TextDecoder().decode(bytes));
}
