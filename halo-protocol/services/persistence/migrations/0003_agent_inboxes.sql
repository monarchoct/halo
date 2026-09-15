-- Private operator identity state. Never expose this table through the public outbox/API.
CREATE TABLE halo_mail_providers (
  id uuid PRIMARY KEY,
  configuration_hash text NOT NULL CHECK (configuration_hash ~ '^[a-f0-9]{64}$'),
  lease_token uuid,
  lease_until timestamptz,
  CHECK ((lease_token IS NULL) = (lease_until IS NULL))
);
CREATE TABLE halo_agent_inboxes (
  deployment_id text NOT NULL REFERENCES halo_deployments(id),
  agent text NOT NULL CHECK (agent ~ '^0x[a-f0-9]{40}$'),
  provider_id uuid NOT NULL REFERENCES halo_mail_providers(id),
  client_id text NOT NULL CHECK (client_id ~ '^halo-inbox-v1-[a-f0-9]{64}$'),
  request jsonb NOT NULL,
  request_hash text NOT NULL CHECK (request_hash ~ '^[a-f0-9]{64}$'),
  state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','ready')),
  inbox_id text,
  email text,
  verified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (deployment_id,agent),
  UNIQUE (provider_id,client_id),
  UNIQUE (provider_id,inbox_id),
  UNIQUE (provider_id,email),
  CHECK ((state='pending' AND inbox_id IS NULL AND email IS NULL AND verified_at IS NULL)
    OR (state='ready' AND inbox_id IS NOT NULL AND email IS NOT NULL AND verified_at IS NOT NULL))
);
CREATE INDEX halo_agent_inboxes_provider ON halo_agent_inboxes(provider_id,state);
