import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from './schema.mjs';
const migrations = ['0001_jobs_outbox.sql', '0002_social_delivery.sql', '0003_agent_inboxes.sql'].map((name, index) => {
  const bytes = fs.readFileSync(new URL(`./migrations/${name}`, import.meta.url));
  return { version: index + 1, bytes, sha256: createHash('sha256').update(bytes).digest('hex') };
});

export function openDatabase({ url, local = false, ca, maxConnections = 8 }) {
  const parsed = new URL(url);
  if (!['postgres:', 'postgresql:'].includes(parsed.protocol) || parsed.search || parsed.hash) throw new Error('Use a PostgreSQL connection URL without query overrides');
  if (local && parsed.hostname !== '127.0.0.1') throw new Error('Unencrypted development PostgreSQL must be bound to IPv4 loopback');
  if (!Number.isInteger(maxConnections) || maxConnections < 1 || maxConnections > 32) throw new Error('Invalid database connection budget');
  const pool = new Pool({ connectionString: url, max: maxConnections, connectionTimeoutMillis: 5000, idleTimeoutMillis: 30000,
    statement_timeout: 10000, idle_in_transaction_session_timeout: 15000,
    application_name: 'halo-operator', ssl: local ? false : { rejectUnauthorized: true, ...(ca ? { ca } : {}) } });
  // Idle connection errors are handled by future operations; never log a credential-bearing URL.
  pool.on('error', () => {});
  // pg-pool removes its idle-client listener while a connection is leased.
  // A transport loss between queries must reject later work, not terminate Node.
  pool.on('connect', client => client.on('error', () => {}));
  return { pool, db: drizzle(pool, { schema }), close: () => pool.end() };
}

export async function migrate(database) {
  const client = await database.pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(728164920)');
    const version = Number((await client.query('SHOW server_version_num')).rows[0].server_version_num);
    if (version < 170000 || version >= 180000) throw new Error('This release requires PostgreSQL 17');
    await client.query('CREATE TABLE IF NOT EXISTS halo_migrations(version integer PRIMARY KEY, sha256 text NOT NULL, applied_at timestamptz NOT NULL DEFAULT clock_timestamp())');
    const applied = (await client.query('SELECT version,sha256 FROM halo_migrations ORDER BY version')).rows;
    if (applied.some(row => !migrations.some(m => m.version === row.version && m.sha256 === row.sha256))) throw new Error('Applied database migration differs from this source release');
    for (const migration of migrations) {
      if (!applied.some(row => row.version === migration.version)) {
        await client.query(migration.bytes.toString('utf8'));
        await client.query('INSERT INTO halo_migrations(version,sha256) VALUES ($1,$2)', [migration.version, migration.sha256]);
      }
    }
    await client.query('COMMIT'); return { version: migrations.length, serverVersion: version, sha256: migrations.at(-1).sha256 };
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}

export async function verifySchema(database) {
  const version = Number((await database.pool.query('SHOW server_version_num')).rows[0].server_version_num);
  const applied = (await database.pool.query('SELECT version,sha256 FROM halo_migrations ORDER BY version')).rows;
  if (version < 170000 || version >= 180000 || applied.length !== migrations.length
    || migrations.some(m => !applied.some(row => row.version === m.version && row.sha256 === m.sha256)))
    throw new Error('Apply this release migration to a PostgreSQL 17 database before starting the operator');
  return { serverVersion: version, schemaVersion: migrations.length };
}
