import assert from 'node:assert/strict';
import fs from 'node:fs';
import { aggregate, pickBucket, coarsen } from '../sdk/market-candles.mjs';

// Bucket selection.
assert.equal(pickBucket(0), 60e3);
assert.equal(pickBucket(-5), 60e3);
assert.equal(pickBucket(300 * 60e3), 60e3, 'exactly 300 one-minute buckets stays at the finest resolution');
assert.equal(pickBucket(301 * 60e3), 300e3);
assert.equal(pickBucket(300 * 86400e3), 86400e3);
assert.equal(pickBucket(100 * 365 * 86400e3), 86400e3, 'very wide ranges fall back to the coarsest bucket');
assert.equal(pickBucket(3600e3 * 250, 200), 14400e3);

// Empty input.
assert.deepEqual(aggregate([], 60e3), []);
assert.throws(() => aggregate([{ time: 0, price: 1, volume: 1 }], 0), /Invalid candle bucket/);

// Single bucket, out-of-order input, deterministic OHLCV.
{
  const points = [
    { time: 5_000, price: 10, volume: 2 },
    { time: 1_000, price: 9, volume: 1 },
    { time: 30_000, price: 12, volume: 3 },
    { time: 15_000, price: 8, volume: 4 },
  ];
  const [candle] = aggregate(points, 60e3);
  assert.deepEqual(candle, { time: 0, open: 9, high: 12, low: 8, close: 12, volume: 10, trades: 4 });
}

// Multiple buckets, no fill: gaps are simply absent.
{
  const points = [
    { time: 0, price: 1, volume: 1 },
    { time: 30_000, price: 2, volume: 1 },
    { time: 130_000, price: 3, volume: 1 }, // bucket 2 (120_000), bucket 1 (60_000) has no trades
  ];
  const candles = aggregate(points, 60e3);
  assert.deepEqual(candles.map(c => c.time), [0, 120_000]);
  assert.equal(candles[0].close, 2);
  assert.equal(candles[1].open, 3);
}

// fill:true carries the previous close forward through empty buckets, gap-free.
{
  const points = [
    { time: 0, price: 5, volume: 1 },
    { time: 30_000, price: 7, volume: 1 },
    { time: 130_000, price: 9, volume: 1 },
  ];
  const candles = aggregate(points, 60e3, { fill: true });
  assert.deepEqual(candles.map(c => c.time), [0, 60_000, 120_000]);
  assert.deepEqual(candles[1], { time: 60_000, open: 7, high: 7, low: 7, close: 7, volume: 0, trades: 0 });
  assert.equal(candles[2].open, 9);
}

// Determinism: shuffled input produces byte-identical output to sorted input.
{
  const points = Array.from({ length: 500 }, (_, i) => ({ time: i * 137, price: 100 + Math.sin(i) * 10, volume: i % 7 }));
  const shuffled = [...points].sort(() => Math.random() - 0.5);
  assert.deepEqual(aggregate(shuffled, 15_000), aggregate(points, 15_000));
  assert.deepEqual(aggregate(shuffled, 15_000, { fill: true }), aggregate(points, 15_000, { fill: true }));
}

// coarsen() regroups finer candles into a coarser bucket without revisiting raw points.
{
  const points = Array.from({ length: 400 }, (_, i) => ({ time: i * 60_000, price: 10 + (i % 13), volume: 1 }));
  const fine = aggregate(points, 300e3); // 5m
  const direct = aggregate(points, 3600e3); // 1h computed directly from raw points
  const viaCoarsen = coarsen(fine, 3600e3);
  assert.deepEqual(viaCoarsen, direct, 'coarsening 5m candles to 1h matches aggregating raw points at 1h');
}

// Large synthetic dataset: 20,000 points across a multi-day span, several bucket sizes.
{
  const start = 1_700_000_000_000;
  const points = [];
  let price = 50;
  for (let i = 0; i < 20_000; i++) {
    price = Math.max(0.01, price + (Math.sin(i / 37) + (i % 5 === 0 ? 0.3 : -0.05)));
    points.push({ time: start + i * 4_000, price, volume: 1 + (i % 11) });
  }
  const rangeMs = points.at(-1).time - points[0].time;
  const bucketMs = pickBucket(rangeMs);
  assert(BigInt(bucketMs) >= 60_000n);
  const candles = aggregate(points, bucketMs);
  const totalVolume = points.reduce((sum, p) => sum + p.volume, 0);
  const candleVolume = candles.reduce((sum, c) => sum + c.volume, 0);
  assert.equal(candleVolume, totalVolume, 'no volume lost or double-counted across buckets');
  assert.equal(candles.reduce((sum, c) => sum + c.trades, 0), points.length);
  for (let i = 1; i < candles.length; i++) assert(candles[i].time > candles[i - 1].time, 'strictly increasing bucket times');
  for (const candle of candles) {
    assert(candle.high >= candle.open && candle.high >= candle.close && candle.high >= candle.low);
    assert(candle.low <= candle.open && candle.low <= candle.close);
  }
  const filled = aggregate(points, bucketMs, { fill: true });
  assert.equal(filled.length, Math.round((filled.at(-1).time - filled[0].time) / bucketMs) + 1, 'fill leaves no gaps');
  assert.equal(filled.reduce((sum, c) => sum + c.volume, 0), totalVolume, 'fill never invents or drops volume');

  const result = { checkedAt: new Date().toISOString(), points: points.length, bucketMs, candles: candles.length, filledCandles: filled.length };
  fs.mkdirSync(new URL('../test-results/', import.meta.url), { recursive: true });
  fs.writeFileSync(new URL('../test-results/market-candles.json', import.meta.url), JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result));
}
