-- Independent public-chain projection; contains no operator keys or private jobs.
CREATE TABLE IF NOT EXISTS halo_history_streams (
  id text PRIMARY KEY CHECK (length(id)=64),
  specification jsonb NOT NULL,
  start_block bigint NOT NULL CHECK(start_block>=0)
);
CREATE TABLE IF NOT EXISTS halo_history_checkpoints (
  stream_id text NOT NULL REFERENCES halo_history_streams(id) ON DELETE CASCADE,
  block_number bigint NOT NULL CHECK(block_number>=0),
  block_hash text NOT NULL CHECK(block_hash ~ '^0x[0-9a-fA-F]{64}$'),
  PRIMARY KEY(stream_id,block_number)
);
CREATE TABLE IF NOT EXISTS halo_history_logs (
  stream_id text NOT NULL REFERENCES halo_history_streams(id) ON DELETE CASCADE,
  block_number bigint NOT NULL CHECK(block_number>=0),
  log_index integer NOT NULL CHECK(log_index>=0),
  payload jsonb NOT NULL,
  PRIMARY KEY(stream_id,block_number,log_index)
);
-- Durable candle cache (see createCandleCache in journal.mjs). stream_id here identifies a whole market
-- (all of its curve/pool venues combined), a distinct halo_history_streams row from the per-event-type
-- log streams above. halo_history_candle_state is the single "as of" pointer that makes a cached entry
-- safe to serve only on an exact chain-head match; halo_history_candles holds the OHLCV rows themselves.
CREATE TABLE IF NOT EXISTS halo_history_candles (
  stream_id text NOT NULL REFERENCES halo_history_streams(id) ON DELETE CASCADE,
  bucket_ms integer NOT NULL CHECK(bucket_ms>0),
  bucket_time bigint NOT NULL CHECK(bucket_time>=0),
  open double precision NOT NULL,
  high double precision NOT NULL,
  low double precision NOT NULL,
  close double precision NOT NULL,
  volume double precision NOT NULL,
  trades integer NOT NULL CHECK(trades>0),
  PRIMARY KEY(stream_id,bucket_ms,bucket_time)
);
CREATE TABLE IF NOT EXISTS halo_history_candle_state (
  stream_id text PRIMARY KEY REFERENCES halo_history_streams(id) ON DELETE CASCADE,
  bucket_ms integer NOT NULL CHECK(bucket_ms>0),
  through_block bigint NOT NULL CHECK(through_block>=0),
  through_hash text NOT NULL CHECK(through_hash ~ '^0x[0-9a-fA-F]{64}$'),
  total_events integer NOT NULL CHECK(total_events>=0),
  raw_window jsonb NOT NULL
);
REVOKE ALL ON halo_history_streams,halo_history_checkpoints,halo_history_logs,halo_history_candles,halo_history_candle_state FROM PUBLIC;
