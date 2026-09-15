import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { openDatabase } from '../services/persistence/database.mjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const directory = '/home/halo/lab/social-runtime';
const { url } = JSON.parse(fs.readFileSync(path.join(directory, 'acceptance-database.json')));
assert.match(new URL(url).pathname, /^\/halo_browser_queue_[a-f0-9]{12}$/);
const database = openDatabase({ url, local: true });
try {
  await database.pool.query("UPDATE halo_outbox SET available_at=clock_timestamp()-interval '1 second' WHERE topic='social-post' AND payload->>'platform'='x'");
  const log = path.join(directory, 'cli-acceptance.log'), fd = fs.openSync(log, 'w', 0o600);
  const child = spawn(process.execPath, [path.join(root, 'runtime/social-cli.mjs'), path.join(directory, 'local-social.json'), '--once', '--local-test'], {
    env: { ...process.env, HALO_SOCIAL_DATABASE_URL: url, HALO_BROWSER_SECRET_CANARY: 'must-not-enter-browser' }, stdio: ['ignore', fd, fd],
  });
  const exit = await new Promise((resolve, reject) => { child.once('error', reject); child.once('close', resolve); }); fs.closeSync(fd);
  assert.equal(exit, 0);
  const events = fs.readFileSync(log,'utf8').trim().split('\n').map(line => JSON.parse(line));
  const delivered = events.find(e => e.service === 'halo-social-outbox');
  assert.equal(delivered.status,'deferred'); assert.equal(delivered.result.status,'site-unavailable');
  const row = (await database.pool.query('SELECT state,last_result,prepared_payload FROM halo_outbox WHERE id=$1',[delivered.id])).rows[0];
  assert.equal(row.state,'queued'); assert.equal(row.last_result.status,'site-unavailable'); assert.equal(row.prepared_payload.platform,'x');
  assert.equal(row.last_result.reportsDelivered,true);
  fs.writeFileSync(path.join(root,'test-results/social-cli-local.json'),JSON.stringify({ checkedAt:new Date().toISOString(),
    scope:'Actual standalone social CLI, PostgreSQL and Linux browser against X; no account creation or posting',
    databaseName:new URL(url).pathname.slice(1), exitCode:exit, outcome:delivered, databaseState:row.state,
    passed:['Standalone social worker claims a real X intent and records the actual unavailable-platform outcome','Failed X access stays queued while signed browser error reports are delivered'],
  },null,2));
  console.log('PASS standalone social CLI and actual X unavailable-platform delivery; no posts');
} finally { await database.close(); }
