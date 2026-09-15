-- Runs once when the PostgreSQL volume is first created. Change every password before first start.
-- Roles follow services/persistence/README.md: the schema owner migrates; operators get DML; the
-- operations HTTP service reads projections only; relays only need LISTEN/NOTIFY.
CREATE ROLE halo_migrator LOGIN PASSWORD 'change-me-migrator';
CREATE ROLE halo_operator LOGIN PASSWORD 'change-me-operator';
CREATE ROLE halo_operations_reader LOGIN PASSWORD 'change-me-reader';
CREATE ROLE halo_social_writer LOGIN PASSWORD 'change-me-social';
CREATE ROLE halo_relay LOGIN PASSWORD 'change-me-relay';
GRANT CONNECT ON DATABASE halo TO halo_migrator, halo_operator, halo_operations_reader, halo_social_writer, halo_relay;
GRANT ALL ON SCHEMA public TO halo_migrator;
GRANT USAGE ON SCHEMA public TO halo_operator, halo_operations_reader, halo_social_writer, halo_relay;
-- Table grants for halo_operator, halo_operations_reader (SELECT on the halo_public_* views installed from
-- services/operations/projections.sql) and halo_social_writer (halo_social_bindings) are applied after the
-- first migration; see deploy/host/README.md §3.
