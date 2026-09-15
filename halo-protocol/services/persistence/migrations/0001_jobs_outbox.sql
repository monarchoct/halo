CREATE TABLE halo_deployments (
  id text PRIMARY KEY,
  chain_id integer NOT NULL CHECK (chain_id IN (31337, 4663, 46630)),
  registry text NOT NULL CHECK (registry ~ '^0x[0-9a-f]{40}$'),
  identity_hash text NOT NULL CHECK (identity_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (chain_id, registry)
);

CREATE TABLE halo_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deployment_id text NOT NULL REFERENCES halo_deployments(id),
  agent text NOT NULL CHECK (agent ~ '^0x[0-9a-f]{40}$'),
  nonce numeric(78,0) NOT NULL CHECK (nonce >= 0),
  payload jsonb NOT NULL,
  payload_hash text NOT NULL CHECK (payload_hash ~ '^[0-9a-f]{64}$'),
  state text NOT NULL DEFAULT 'queued' CHECK (state IN ('queued', 'leased', 'completed', 'cancelled')),
  available_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  lease_token uuid,
  lease_owner text,
  lease_until timestamptz,
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  result jsonb,
  result_hash text,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (deployment_id, agent, nonce),
  CHECK ((state = 'leased' AND lease_token IS NOT NULL AND lease_owner IS NOT NULL AND lease_until IS NOT NULL)
    OR (state <> 'leased' AND lease_token IS NULL AND lease_owner IS NULL AND lease_until IS NULL)),
  CHECK (state <> 'completed' OR (result IS NOT NULL AND result_hash IS NOT NULL))
);
CREATE INDEX halo_jobs_due ON halo_jobs(deployment_id, available_at, created_at, id) WHERE state = 'queued';
CREATE INDEX halo_jobs_expired ON halo_jobs(deployment_id, lease_until, id) WHERE state = 'leased';

CREATE TABLE halo_job_attempts (
  token uuid PRIMARY KEY,
  job_id uuid NOT NULL REFERENCES halo_jobs(id),
  worker text NOT NULL,
  started_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  finished_at timestamptz,
  outcome text,
  transaction_hash text CHECK (transaction_hash IS NULL OR transaction_hash ~ '^0x[0-9a-f]{64}$')
);
CREATE INDEX halo_attempts_job ON halo_job_attempts(job_id, started_at);

CREATE TABLE halo_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deployment_id text NOT NULL REFERENCES halo_deployments(id),
  topic text NOT NULL CHECK (topic IN ('public-step', 'social-post', 'operator-receipt')),
  dedupe_key text NOT NULL CHECK (length(dedupe_key) BETWEEN 1 AND 256),
  stream_key text NOT NULL CHECK (length(stream_key) BETWEEN 1 AND 256),
  ordinal integer NOT NULL CHECK (ordinal >= 0),
  payload jsonb NOT NULL,
  payload_hash text NOT NULL CHECK (payload_hash ~ '^[0-9a-f]{64}$'),
  state text NOT NULL DEFAULT 'queued' CHECK (state IN ('queued', 'leased', 'delivered', 'cancelled')),
  available_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  lease_token uuid,
  lease_owner text,
  lease_until timestamptz,
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  last_error text,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  delivered_at timestamptz,
  UNIQUE (deployment_id, topic, dedupe_key),
  UNIQUE (deployment_id, topic, stream_key, ordinal),
  CHECK ((state = 'leased' AND lease_token IS NOT NULL AND lease_owner IS NOT NULL AND lease_until IS NOT NULL)
    OR (state <> 'leased' AND lease_token IS NULL AND lease_owner IS NULL AND lease_until IS NULL))
);
CREATE INDEX halo_outbox_due ON halo_outbox(deployment_id, topic, available_at, id) WHERE state = 'queued';
CREATE INDEX halo_outbox_expired ON halo_outbox(deployment_id, topic, lease_until, id) WHERE state = 'leased';
CREATE INDEX halo_outbox_stream_pending ON halo_outbox(deployment_id, topic, stream_key, ordinal) WHERE state NOT IN ('delivered', 'cancelled');
