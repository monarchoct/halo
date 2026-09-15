# PostgreSQL operator coordination

Updated 13 September 2026. PostgreSQL 17.11, Drizzle ORM 0.45.2 and node-postgres 8.23.0 are pinned for this implementation. The queue and transactional outbox are connected to `runtime/cli.mjs` in execution mode. Independent operators can use separate databases; no database controls the vault's on-chain permissions.

## Verified scope

Twelve queue/outbox scenarios passed against a real PostgreSQL 17.11 server, including 24 competing claims for 20 jobs, expired-lease fencing, delayed retry, ordered delivery, atomic rollback and recovery through a new connection pool. Four integration scenarios then recovered Cedar's existing on-chain receipts without new transactions, rejected a stale nonce in the real operator and published receipts through the outbox to three distinct local IPFS peers.

**The native Windows process-restart drill did not pass.** The sandbox denied PostgreSQL inter-process signaling (`could not signal for checkpoint: Operation not permitted`). WAL replay started, then startup failed; the server shut down. Earlier background-worker startup warnings were also observed. The original data directory and evidence are retained. Do not reset WAL, disable fsync/autovacuum or recreate that directory to turn this into a passing result. This retained native failure is separate from the successful local Linux acceptance described below; no public hosting acceptance is implied.

The Linux CI definition now starts PostgreSQL 17.11, runs the queue tests, kills and restarts that same disposable container, and checks persisted results in a new server process. The equivalent drill was executed on a separate Ubuntu 24.04 Linux VM: all twelve scenarios passed, then a SIGKILL and restart of the same container/volume preserved completed jobs and ordered pending publications. The postmaster changed from 2026-09-13T15:54:08.048Z to 2026-09-13T15:54:31.912Z. PostgreSQL fsync, full_page_writes and synchronous_commit stayed enabled. The original Windows data was not modified. Evidence is in test-results/linux-persistence/. The GitHub CI definition itself remains unexecuted. The native failed drill is recorded separately in `test-results/persistence-native-restart.json`.

## How work moves

1. The scanner reads the actual registry, immutable policy, operating state and agent nonce from RPC. It enqueues an agent/nonce identity once. A conflicting payload for that identity is rejected.
2. A worker atomically claims an eligible row using `FOR UPDATE SKIP LOCKED`. Each claim gets a fresh token and expiry based on the database clock; expired claims can be recovered.
3. Before inference, the operator checks the exact queued nonce. Before broadcasting, it checks that its lease remains valid. A heartbeat renews the lease while work is running.
4. Recovery first searches canonical, sufficiently confirmed `ActionExecuted` events for that nonce. A found receipt completes the old job without submitting a different action. Gas, beneficiary, reward and evidence URI come from the actual receipt.
5. Completion, the outgoing public receipt and (for a launch) one X and one FOMO intent enter the database in one transaction. Any conflicting outbox identity rolls back all changes. Hold cycles do not create social posts.
6. The receipt dispatcher pins and retrieves the content on the configured IPFS peers. It acknowledges the outbox only after that succeeds. Unacknowledged content-addressed publication can be retried without creating a different artifact.

Within a database, stale lease tokens cannot renew or complete reclaimed jobs. Across independent operator groups, the immutable vault nonce prevents a second successful execution of the same action nonce. A lease check and an external RPC broadcast cannot be one database transaction: duplicate operator gas remains possible near lease expiry or an uncertain broadcast. The sender still needs a journal of signed transactions before broadcast and more pending-transaction recovery tests. Do not advertise global exactly-once RPC submission.

## Install and migration

From the protocol directory:

```sh
npm ci
npm ci --prefix services/persistence
node services/persistence/migrate-cli.mjs /srv/halo/config/database.json
```

The private configuration names an environment variable, rather than embedding a connection password in a published manifest:

```json
{
  "connectionEnvironment": "HALO_DATABASE_URL",
  "caFile": "../certificates/postgres-ca.pem"
}
```

Supply the actual connection URL through the operator's secret manager. Omit `caFile` only when the server certificate validates through the normal trust roots. Remote database connections require TLS certificate verification; URL query overrides are rejected. The explicit `--local-test` migration flag permits unencrypted IPv4 loopback only. The local Windows test uses port 54329 with SCRAM authentication and private, non-exported credentials.

Run migrations with a migration role. The normal operator requires DML on HALO tables plus read access to `halo_migrations`; it should not own the schema or have database-creation privileges. For example, after creating an operator role through the deployment's credential-management process:

```sql
GRANT CONNECT ON DATABASE halo TO halo_operator;
GRANT USAGE ON SCHEMA public TO halo_operator;
GRANT SELECT ON halo_migrations TO halo_operator;
GRANT SELECT, INSERT, UPDATE ON halo_deployments, halo_jobs,
  halo_job_attempts, halo_outbox TO halo_operator;
```

Replace the example database/role names with the actual deployment names. Migrations use a transaction-level advisory lock and a stored SHA-256. Startup verifies the applied migration; modifying an already-applied migration is rejected. Use a new migration for subsequent schema changes. Connection pools are bounded to eight by default and reject a configured maximum above 32.

## Operator configuration

Add these fields to the existing `operator.json`:

```json
{
  "database": {
    "connectionEnvironment": "HALO_DATABASE_URL",
    "caFile": "../certificates/postgres-ca.pem"
  },
  "leaseSeconds": 180
}
```

Then the existing `node runtime/cli.mjs operator.json --execute` entry point uses the queue and receipt outbox. Dry-run mode still prepares/simulates without consuming execution jobs. Neither the database credentials nor the gas key enter the browser or Python model environment. Each separate operator process receives a unique worker identity; it does not receive privileged vault control.

## Verification commands

```sh
npm run test:persistence
npm run test:scheduler-recovery
# After a separately controlled restart of the same disposable PostgreSQL server:
npm run test:persistence-restart
```

The queue test creates a uniquely named disposable database and records its name. The scheduler integration needs the existing local Anvil deployment, completed agent actions and the three local IPFS peers. It performs no new transaction or external social post. The restart test requires the current queue test's recorded postmaster start time and verifies that a different server process retains the same results and publications.

Publish only the selected JSON evidence, never private connection files, database volumes or the entire `test-results` directory. The GitHub workflow uses explicit artifact allowlists.

## Social publication checkpoint

Migration `0002_social_delivery.sql` adds prepared text/hash and attempt-result/hash pairs. `migrate` applies missing migrations in order under a transaction lock and verifies the source hash of every applied migration. Never modify a migration already applied to a database; add another migration instead. The same migration command upgrades an existing version-1 database.

`runtime/social.mjs` prepares public text only after checking canonical launch receipts, content-addressed evidence and deployed token identity. `checkpointDelivery` persists it under the current lease and prevents text changes on retries. Browser startup records possible publication before executing the worker. The committed account and uncertainty survive retries, pool restarts and lease replacement. The browser receives `reconcileOnly` when a previous submission might exist, even if its private journal disappeared. Missing accounts, inaccessible platforms and uncertain outcomes defer the job instead of acknowledging it. A reported success must include the exact text, bound profile and valid platform permalink.

Actual Linux acceptance passed sixteen PostgreSQL scenarios and seven social-outbox scenarios using Nova's two existing launches and retrieved public evidence. The latter injected browser results to test failures and recovery; it created no external account or post and submitted no transactions. Fifteen separate browser-driver fixtures verify reconciliation and capture boundaries. Selected evidence is in `test-results/linux-social-outbox/`. `test/social-outbox.mjs` requires the preserved local trading deployment, loopback RPC/artifact gateway and a Linux PostgreSQL test URL; it is not a public-chain or authenticated-browser test.

The separate container runner and social CLI subsequently passed actual queued FOMO account setup, signed delivery, profile exclusion and interruption cleanup. A local consumer is running against that accepted database. Continuous native model workers now use this Linux database through the shared scheduler and agent-scoped claims. Lyra produced a fresh real-model launch, paid its operator and generated both social jobs; five pipeline checks passed against the actual browser reports. Eighteen persistence scenarios passed after preserving outbox publication metadata. Independent deployment and complete recovery/accounting remain. See test-results/linux-queued-browser/ and runtime/browser/README.md.

## Work still required

- Run the accepted Linux suite in the actual GitHub CI and target hosting environment. Local Linux concurrency/restart acceptance now passes; portable model/prover deployment, backup/restore and independent providers remain.
- Add canonical block/event projections, accounting, and invalidation/correction of completed jobs and published receipts after a chain reorganization. Current recovery checks a receipt against the canonical chain when it completes a job; it does not continuously revalidate old completed rows.
- Journal signed transactions before broadcasting and test uncertain RPC outcomes, replacement transactions and gas-nonce coordination.
- Move signed live-step delivery out of the current in-memory publisher into this outbox, including delayed-history ingestion. Connect the isolated social worker to durable social jobs and authenticated account linkage.
- Expose queue/run status through the website's read API, implement database backup/restore/retention, and run independent providers. The website currently displays on-chain actions and the existing live feeds; it does not yet show this queue.

The queue is a completed implementation slice within the larger product. It is not evidence of hosted models, autonomous account signup, self-funding, complete reorganization handling or production readiness.

## Primary references

- PostgreSQL's [row-locking and SKIP LOCKED semantics](https://www.postgresql.org/docs/17/sql-select.html) support concurrent queue consumers; skipped rows do not form a general-purpose consistent snapshot.
- Drizzle's [PostgreSQL driver documentation](https://orm.drizzle.team/docs/get-started-postgresql) describes its node-postgres integration. This release retains the project's stable Drizzle version rather than adopting the documented release candidate.
- The native test archive came from the [EDB binary distribution linked by PostgreSQL](https://www.postgresql.org/download/windows/). Its downloaded SHA-256 is `4b8db0930c38f6ef845db919551dedda3b6b845aeb0927b3d79a6e8e9e4537cf`; this is a locally computed digest, not a separately verified publisher checksum.
