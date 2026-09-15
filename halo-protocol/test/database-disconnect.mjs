import net from 'node:net';
import assert from 'node:assert/strict';
import {openDatabase} from '../services/persistence/database.mjs';

const sockets=new Set();
const packet=(type,body)=>{const size=Buffer.alloc(4);size.writeInt32BE(body.length+4);return Buffer.concat([Buffer.from(type),size,body]);};
// Minimal PostgreSQL startup only. The real pg driver then loses its transport
// while leased and between queries; there is intentionally no test error handler.
const server=net.createServer(socket=>{
  sockets.add(socket);socket.on('close',()=>sockets.delete(socket));socket.on('error',()=>{});
  socket.once('data',()=>socket.write(Buffer.concat([packet('R',Buffer.alloc(4)),packet('K',Buffer.alloc(8)),packet('Z',Buffer.from('I'))])));
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const db=openDatabase({url:`postgresql://transport_probe:unused@127.0.0.1:${server.address().port}/probe`,local:true});
try {
  const client=await db.pool.connect();
  if(process.argv.includes('--negative-control'))client.removeAllListeners('error');
  for(const socket of sockets)socket.destroy();
  await new Promise(resolve=>setTimeout(resolve,250));
  await assert.rejects(client.query('SELECT 1'),/not queryable|connection|closed/i);
  client.release(new Error('Discard disconnected client'));
  console.log('PASS: real pg client survives transport loss while leased; subsequent query rejects');
}finally{
  await db.close();for(const socket of sockets)socket.destroy();await new Promise(resolve=>server.close(resolve));
}
