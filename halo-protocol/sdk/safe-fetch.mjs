import dns from 'node:dns/promises';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import ipaddr from 'ipaddr.js';

export class SafeFetchHttpError extends Error {
  constructor(statusCode) {
    super(`Public source returned HTTP ${statusCode}; redirects are not followed`);
    this.name = 'SafeFetchHttpError'; this.statusCode = statusCode;
  }
}

export function isPublicAddress(address) {
  try { return ipaddr.process(address).range() === 'unicast'; } catch { return false; }
}

/** No proxy inheritance, redirects, DNS rebinding, cookies, or implicit credential forwarding. */
export async function safeFetch(value, { method = 'GET', body, headers = {}, maxBytes = 262144,
  timeoutMs = 15000, localOrigins = [], lookup = dns.lookup } = {}) {
  const url = new URL(value);
  if (url.username || url.password || url.hash) throw new Error('Credentials and fragments are not allowed in public URLs');
  const host = url.hostname.replace(/^\[|\]$/g, '');
  const local = localOrigins.includes(url.origin) && ['127.0.0.1', '::1'].includes(host);
  if (!local && (url.protocol !== 'https:' || (url.port && url.port !== '443'))) throw new Error('Public URLs require HTTPS on port 443');
  if (local && !['http:', 'https:'].includes(url.protocol)) throw new Error('Invalid local transport');
  const answers = net.isIP(host) ? [{ address: host, family: net.isIP(host) }] : await lookup(host, { all: true });
  if (!answers.length || (!local && answers.some(answer => !isPublicAddress(answer.address)))) throw new Error('URL resolves to a non-public network');
  const chosen = answers.find(answer => answer.family === 4) ?? answers[0];
  // Resolve once and pin the connection to that answer, preserving TLS hostname verification.
  return new Promise((resolve, reject) => {
    const request = (url.protocol === 'https:' ? https : http).request(url, {
      method, agent: false, autoSelectFamily: false,
      lookup: (_hostname, options, callback) => options.all ? callback(null, [chosen]) : callback(null, chosen.address, chosen.family),
      headers: { Accept: 'application/json', 'Accept-Encoding': 'identity', 'User-Agent': 'HALO-Operator/0.1', ...headers },
    }, response => {
      if (response.statusCode < 200 || response.statusCode >= 300) { response.resume(); reject(new SafeFetchHttpError(response.statusCode)); return; }
      if (response.headers['content-encoding'] && response.headers['content-encoding'] !== 'identity') { response.destroy(); reject(new Error('Compressed source responses are not accepted')); return; }
      let size = 0;
      const chunks = [];
      response.on('data', chunk => { size += chunk.length; if (size > maxBytes) response.destroy(new Error('Public source exceeds the byte limit')); else chunks.push(chunk); });
      response.on('error', reject);
      response.on('end', () => resolve({ bytes: Buffer.concat(chunks), contentType: String(response.headers['content-type'] ?? ''), url: url.href }));
    });
    const deadline = setTimeout(() => request.destroy(new Error('Public source timed out')), timeoutMs);
    request.on('close', () => clearTimeout(deadline));
    request.on('error', reject);
    if (body) request.write(body);
    request.end();
  });
}
