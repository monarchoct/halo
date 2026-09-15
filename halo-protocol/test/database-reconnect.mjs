import assert from 'node:assert/strict';
import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import { openDatabase } from '../services/persistence/database.mjs';
import { root } from '../scripts/compile.mjs';

// Dedicated disposable cluster only. Never terminates sessions on an agent database.
const password = fs.readFileSync(path.join(root, '../../work/postgres-private/password.txt'), 'utf8').trim();
const url = new URL('postgresql://halo_recovery@127.0.0.1:54331/postgres');
url.password = password;
const admin = openDatabase({ url: url.toString(), local: true });
const databaseName = `halo_reconnect_${randomBytes(6).toString('hex')}`;
let database;
const leased = new Set();
const connections = new Set();
const proxy = net.createServer(front => {
  const back = net.connect({host:'127.0.0.1',port:54331});
  connections.add(front); connections.add(back);
  for(const socket of [front,back]) {
    socket.on('error',()=>{});
    socket.on('close',()=>{connections.delete(socket);front.destroy();back.destroy();});
  }
  front.pipe(back).pipe(front);
});
await new Promise(resolve=>proxy.listen(0,'127.0.0.1',resolve));
const passed = [];
const pass = label => { passed.push(label); console.log(`PASS ${label}`); };
try {
  const version = Number((await admin.pool.query('SHOW server_version_num')).rows[0].server_version_num);
  assert(version >= 170000 && version < 180000);
  await admin.pool.query(`CREATE DATABASE "${databaseName}"`);
  url.pathname = `/${databaseName}`;
  url.port = String(proxy.address().port);
  database = openDatabase({ url: url.toString(), local: true, maxConnections: 1 });
  const terminate = async pid => {
    assert(connections.size > 0);
    assert((await admin.pool.query('SELECT pid FROM pg_stat_activity WHERE pid=$1 AND datname=$2',[pid,databaseName])).rowCount === 1);
    // Interrupt only this test's proxy transports, never signal another process.
    for(const socket of connections)socket.destroy();
  };  await database.pool.query('CREATE TABLE recovery_probe(nonce integer PRIMARY KEY, payload text NOT NULL)');
  const client = await database.pool.connect(); leased.add(client);
  const pid = (await client.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
  await client.query('BEGIN');
  await client.query('INSERT INTO recovery_probe VALUES(1, $1)', ['uncommitted']);
  await terminate(pid);
  await sleep(100);
  await assert.rejects(client.query('COMMIT'));
  client.release(new Error('Known disconnected session')); leased.delete(client);
  const recovered = await database.pool.query('SELECT pg_backend_pid() AS pid, (SELECT count(*)::int FROM recovery_probe) AS count');
  assert.notEqual(recovered.rows[0].pid, pid);
  assert.equal(recovered.rows[0].count, 0);
  pass('Leased connection termination preserves process, replaces backend and rolls back uncommitted work');

  await database.pool.query('INSERT INTO recovery_probe VALUES(1, $1)', ['committed']);
  const idlePid = (await database.pool.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
  await terminate(idlePid);
  await sleep(100);
  assert.equal((await database.pool.query('SELECT payload FROM recovery_probe WHERE nonce=1')).rows[0].payload, 'committed');
  pass('Idle connection termination recovers on next query and retains committed data');

  const active = await database.pool.connect(); leased.add(active);
  const activePid = (await active.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
  const failure = assert.rejects(active.query('SELECT pg_sleep(30)'));
  let observed = false;
  for (let attempt = 0; attempt < 30; attempt++) {
    const rows = (await admin.pool.query('SELECT state,query FROM pg_stat_activity WHERE pid=$1 AND datname=$2', [activePid, databaseName])).rows;
    if (rows[0]?.state === 'active' && rows[0]?.query === 'SELECT pg_sleep(30)') { observed = true; break; }
    await sleep(25);
  }
  assert(observed, 'Observe running query before terminating its backend');
  await terminate(activePid);
  await failure;
  active.release(new Error('Known terminated query backend')); leased.delete(active);
  assert.equal((await database.pool.query('SELECT count(*)::int AS count FROM recovery_probe')).rows[0].count, 1);
  pass('Transport loss during an active query rejects promptly and later work uses a replacement session');
  fs.writeFileSync(path.join(root, 'test-results/database-reconnect.json'), JSON.stringify({ checkedAt: new Date().toISOString(), serverVersion: version, databaseName, passed,
    scope: 'Real isolated PostgreSQL 17 network interruption through a test TCP proxy and reconnection. Not a server failover, scheduler or cloud acceptance test.' }, null, 2));
} finally { for(const client of leased)client.release(new Error('Test cleanup')); for(const socket of connections)socket.destroy(); await database?.close(); await admin.close(); await new Promise(resolve=>proxy.close(resolve)); }


