import fs from 'node:fs';
import {randomBytes} from 'node:crypto';
import {openDatabase} from '../../services/persistence/database.mjs';
const destination='/home/halo/lab/social-runtime/history-database.json';
if(fs.existsSync(destination))throw new Error('History database already configured; reuse its credentials');
const url=new URL(process.env.HALO_TEST_DATABASE_URL);
if(url.hostname!=='127.0.0.1')throw new Error('Local lab setup only');
url.pathname='/postgres';const admin=openDatabase({url:url.href,local:true});
const suffix=randomBytes(6).toString('hex'),name=`halo_history_${suffix}`,role=`halo_history_writer_${suffix}`,password=randomBytes(32).toString('hex');
try{
  // All interpolated identifiers/passwords are generated hex, never user input.
  await admin.pool.query(`CREATE ROLE "${role}" LOGIN PASSWORD '${password}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`);
  await admin.pool.query(`CREATE DATABASE "${name}"`);
}finally{await admin.close();}
url.pathname=`/${name}`;const owner=openDatabase({url:url.href,local:true});
try{
  await owner.pool.query(fs.readFileSync(new URL('../../services/history/schema.sql',import.meta.url),'utf8'));
  await owner.pool.query(`GRANT SELECT,INSERT,UPDATE,DELETE ON halo_history_streams,halo_history_checkpoints,halo_history_logs TO "${role}"`);
  await owner.pool.query(`REVOKE CREATE ON SCHEMA public FROM PUBLIC`);
}finally{await owner.close();}
url.username=role;url.password=password;
fs.writeFileSync(destination,JSON.stringify({url:url.href,database:name,role}),{mode:0o600,flag:'wx'});
console.log(JSON.stringify({configured:true,database:name,role,credentialFile:destination}));
