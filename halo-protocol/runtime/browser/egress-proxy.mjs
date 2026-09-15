import http from 'node:http';
import net from 'node:net';
import dns from 'node:dns/promises';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ipaddr from 'ipaddr.js';
import { z } from 'zod';

const publicIp = value => { try { return ipaddr.process(value).range() === 'unicast'; } catch { return false; } };
export async function resolveConnectTarget(authority, allowedHosts, lookup = dns.lookup) {
  if (!/^[a-zA-Z0-9.-]+:443$/.test(authority)) throw new Error('Only named HTTPS destinations on port 443 are allowed');
  const hostname = authority.slice(0, -4).toLowerCase();
  if (hostname.endsWith('.') || net.isIP(hostname) || hostname.includes('..')) throw new Error('A canonical public hostname is required');
  if (!allowedHosts.some(pattern => pattern.startsWith('*.') ? hostname.endsWith(`.${pattern.slice(2)}`) : hostname === pattern))
    throw new Error('Destination is outside this operator configuration');
  const answers = await lookup(hostname, { all: true });
  if (!answers.length || answers.some(answer => !publicIp(answer.address))) throw new Error('Destination resolves to a private or reserved network');
  const chosen = answers.find(answer => answer.family === 4) ?? answers[0];
  return { hostname, address: chosen.address, family: chosen.family, port: 443 };
}

export function createEgressProxy({ allowedHosts, maxConnections = 64, lookup = dns.lookup, connect = net.connect }) {
  z.array(z.string().regex(/^(\*\.)?[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/)).min(1).max(100).parse(allowedHosts);
  z.number().int().min(1).max(256).parse(maxConnections);
  const sockets = new Set(); let active = 0;
  const server = http.createServer((request, response) => {
    if (request.method === 'GET' && request.url === '/health') { response.writeHead(200, { 'Content-Type': 'application/json' }); response.end(JSON.stringify({ service: 'halo-browser-egress', active })); }
    else { response.writeHead(405); response.end('HTTPS CONNECT is required'); }
  });
  server.maxHeadersCount = 30; server.headersTimeout = 10000; server.requestTimeout = 10000;
  server.on('connection', socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
  server.on('clientError', (_error, socket) => socket.destroy());
  server.on('connect', async (request, socket, head) => {
    if (active >= maxConnections) { socket.end('HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n'); return; }
    active++;
    let upstream, dnsTimer, total = 0, closed = false;
    const close = () => { if (closed) return; closed = true; active--; clearTimeout(deadline); clearTimeout(dnsTimer); socket.destroy(); upstream?.destroy(); };
    const deadline = setTimeout(close, 600000);
    socket.on('error', close); socket.on('close', close); socket.setTimeout(30000, close);
    try {
      const target = await Promise.race([
        resolveConnectTarget(request.url, allowedHosts, lookup),
        new Promise((_resolve, reject) => { dnsTimer = setTimeout(() => reject(new Error('DNS deadline')), 5000); dnsTimer.unref(); }),
      ]);
      clearTimeout(dnsTimer);
      if (closed) return;
      // Connect to the checked IP, never resolve the hostname again. Chromium verifies the remote TLS certificate.
      upstream = connect({ host: target.address, family: target.family, port: 443 });
      upstream.setTimeout(30000, close); upstream.on('error', close); upstream.on('close', close);
      const count = chunk => { total += chunk.length; if (total > 64 * 1024 * 1024) close(); };
      socket.on('data', count); upstream.on('data', count);
      upstream.once('connect', () => {
        if (closed) return;
        socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
        if (head.length) { total += head.length; upstream.write(head); }
        socket.pipe(upstream); upstream.pipe(socket);
      });
    } catch {
      clearTimeout(dnsTimer);
      if (!closed) socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
    }
  });
  return { server, async close() { for (const socket of sockets) socket.destroy(); await new Promise(resolve => server.close(resolve)); } };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!process.argv[2]) throw new Error('Usage: node egress-proxy.mjs egress.json');
  const config = z.object({ allowedHosts: z.array(z.string()).min(1).max(100), port: z.number().int().min(1024).max(65535).default(3128) }).strict().parse(JSON.parse(fs.readFileSync(process.argv[2])));
  const proxy = createEgressProxy(config);
  await new Promise(resolve => proxy.server.listen(config.port, '0.0.0.0', resolve));
  console.log(JSON.stringify({ service: 'halo-browser-egress', port: config.port, hostCount: config.allowedHosts.length }));
  await new Promise(resolve => { process.once('SIGINT', resolve); process.once('SIGTERM', resolve); });
  await proxy.close();
}
