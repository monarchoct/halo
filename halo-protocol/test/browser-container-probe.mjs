// Executed inside the actual browser container. It does not open a browser or social page.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import http from 'node:http';
import { spawnSync } from 'node:child_process';

const passed = [];
assert.equal(process.getuid(), 1000);
const status = fs.readFileSync('/proc/self/status', 'utf8');
assert.match(status, /^CapEff:\s+0+$/m);
assert.match(status, /^NoNewPrivs:\s+1$/m);
assert.match(status, /^Seccomp:\s+2$/m);
passed.push('UID 1000, zero effective capabilities, no new privileges and active seccomp');
assert.throws(() => fs.writeFileSync('/opt/halo-browser/boundary-forbidden', 'x'), /EROFS|EACCES/);
for (const directory of ['/public', '/profile', '/tmp']) fs.writeFileSync(`${directory}/boundary-probe`, 'disposable container acceptance');
assert.equal(fs.existsSync('/var/run/docker.sock'), false);
assert.equal(fs.existsSync('/run/secrets'), false);
for (const name of ['HALO_DATABASE_URL', 'HALO_OPERATOR_KEY', 'PRIVATE_KEY', 'WALLET_PRIVATE_KEY']) assert.equal(process.env[name], undefined);
passed.push('Only intended writable paths are available; no Docker socket, secret mount or operator credentials');
assert.equal(fs.readFileSync('/sys/fs/cgroup/memory.max', 'utf8').trim(), String(4 * 1024 ** 3));
assert.equal(fs.readFileSync('/sys/fs/cgroup/pids.max', 'utf8').trim(), '256');
const [quota, period] = fs.readFileSync('/sys/fs/cgroup/cpu.max', 'utf8').trim().split(' ').map(Number);
assert.equal(quota / period, 2);
passed.push('Actual cgroup limits enforce 4 GiB memory, 256 processes and two CPUs');
const direct = await new Promise(resolve => {
  const socket = net.connect({ host: '1.1.1.1', port: 443 });
  socket.setTimeout(2000);
  const finish = value => { socket.destroy(); resolve(value); };
  socket.once('connect', () => finish('connected'));
  socket.once('error', error => finish(error.code));
  socket.once('timeout', () => finish('timeout'));
});
assert.notEqual(direct, 'connected', 'Browser network unexpectedly has a direct internet route');
passed.push(`Actual internal Docker network blocks direct outbound TCP (${direct})`);
async function connect(authority) {
  return new Promise((resolve, reject) => {
    const request = http.request({ host: 'egress', port: 3128, method: 'CONNECT', path: authority, timeout: 8000 });
    request.once('connect', (response, socket) => { socket.destroy(); resolve(response.statusCode); });
    request.once('error', reject); request.once('timeout', () => request.destroy(new Error('Proxy response timeout')));
    request.end();
  });
}
for (const authority of ['127.0.0.1:443', '169.254.169.254:443', 'example.com:443', 'fomo.family.evil.example:443']) assert.equal(await connect(authority), 403);
passed.push('Running egress service rejects private, metadata, unlisted and lookalike targets');
assert.equal(await connect('fomo.family:443'), 200);
passed.push('Allowed public TLS destination is reachable through the running egress service');
const namespace = spawnSync('unshare', ['--user', '--map-root-user', 'true'], { encoding: 'utf8', timeout: 5000 });
assert.equal(namespace.status, 0, `Unprivileged user namespace unavailable: ${namespace.stderr}`);
passed.push('User namespaces needed by the Chromium sandbox can be created without privileged mode');
const chrootCode = 'import os; os.chroot("/proc/self/fdinfo/"); os.chdir("/")';
const outside = spawnSync('python3', ['-c', chrootCode], { encoding: 'utf8', timeout: 5000 });
assert.equal(outside.status, 1); assert.match(outside.stderr, /PermissionError/);
const inside = spawnSync('unshare', ['--user', '--map-root-user', 'python3', '-c', chrootCode], { encoding: 'utf8', timeout: 5000 });
assert.equal(inside.status, 0, `Chromium filesystem sandbox primitive failed: ${inside.stderr}`);
passed.push('Kernel rejects chroot outside a new user namespace and permits Chromium filesystem isolation inside it');
console.log(JSON.stringify({ passed, scope: 'Actual Linux container boundaries and TCP proxy; no browser UI, account or social post' }));
