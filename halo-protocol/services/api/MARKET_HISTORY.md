# Market history

`GET /v1/tokens/:address/history` returns parent-quote marginal prices after launch,
curve trades, graduation and swaps in the canonical graduated Uniswap v4 pool.
It does not estimate dollar prices, circulating supply or trades in other pools.
Numbers in this display API are floating-point approximations; use integer SDK
quotes for transaction construction. Never use this chart endpoint to authorize trades.

Each point contains time (Unix milliseconds), price, quote volume, kind, venue,
transaction hash, block number and log index. Curve volume excludes fees. Pool
volume is the absolute quote-side swap delta, which includes input fees on buys.
FDV in the UI multiplies price by fixed total supply. The snapshot includes chain
and registry identity, observed block and block time. Recent blocks are provisional.

The reader replays events in canonical order and reconciles total sold with the
curve state at the same block. It verifies log block hashes and rechecks the
snapshot block hash before returning. Requests share pending builds, at most four
builds run together, and at most 100 snapshots are retained for 15 seconds. These
are performance controls, not a replacement for production gateway rate limiting.

This initial RPC reader refuses histories exceeding 200,000 deployment-relative
blocks or 5,000 combined events. It never silently truncates. A durable incremental
indexer with reorganization rollback, pagination, historical buckets and recovery
is still needed before production scale. A changed public RPC may serve different
provisional history; the cache is short-lived and is not a finality claim.

Normal API starts include this route. To serve existing local chains without
resetting or restarting their API/chain processes, run `node scripts/dev-history.mjs`.
It starts read-only local APIs on 8797 (default), 8798 (settlement), 8799 (trading).
The website's optional `historyApiUrl` selects these; otherwise it uses `apiUrl`.
The sidecars do not sign transactions or expose artifact uploads.

`node test/market-history.mjs` checks actual disposable local curve/pool history,
receipt volumes, same-pair graduation continuity, decimals, quote inversion,
concurrent snapshots, explicit limits, unknown markets and reorganization errors.

## Persistent journal

The API now optionally accepts a PostgreSQL log journal. Apply
`services/history/schema.sql` to a separate PostgreSQL 17 database as its schema
owner and grant the runtime role only SELECT/INSERT/UPDATE/DELETE on those three
tables. Do not give the public API an operator database/admin credential.

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
5,000-event chart cap still applies: server-side buckets, paging and efficient
historical block-time storage remain production work. The journal is already
connected to the local preview, but public TLS/provider failover and database
backup restoration are not yet acceptance-tested.

Checkpoint growth is bounded by block windows rather than browser refreshes. Each
commit retains the newest checkpoint in its current indexing window and preserves
older windows for fork recovery. Raw trade logs are not pruned. Canonical-anchor
lookup uses descending keyset pages of 32 rows, avoiding loading every historical
checkpoint into memory on each refresh. A PostgreSQL regression exercised 100
advancing snapshots, retained five checkpoints at a 20-block test window, then
verified fork recovery and an older snapshot. Production uses 2,000-block windows.
