import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import ssh2 from 'ssh2';
import net from 'node:net';

const lab = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../work/linux-lab');
const keyLine = fs.readFileSync(path.join(lab, 'private/known_hosts'), 'utf8').trim().split(/\s+/);
if (keyLine[0] !== '[127.0.0.1]:22240' || keyLine[1] !== 'ssh-ed25519') throw new Error('Unexpected lab SSH identity');
const expectedHostHash = createHash('sha256').update(Buffer.from(keyLine[2], 'base64')).digest('hex');
let input = '';
for await (const chunk of process.stdin) { input += chunk; if (input.length > 20_000) throw new Error('Oversized credential input'); }
const privateKey = Buffer.from(input.trim(), 'base64');
input = '';
if (!privateKey.toString('ascii').startsWith('-----BEGIN OPENSSH PRIVATE KEY-----')) throw new Error('Expected a decrypted lab key on stdin');
const [operation, ...args] = process.argv.slice(2);
const connection = new ssh2.Client();
const tunnels = new Set(), sockets = new Set();
let databaseServer;
connection.on('tcp connection', (info, accept, reject) => {
  if (info.destIP !== '127.0.0.1' || !tunnels.has(info.destPort)) return reject();
  const socket = net.connect({ host: '127.0.0.1', port: info.destPort });
  const channel = accept(); sockets.add(socket);
  socket.on('error', () => channel.destroy()); channel.on('error', () => socket.destroy());
  socket.on('close', () => { sockets.delete(socket); channel.destroy(); }); channel.on('close', () => socket.destroy());
  socket.pipe(channel).pipe(socket);
});
connection.on('error', error => { console.error(`Lab SSH: ${error.message}`); process.exitCode = 1; });
connection.on('close', () => { privateKey.fill(0); databaseServer?.close(); for (const socket of sockets) socket.destroy(); });
connection.on('ready', () => {
  if (operation === 'exec') {
    if (args.length !== 1) throw new Error('Supply exactly one explicit remote command');
    connection.exec(args[0], (error, stream) => {
      if (error) { console.error(error.message); process.exitCode = 1; connection.end(); return; }
      stream.pipe(process.stdout); stream.stderr.pipe(process.stderr);
      stream.on('close', code => { process.exitCode = code ?? 1; connection.end(); });
    });
  } else if (operation === 'tunnel') {
    // Only the explicitly selected local preview RPC/relay are reachable on guest loopback.
    // This runs on the trusted operator host; the browser has neither this connection nor a signing key.
    if (args.length !== 1 || !['8547,8795', '8793'].includes(args[0])) { console.error('Only the trading-preview RPC/relay or its read-only artifact gateway is supported'); process.exitCode = 1; connection.end(); return; }
    const ports = args[0].split(',').map(Number);
    let pending = ports.length;
    for (const port of ports) {
      tunnels.add(port);
      connection.forwardIn('127.0.0.1', port, error => {
        if (error) { console.error(`Local tunnel ${port}: ${error.message}`); process.exitCode = 1; connection.end(); return; }
        if (--pending === 0) console.log(`Lab loopback tunnel ready: ${ports.join(',')}`);
      });
    }
    process.once('SIGINT', () => connection.end()); process.once('SIGTERM', () => connection.end());
  } else if (operation === 'database-tunnel') {
    // Fixed loopback endpoints only: the native model worker reaches the Linux
    // database over pinned SSH. No PostgreSQL port is exposed to the LAN/browser.
    if (args.length !== 1 || args[0] !== '54330:54329') { console.error('Only the fixed local database tunnel is supported'); process.exitCode = 1; connection.end(); return; }
    databaseServer = net.createServer(socket => {
      sockets.add(socket);
      socket.once('close', () => sockets.delete(socket));
      socket.on('error', () => socket.destroy());
      connection.forwardOut('127.0.0.1', socket.remotePort ?? 0, '127.0.0.1', 54329, (error, channel) => {
        if (error || socket.destroyed) { socket.destroy(); channel?.destroy(); return; }
        channel.on('error', () => socket.destroy());
        channel.once('close', () => socket.destroy());
        socket.once('close', () => channel.destroy());
        socket.pipe(channel).pipe(socket);
      });
    });
    databaseServer.on('error', () => { console.error('Local database tunnel could not listen'); process.exitCode = 1; connection.end(); });
    databaseServer.listen(54330, '127.0.0.1', () => console.log('Pinned SSH database tunnel ready on 127.0.0.1:54330'));
    process.once('SIGINT', () => connection.end()); process.once('SIGTERM', () => connection.end());
  } else if (operation === 'put' || operation === 'get') {
    if (args.length !== 2) throw new Error('Supply source and destination');
    connection.sftp((error, sftp) => {
      if (error) { console.error(error.message); process.exitCode = 1; connection.end(); return; }
      const method = operation === 'put' ? 'fastPut' : 'fastGet';
      sftp[method](args[0], args[1], transferError => {
        if (transferError) { console.error(transferError.message); process.exitCode = 1; }
        else console.log(`Lab ${operation} completed`);
        connection.end();
      });
    });
  } else { console.error('Use exec, put, get, tunnel, or database-tunnel'); process.exitCode = 1; connection.end(); }
});
connection.connect({ host: '127.0.0.1', port: 22240, username: 'halo', privateKey, hostHash: 'sha256',
  hostVerifier: actual => actual === expectedHostHash, readyTimeout: 60_000, keepaliveInterval: 10_000, keepaliveCountMax: 6 });
