# Market history

`GET /v1/tokens/:address/history` returns parent-quote marginal prices after launch,
curve trades, graduation and swaps in the canonical graduated Uniswap v4 pool.
It does not estimate dollar prices, circulating supply or trades in other pools.
Numbers in this display API are floating-point approximations; use integer SDK
quotes for transaction construction. Never use this chart endpoint to authorize trades.

This endpoint never fails because a market has traded a lot. A hyperactive memecoin
producing thousands of trades a day is the expected case, not an error path — see
"Bounded history" below for how that is kept true without unbounded memory or an
unbounded response body.

## Response shape

```json
{
  "token": "0x...", "quote": "0x...", "quoteSymbol": "tHALO", "chainId": 31337,
  "registry": "0x...", "observedBlock": "842", "observedAt": 1789440600000, "complete": true,
  "points": [ { "time": 1789440526000, "price": 0.0000101, "volume": 0.05, "kind": "buy",
    "venue": "pool", "transactionHash": "0x...", "blockNumber": "842", "logIndex": 0 } ],
  "candles": [ { "time": 1789437600000, "open": 6.25e-7, "high": 0.0000101, "low": 6.25e-7,
    "close": 0.0000101, "volume": 2298.6, "trades": 753 } ],
  "bucketMs": 3600000,
  "truncated": true,
  "disclosure": "Marginal price after each event. ..."
}
```

Every field present before this change is unchanged (`points[]` keeps its exact
per-event shape: time, price, quote volume, kind, venue, transaction hash, block
number, log index — see below). Three fields are new:

- **`points`** is now always capped at the **newest 500** raw events, oldest first.
  This is the only behavior change to `points` itself: previously the endpoint
  returned every event (and hard-failed past 5,000); it now always returns at
  most 500, silently for a chart that only needs recent-trade detail, and
  `truncated` tells the caller whether anything was left out.
- **`candles`** is an OHLCV series (`time` = bucket start ms, `open`, `high`, `low`,
  `close`, `volume`, `trades`) covering the **full observed history**, not just the
  raw window — this is how a long-lived, high-volume market still gets a complete
  chart. Bucket-gap behavior: candles are only emitted for buckets that actually
  had a trade (no synthetic flat candles) unless the caller's `bucket`/`from`/`to`
  selection causes the server to re-aggregate from raw points, in which case gaps
  are filled with a flat, zero-volume candle carrying the previous close forward
  (see `sdk/market-candles.mjs` `aggregate(..., {fill:true})`).
- **`bucketMs`** is the candle width actually used, in milliseconds. Always present,
  always reflects what `candles` actually contains — never assume the requested
  `bucket` was honored exactly (see Candle resolution below).
- **`truncated`** is `true` when `points` is not the complete raw history (i.e. more
  than 500 events exist). Use `candles` for anything beyond the recent window;
  use `GET .../trades` (below) to page deeper into the raw event window itself.

Curve volume excludes fees. Pool volume is the absolute quote-side swap delta,
which includes input fees on buys. FDV in the UI multiplies price by fixed total
supply. The snapshot includes chain and registry identity, observed block and
block time. Recent blocks are provisional.

## Query parameters

`GET /v1/tokens/:address/history?bucket=1h&from=<ms>&to=<ms>`

- `bucket`: one of `1m|5m|15m|1h|4h|1d|auto` (default `auto`). `auto` picks a width
  from the observed (or `from`/`to`-constrained) time range, targeting roughly 300
  candles — see `pickBucket()` in `sdk/market-candles.mjs`.
- `from`, `to`: Unix milliseconds, both optional, both filter `candles` (and, when
  given, `points`) to that range.

### Candle resolution

The reader (`sdk/market-history.mjs`) folds the *entire* observed history into
candles once, at one auto-picked bucket width covering it (see "Bounded history").
The route then resolves the caller's request against that stored series:

- **Requested bucket ≥ the stored bucket**: the stored candles are *coarsened*
  (merged by bucket-floor; exact, no precision loss — `coarsen()` in
  `sdk/market-candles.mjs`). Always possible, since `1m|5m|15m|1h|4h|1d` are each
  an exact multiple of the previous one.
- **Requested bucket < the stored bucket**: only the retained raw `points` window
  (newest 500) can be re-aggregated at that finer width. Older history was never
  kept at per-event precision, so a fine bucket over a wide, old range is honored
  only for the portion still covered by that window — `bucketMs` in the response
  always says what was actually used, so this is never silent.
- With no query at all (`bucket=auto`, no `from`/`to`): uses the reader's own
  full-history candles as-is. This is the common case and is always cheap.

## `GET /v1/tokens/:address/trades`

`GET /v1/tokens/:address/trades?limit=50&cursor=<opaque>`

```json
{ "trades": [ { "time": ..., "price": ..., "volume": ..., "kind": "sell", "venue": "pool",
    "transactionHash": "0x...", "blockNumber": "841", "logIndex": 2 } ],
  "nextCursor": "ODQxLjI" }
```

Newest-first keyset pagination over the *same* raw-point window `/history` exposes
(so it is bounded by the same newest-500 window — see Bounded history). `limit` is
1–200 (default 50). `cursor` is `base64url("<blockNumber>.<logIndex>")` naming the
last row of the previous page; the next page is everything strictly older in
`(blockNumber desc, logIndex desc)` order. A malformed or undecodable cursor is a
`400`, not a silent empty page. `nextCursor` is `null` once nothing older remains
(including whenever the 500-row window itself is exhausted).

## Bounded history: how it never throws

The reader replays events in canonical order and reconciles total sold with the
curve state at the same block. It verifies log block hashes and rechecks the
snapshot block hash before returning. Requests share pending builds, at most four
builds run together, and at most 100 snapshots are retained in-process for 15
seconds. These are performance controls, not a replacement for production gateway
rate limiting.

Instead of materializing every priced event (the old behavior: hold all of them,
then hard-fail past 5,000), the reader folds each event, in canonical order, into
two *fixed-size* structures as it goes:

1. A circular buffer holding only the newest `maxEvents` (500) raw points.
2. An O(1)-per-event OHLCV accumulator that only ever holds the current in-progress
   candle plus already-finished candles — never every individual point.

Memory is therefore **O(candles + 500)**, never O(total events): a market with a
million trades costs the same RAM as one with a thousand. The RPC-fallback reader
still refuses histories spanning more than 200,000 deployment-relative blocks
(`maxBlocks`, unchanged) when no journal is configured — that cap is about how far
back an RPC provider can be asked to scan, not event count, and remains a hard
error (`'History requires the archival indexer'`) since silently truncating a
chart's *time range* would misrepresent it. Event *count* no longer has a cap.

Normal API starts include this route. To serve existing local chains without
resetting or restarting their API/chain processes, run `node scripts/dev-history.mjs`.
It starts read-only local APIs on 8797 (default), 8798 (settlement), 8799 (trading).
The website's optional `historyApiUrl` selects these; otherwise it uses `apiUrl`.
The sidecars do not sign transactions or expose artifact uploads.

`node test/market-candles.mjs` unit-tests the pure aggregation/bucket-selection/
coarsening functions, including a 20,000-point synthetic case. `node
test/market-history.mjs` builds a real disposable local curve, trades it and its
graduated pool past 600 combined events, then checks receipt volumes, graduation
continuity, decimals, quote inversion, concurrent snapshots, the 500-point
truncation and full-history candle coverage, unknown markets, reorganization
errors, the durable candle cache's read-through behavior, and the live `/history`
and `/trades` HTTP surface (including a malformed-cursor 400).

## Persistent journal

The API optionally accepts a PostgreSQL log journal. Apply
`services/history/schema.sql` to a separate PostgreSQL 17 database as its schema
owner and grant the runtime role only SELECT/INSERT/UPDATE/DELETE on its tables.
Do not give the public API an operator database/admin credential. This schema is
deliberately *not* part of `services/persistence`'s own migration set: that set
versions the unrelated jobs-outbox/social/inbox database, while this history
journal — a public-chain projection containing no operator keys or private jobs —
has always been its own independently-owned database (see `historyDatabaseFile`
below); giving it a second, generic-per-event-log-stream schema keeps the two
concerns from being coupled by an unrelated migration numbering scheme.

Production API configuration accepts `historyDatabaseFile`, pointing to a private
JSON file containing `url` and optional `caFile`. TLS certificate validation stays
required. Mount this file as a secret. The API never creates its own database.
Local preview startup uses `HALO_HISTORY_DATABASE_URL` and the dedicated lab role.

Streams bind deployment identity, genesis, contract, event/filter and start block.
Batches of at most 2,000 blocks are committed with their ending block hashes. A
session advisory lock excludes concurrent writers to the same stream. Each read
revalidates checkpoints, deletes orphan suffixes transactionally, then fetches
only the missing suffix. A maximum of 25 new batches per request bounds backfill
work; retries resume saved progress. RPC failures do not imply a fork.

When this journal is configured, the 200,000-block fallback cap is removed. The
old 5,000-row chart cap on reading `halo_history_logs` back is also gone — the
final read is no longer bounded by a `LIMIT`-and-throw; it returns every row for
the stream, and the *same* bounded streaming fold described above (shared with
the RPC-fallback reader) turns that into `candles` + the newest 500 `points`.

### Durable candle cache

A second table, `halo_history_candles` (plus a small `halo_history_candle_state`
pointer table), caches the *already-folded* result — full-history candles and the
newest raw window — for each market, so that a request for a market with no new
trades since the last request never re-reads `halo_history_logs` or re-runs the
fold at all. `createCandleCache()` in `services/history/journal.mjs` is a plain
read-through cache, not a second source of truth: `sdk/market-history.mjs` only
ever serves a cached entry when its `(block number, block hash)` **exactly**
match the current canonical chain head. A reorganization — or simply new trades —
is therefore always a clean cache miss that falls through to a full, freshly
verified rebuild, which then overwrites the cache. This is a deliberately simpler
mirror of the raw-log journal's reorg handling above: rather than the raw-log
journal's precise per-window orphan-suffix deletion, a stale candle cache entry is
always fully rebuilt rather than patched, since the cached state here is small
(a few hundred candle rows plus 500 raw points) and safety (never serving
mismatched-head data) matters far more than avoiding one full recompute on the
rare block a market's cache goes stale. `total_events` is cached alongside the
candles so `truncated` is correct on a cache hit without re-deriving it.

Checkpoint growth (for raw logs) is bounded by block windows rather than browser
refreshes. Each commit retains the newest checkpoint in its current indexing
window and preserves older windows for fork recovery. Raw trade logs are not
pruned. Canonical-anchor lookup uses descending keyset pages of 32 rows, avoiding
loading every historical checkpoint into memory on each refresh. A PostgreSQL
regression exercised 100 advancing snapshots, retained five checkpoints at a
20-block test window, then verified fork recovery and an older snapshot.
Production uses 2,000-block windows.

`node test/history-candles-journal.mjs` exercises `createCandleCache()` directly
against a disposable PostgreSQL database (independent read-back, per-market
isolation, full-replace-on-rewrite, and the schema's `trades>0` constraint). Like
`node test/history-journal.mjs`, it prints a clear `SKIP` line and exits 0 when
`HALO_TEST_DATABASE_URL` is not set — this machine class has neither PostgreSQL
nor Docker, so both were written and reasoned through but not executed here.
