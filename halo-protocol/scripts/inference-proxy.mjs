#!/usr/bin/env node
/**
 * Loopback bridge to a remote inference server for development on one machine.
 *
 *   node scripts/inference-proxy.mjs http://<lease-host>.ingress.<provider> [port=8080]
 *
 * The runtime only talks plain HTTP to loopback (or HTTPS to public hosts). Until the Akash endpoint sits behind a
 * real TLS hostname, this listens on 127.0.0.1 and forwards each request unchanged — including the Authorization
 * header the runtime adds itself. Nothing is logged except method, path and status. Development only.
 */
import http from 'node:http';

const target = new URL(process.argv[2] ?? ''), port = Number(process.argv[3] ?? 8080);
if (!['http:', 'https:'].includes(target.protocol)) throw new Error('Usage: node scripts/inference-proxy.mjs <backend origin> [port]');
const server = http.createServer(async (request, response) => {
  const chunks = []; for await (const chunk of request) chunks.push(chunk);
  const body = Buffer.concat(chunks);
  try {
    const headers = { ...request.headers }; delete headers.host; delete headers.connection; delete headers['content-length'];
    const upstream = await fetch(new URL(request.url, target.origin), { method: request.method, headers, body: body.length ? body : undefined, redirect: 'manual', signal: AbortSignal.timeout(120000) });
    const bytes = Buffer.from(await upstream.arrayBuffer());
    response.writeHead(upstream.status, { 'content-type': upstream.headers.get('content-type') ?? 'application/octet-stream', 'content-length': String(bytes.length) });
    response.end(bytes);
    console.log(`${request.method} ${request.url} → ${upstream.status} (${bytes.length} bytes)${upstream.status >= 400 ? ' ' + bytes.toString('utf8').slice(0, 300) : ''}`);
  } catch (error) { response.writeHead(502, { 'content-type': 'application/json' }); response.end(JSON.stringify({ error: 'upstream unavailable' })); console.log(`${request.method} ${request.url} → 502 ${error.message}`); }
});
server.listen(port, '127.0.0.1', () => console.log(`inference proxy http://127.0.0.1:${port} → ${target.origin}`));
