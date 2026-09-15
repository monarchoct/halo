import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { once } from 'node:events';
import { root } from '../scripts/compile.mjs';
import { createEgressProxy, resolveConnectTarget } from '../runtime/browser/egress-proxy.mjs';

const passed = [];
const publicAnswer = [{ address: '1.1.1.1', family: 4 }];
const allowed = ['x.com', '*.x.com', 'fomo.family'];
const lookup = async () => publicAnswer;
assert.deepEqual(await resolveConnectTarget('X.com:443', allowed, lookup), { hostname: 'x.com', address: '1.1.1.1', family: 4, port: 443 });
assert.equal((await resolveConnectTarget('api.x.com:443', allowed, lookup)).hostname, 'api.x.com');
passed.push('Exact host and bounded subdomain matching');
for (const authority of ['x.com.evil.example:443', 'evilx.com:443', 'evilfomo.family:443', 'x.com:80', 'user@x.com:443', 'x.com.:443', '127.0.0.1:443', '[::1]:443', 'x..com:443', 'x.com:443/path'])
  await assert.rejects(resolveConnectTarget(authority, allowed, lookup));
passed.push('Lookalike hosts, credentials, literal IPs and other ports rejected');
for (const address of ['127.0.0.1', '10.0.0.1', '169.254.169.254', '192.168.1.2', '0.0.0.0', '100.64.0.1', '224.0.0.1', '::1', 'fe80::1', 'fc00::1', '::ffff:127.0.0.1'])
  await assert.rejects(resolveConnectTarget('x.com:443', allowed, async () => [{ address, family: net.isIP(address) }]));
passed.push('Private, link-local, mapped, multicast and shared-address space rejected');
await assert.rejects(resolveConnectTarget('x.com:443', allowed, async () => [...publicAnswer, { address: '10.1.2.3', family: 4 }]));
await assert.rejects(resolveConnectTarget('x.com:443', allowed, async () => []));
await assert.rejects(resolveConnectTarget('x.com:443', allowed, async () => { throw new Error('DNS unavailable'); }));
passed.push('Every DNS answer must be public; empty and failed lookups fail closed');
assert.equal((await resolveConnectTarget('x.com:443', allowed, async () => [{ address: '2606:4700:4700::1111', family: 6 }])).family, 6);
passed.push('Public IPv6 is supported');

// An injected upstream echoes bytes locally. This exercises real TCP CONNECT handling,
// not a live social website or the Docker network boundary.
const upstreamSockets = new Set();
const upstream = net.createServer(socket => { upstreamSockets.add(socket); socket.on('close', () => upstreamSockets.delete(socket)); socket.pipe(socket); });
upstream.listen(0, '127.0.0.1'); await once(upstream, 'listening');
const connections = [], dnsQueries = [];
const proxy = createEgressProxy({ allowedHosts: allowed, maxConnections: 1,
  lookup: async hostname => { dnsQueries.push(hostname); return hostname === 'fomo.family' ? [{ address: '10.0.0.1', family: 4 }] : publicAnswer; },
  connect: target => { connections.push(target); return net.connect({ host: '127.0.0.1', port: upstream.address().port }); },
});
proxy.server.listen(0, '127.0.0.1'); await once(proxy.server, 'listening');
const url = `http://127.0.0.1:${proxy.server.address().port}`;
const clients = new Set();
async function request(raw, expected) {
  const socket = net.connect({ host: '127.0.0.1', port: proxy.server.address().port }); clients.add(socket);
  socket.on('close', () => clients.delete(socket)); socket.on('error', () => {});
  let response = '';
  const received = new Promise((resolve, reject) => {
    const timer = setTimeout(() => { socket.destroy(); reject(new Error('Proxy test deadline')); }, 3000);
    socket.on('data', bytes => { response += bytes; if (response.includes(expected)) { clearTimeout(timer); resolve(response); } });
    socket.on('close', () => { clearTimeout(timer); if (!response.includes(expected)) reject(new Error(`Unexpected proxy response: ${response}`)); });
  });
  socket.write(raw); await received; return socket;
}
try {
  assert.equal((await fetch(`${url}/health`)).status, 200);
  assert.equal((await fetch(`${url}/ordinary-request`)).status, 405);
  passed.push('Health is available; ordinary HTTP proxy requests are rejected');
  let client = await request('CONNECT fomo.family:443 HTTP/1.1\r\nHost: fomo.family:443\r\n\r\n', '403 Forbidden');
  client.destroy(); await once(client, 'close');
  assert.equal(connections.length, 0);
  passed.push('Private DNS answers never reach the upstream connector');
  client = await request('CONNECT x.com:443 HTTP/1.1\r\nHost: x.com:443\r\n\r\nfirst-bytes', 'first-bytes');
  assert.deepEqual(connections, [{ host: '1.1.1.1', family: 4, port: 443 }]);
  assert.equal(dnsQueries.filter(name => name === 'x.com').length, 1);
  passed.push('CONNECT preserves initial bytes and pins the checked IP without re-resolution');
  const refused = await request('CONNECT x.com:443 HTTP/1.1\r\nHost: x.com:443\r\n\r\n', '503 Service Unavailable');
  refused.destroy();
  assert.equal(connections.length, 1);
  passed.push('Connection budget prevents opening excess upstream sockets');
  client.destroy();
} finally {
  for (const client of clients) client.destroy();
  await proxy.close();
  for (const socket of upstreamSockets) socket.destroy();
  await new Promise(resolve => upstream.close(resolve));
}
fs.writeFileSync(path.join(root, 'test-results/browser-egress.json'), JSON.stringify({ checkedAt: new Date().toISOString(), scope: 'DNS classification and injected local TCP transport; no Linux container execution', passed }, null, 2));
console.log(`PASS ${passed.length} browser egress scenarios; no external browser or social traffic`);
