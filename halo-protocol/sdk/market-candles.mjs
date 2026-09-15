export const BUCKETS = [60e3, 300e3, 900e3, 3600e3, 14400e3, 86400e3];

/** Chooses the coarsest bucket that still keeps the candle count at or under targetCandles,
 * falling back to the coarsest available bucket for very wide ranges. */
export function pickBucket(rangeMs, targetCandles = 300) {
  if (!Number.isFinite(rangeMs) || rangeMs <= 0) return BUCKETS[0];
  for (const bucket of BUCKETS) if (rangeMs / bucket <= targetCandles) return bucket;
  return BUCKETS.at(-1);
}

/** Deterministic OHLCV aggregation. Input points need not be sorted; output candles are ordered by time.
 * fill:true inserts carry-forward (flat, zero-volume) candles for buckets with no trades, so charts never gap. */
export function aggregate(points, bucketMs, { fill = false } = {}) {
  if (!Number.isInteger(bucketMs) || bucketMs <= 0) throw new Error('Invalid candle bucket');
  if (!points.length) return [];
  const sorted = [...points].sort((a, b) => a.time - b.time);
  const byBucket = new Map();
  for (const point of sorted) {
    const time = Math.floor(point.time / bucketMs) * bucketMs;
    let candle = byBucket.get(time);
    if (!candle) { candle = { time, open: point.price, high: point.price, low: point.price, close: point.price, volume: 0, trades: 0 }; byBucket.set(time, candle); }
    candle.high = Math.max(candle.high, point.price);
    candle.low = Math.min(candle.low, point.price);
    candle.close = point.price;
    candle.volume += point.volume;
    candle.trades += 1;
  }
  const candles = [...byBucket.values()].sort((a, b) => a.time - b.time);
  if (!fill) return candles;
  const filled = [];
  let previousClose = candles[0].close;
  for (let time = candles[0].time; time <= candles.at(-1).time; time += bucketMs) {
    const candle = byBucket.get(time);
    if (candle) { filled.push(candle); previousClose = candle.close; }
    else filled.push({ time, open: previousClose, high: previousClose, low: previousClose, close: previousClose, volume: 0, trades: 0 });
  }
  return filled;
}

/** Regroups already-aggregated, ascending candles into a coarser bucket. Only valid when newBucketMs is an
 * exact multiple of the candles' own bucket (true for every consecutive pair in BUCKETS), since it merges by
 * bucket-floor without revisiting raw points. Coarsening loses no information; it cannot recover finer detail. */
export function coarsen(candles, newBucketMs) {
  const out = [];
  for (const candle of candles) {
    const time = Math.floor(candle.time / newBucketMs) * newBucketMs;
    const bar = out.at(-1);
    if (!bar || bar.time !== time) out.push({ time, open: candle.open, high: candle.high, low: candle.low, close: candle.close, volume: candle.volume, trades: candle.trades });
    else { bar.high = Math.max(bar.high, candle.high); bar.low = Math.min(bar.low, candle.low); bar.close = candle.close; bar.volume += candle.volume; bar.trades += candle.trades; }
  }
  return out;
}
