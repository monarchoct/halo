-- Keep prepared publication bytes stable across worker versions and restarts.
-- Results describe an attempt; only a verified posted outcome acknowledges social delivery.
ALTER TABLE halo_outbox ADD COLUMN prepared_payload jsonb;
ALTER TABLE halo_outbox ADD COLUMN prepared_hash text;
ALTER TABLE halo_outbox ADD COLUMN last_result jsonb;
ALTER TABLE halo_outbox ADD COLUMN last_result_hash text;
ALTER TABLE halo_outbox ADD CONSTRAINT halo_outbox_prepared_pair CHECK (
  (prepared_payload IS NULL AND prepared_hash IS NULL) OR
  (prepared_payload IS NOT NULL AND prepared_hash IS NOT NULL AND jsonb_typeof(prepared_payload)='object' AND prepared_hash ~ '^[0-9a-f]{64}$')
);
ALTER TABLE halo_outbox ADD CONSTRAINT halo_outbox_result_pair CHECK (
  (last_result IS NULL AND last_result_hash IS NULL) OR
  (last_result IS NOT NULL AND last_result_hash IS NOT NULL AND jsonb_typeof(last_result)='object' AND last_result_hash ~ '^[0-9a-f]{64}$')
);
