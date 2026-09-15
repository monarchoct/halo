import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { root } from '../scripts/compile.mjs';
import { openDatabase, verifySchema } from '../services/persistence/database.mjs';

const evidence = JSON.parse(fs.readFileSync(path.join(root,'test-results/persistence.json')));
assert.match(evidence.databaseName,/^halo_queue_test_[a-f0-9]{12}$/);
assert.ok(evidence.postmasterStartedAt,'Run the current persistence test before the controlled database restart');
const config = process.env.HALO_TEST_DATABASE_URL ? { url: process.env.HALO_TEST_DATABASE_URL, local: true }
  : JSON.parse(fs.readFileSync(path.resolve(root,'../../work/postgres-private/connection.json')));
const url = new URL(config.url); url.pathname = `/${evidence.databaseName}`;
const database = openDatabase({...config,url:url.toString()});
try {
  let connected = false;
  for(let attempt=0;attempt<30;attempt++) {
    try { await database.pool.query('SELECT 1'); connected=true; break; }
    catch { await new Promise(resolve=>setTimeout(resolve,1000)); }
  }
  assert.ok(connected,'The restarted PostgreSQL server did not become available');
  await verifySchema(database);
  const started=(await database.pool.query('SELECT pg_postmaster_start_time() AS started')).rows[0].started.toISOString();
  assert.ok(Date.parse(started)>Date.parse(evidence.postmasterStartedAt),'No new PostgreSQL server process was observed');
  const job=(await database.pool.query('SELECT state,result FROM halo_jobs WHERE id=$1',[evidence.persistedJobId])).rows[0];
  assert.equal(job.state,'completed');assert.equal(job.result.status,'fixture-complete');
  assert.equal((await database.pool.query("SELECT count(*)::int AS n FROM halo_outbox WHERE dedupe_key='receipt-one'")).rows[0].n,1);
  const sequence=(await database.pool.query("SELECT ordinal FROM halo_outbox WHERE stream_key='append-fixture' ORDER BY ordinal")).rows.map(row=>row.ordinal);
  assert.deepEqual(sequence,[0,1,2,3,4]);
  fs.writeFileSync(path.join(root,'test-results/persistence-restart.json'),JSON.stringify({checkedAt:new Date().toISOString(),status:'passed',
    databaseName:evidence.databaseName,previousPostmasterStartedAt:evidence.postmasterStartedAt,postmasterStartedAt:started,
    passed:['A different server process is accepting connections','Completed result survives restart','Atomic receipt outbox entry survives restart','Ordered pending publications survive restart']},null,2));
  console.log('PASS PostgreSQL process-restart persistence');
} finally { await database.close(); }
