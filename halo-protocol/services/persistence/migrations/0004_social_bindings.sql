-- Private operator table: creator-authorized social account connections. Secrets are
-- NEVER stored here; secret_ref is an opaque pointer into the operator's own secret store
-- (see runtime/identity/secret-store.mjs). This table is never exposed through the raw
-- public outbox/API -- only the non-secret projection in services/operations may read it.
CREATE TABLE halo_social_bindings (
  deployment_id text NOT NULL REFERENCES halo_deployments(id),
  agent text NOT NULL CHECK (agent ~ '^0x[0-9a-f]{40}$'),
  platform text NOT NULL CHECK (platform IN ('x','fomo')),
  profile_url text NOT NULL CHECK (length(profile_url) BETWEEN 1 AND 300),
  method text NOT NULL CHECK (method IN ('oauth','browser-session')),
  connected_by text NOT NULL CHECK (connected_by ~ '^0x[0-9a-f]{40}$'),
  connect_message text NOT NULL CHECK (length(connect_message) BETWEEN 1 AND 4000),
  connect_signature text NOT NULL CHECK (connect_signature ~ '^0x[0-9a-f]{130}$'),
  state text NOT NULL DEFAULT 'connected' CHECK (state IN ('connected','credentials-expired','disconnected')),
  secret_ref text CHECK (secret_ref IS NULL OR secret_ref ~ '^[a-f0-9]{32,64}$'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (deployment_id, agent, platform),
  UNIQUE (deployment_id, platform, profile_url)
);
CREATE INDEX halo_social_bindings_state ON halo_social_bindings(deployment_id, platform, state);
