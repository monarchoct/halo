import assert from 'node:assert/strict';
import fs from 'node:fs';
import { randomBytes } from 'node:crypto';

if (!process.env.HALO_TEST_DATABASE_URL) {
  console.log('SKIP history-candles-journal: set HALO_TEST_DATABASE_URL (PostgreSQL 17, 127.0.0.1) to run this suite. No database is configured here.');
  process.exit(0);
}
// Deferred past the skip check: services/persistence/database.mjs requires the separately installed
// `pg`/`drizzle-orm` adapter (`npm ci --prefix services/persistence`), which a PG-less environment may not have.
const { openDatabase } = await import('../services/persistence/database.mjs');
const { createCandleCache } = await import('../services/history/journal.mjs');

const base = new URL(process.env.HALO_TEST_DATABASE_URL); assert.equal(base.hostname, '127.0.0.1');
const name = `halo_candles_test_${randomBytes(6).toString('hex')}`; base.pathname = '/postgres';
const admin = openDatabase({ url: base.href, local: true });
try { await admin.pool.query(`CREATE DATABASE "${name}"`); } finally { await admin.close(); }
base.pathname = `/${name}`; const database = openDatabase({ url: base.href, local: true });
const passed = [];
try {
  await database.pool.query(fs.readFileSync(new URL('../services/history/schema.sql', import.meta.url), 'utf8'));
  const cache = createCandleCache({ database, identity: 'disposable-candle-test' });
  const tokenA = '0x' + '11'.repeat(20), tokenB = '0x' + '22'.repeat(20);
  const candle = (time, close) => ({ time, open: close, high: close, low: close, close, volume: 1, trades: 1 });

  assert.equal(await cache.read(tokenA), null);
  passed.push('An unwritten market cache misses cleanly');

  const first = { bucketMs: 60_000, throughBlock: 10n, throughHash: '0x' + 'aa'.repeat(32), totalEvents: 3,
    candles: [candle(0, 1), candle(60_000, 2)], rawWindow: [{ time: 0, price: 1, volume: 1, kind: 'buy', venue: 'curve',
      transactionHash: '0x' + 'bb'.repeat(32), blockNumber: '1', logIndex: 0 }] };
  await cache.write(tokenA, first);
  const readBack = await cache.read(tokenA);
  assert.equal(readBack.bucketMs, first.bucketMs);
  assert.equal(readBack.throughBlock, first.throughBlock);
  assert.equal(readBack.throughHash, first.throughHash);
  assert.equal(readBack.totalEvents, first.totalEvents);
  assert.deepEqual(readBack.candles, first.candles);
  assert.deepEqual(readBack.rawWindow, first.rawWindow);
  passed.push('A written market cache reads back byte-identical candles, raw window and through-pointer');

  await cache.write(tokenB, { ...first, throughBlock: 99n, candles: [candle(0, 5)] });
  assert.equal((await cache.read(tokenA)).throughBlock, 10n);
  assert.equal((await cache.read(tokenB)).throughBlock, 99n);
  passed.push('Two markets under the same identity are cached independently');

  // A later write (e.g. after a reorg forced a full rebuild, or a longer history picked a coarser bucket)
  // must fully replace the previous candle rows, never merge or accumulate duplicates.
  const rebuilt = { bucketMs: 3_600_000, throughBlock: 20n, throughHash: '0x' + 'cc'.repeat(32), totalEvents: 900,
    candles: [candle(0, 9)], rawWindow: [] };
  await cache.write(tokenA, rebuilt);
  const afterRebuild = await cache.read(tokenA);
  assert.equal(afterRebuild.candles.length, 1);
  assert.deepEqual(afterRebuild.candles, rebuilt.candles);
  assert.equal(afterRebuild.bucketMs, 3_600_000);
  const rowCount = Number((await database.pool.query(
    `SELECT count(*) FROM halo_history_candles c JOIN halo_history_streams s ON s.id=c.stream_id WHERE s.specification->>'identity'='disposable-candle-test'`)).rows[0].count);
  assert.equal(rowCount, 2, 'tokenA has exactly its one rebuilt candle row; tokenB still has its own one row; none were left behind');
  passed.push('A rewrite fully replaces the previous candle set instead of accumulating stale buckets');

  await assert.rejects(cache.write(tokenA, { ...rebuilt, candles: [{ ...candle(0, 1), trades: 0 }] }), /trades/,
    'a candle with zero trades violates the CHECK constraint');
  passed.push('An empty-trade candle is rejected by the schema, not silently written');

  const result = { checkedAt: new Date().toISOString(), database: name, passed };
  fs.writeFileSync(new URL('../test-results/history-candles-journal.json', import.meta.url), JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result));
} finally { await database.close(); }
