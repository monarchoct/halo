-- Install as the database owner. The HTTP service receives SELECT on these views only.
-- A projection release is installed separately from operator-owned schema migrations.
CREATE OR REPLACE VIEW public.halo_public_deployments WITH (security_barrier=true) AS
  SELECT id, chain_id, registry, identity_hash FROM public.halo_deployments;

CREATE OR REPLACE VIEW public.halo_public_jobs WITH (security_barrier=true) AS
  SELECT deployment_id, agent, id, nonce, state, attempts, available_at, lease_until, updated_at,
    result->>'transactionHash' AS transaction_hash, result->>'kind' AS action_kind,
    CASE WHEN last_error IN ('not-due','insufficient-operating-reserve','execution-or-reconciliation-unavailable') THEN last_error END AS outcome
  FROM public.halo_jobs;

CREATE OR REPLACE VIEW public.halo_public_social WITH (security_barrier=true) AS
  SELECT deployment_id, id, payload->>'agent' AS agent, payload->>'nonce' AS nonce,
    payload->>'platform' AS platform, payload->>'transactionHash' AS transaction_hash,
    state, attempts, available_at, lease_until, created_at, delivered_at,
    CASE WHEN prepared_payload->>'agent'=payload->>'agent'
      AND prepared_payload->>'nonce'=payload->>'nonce' AND prepared_payload->>'platform'=payload->>'platform'
      AND prepared_payload->>'receipt'=payload->>'transactionHash'
      AND length(prepared_payload->>'text')<=2000 THEN prepared_payload->>'text' END AS thesis,
    CASE WHEN last_result->>'status' IN ('browser-started','api-started','needs-connection','needs-account','account-mismatch',
      'composer-unconfigured','site-unavailable','site-not-ready','credentials-expired','rate-limited','drafted','uncertain','failed','posted') THEN last_result->>'status' END AS outcome,
    CASE WHEN state='delivered' AND last_result->>'status'='posted' THEN last_result->>'postUrl' END AS post_url,
    CASE WHEN state='delivered' AND last_result->>'status'='posted' THEN last_result->>'profileUrl' END AS profile_url
  FROM public.halo_outbox WHERE topic='social-post';

CREATE OR REPLACE VIEW public.halo_public_mail WITH (security_barrier=true) AS
  SELECT deployment_id, agent, state, verified_at, created_at FROM public.halo_agent_inboxes;

-- Never selects connect_message, connect_signature, connected_by or secret_ref: only the
-- non-secret connection state a website may show. Writes to halo_social_bindings always go
-- through the creator-signature-verified connect/disconnect API, never through this view.
CREATE OR REPLACE VIEW public.halo_public_social_bindings WITH (security_barrier=true) AS
  SELECT deployment_id, agent, platform, profile_url, method, state, created_at FROM public.halo_social_bindings;

-- These views are not update surfaces even if a broad default grant exists.
REVOKE ALL ON public.halo_public_deployments,public.halo_public_jobs,public.halo_public_social,public.halo_public_mail,public.halo_public_social_bindings FROM PUBLIC;
CREATE INDEX IF NOT EXISTS halo_social_public_history ON public.halo_outbox(deployment_id,(payload->>'agent'),created_at DESC,id DESC)
  WHERE topic='social-post';
