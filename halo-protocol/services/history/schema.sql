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
REVOKE ALL ON halo_history_streams,halo_history_checkpoints,halo_history_logs FROM PUBLIC;
