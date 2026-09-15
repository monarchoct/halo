# HALO on Akash — workspace shards and shared inference

Updated 15 September 2026. This directory now holds a generator for the SDL Akash needs
(`sdl.mjs`), an encrypted profile backup/restore path for agent browser workspaces
(`../../runtime/browser/profile-snapshot.mjs`, `../../runtime/browser/workspace-entrypoint.mjs`)
and a VERIFY-gated Console API adapter (`console-client.mjs`). None of this has been deployed
against a real Akash provider from this environment; it is built and unit-tested against local
fixtures only (no Docker, no Linux, no Akash account available here — see the repository root
`CLAUDE.md`/worktree setup notes). The one prior connectivity test is recorded separately in
`../../../HALO_AKASH_FIRST_TEST.md` and remains a one-hour smoke test of a bare Node container,
not evidence that any of the deployments described below have run.

## Topology: what runs on Akash, what does not

| Layer | Hosted on Akash? | Why |
|---|---|---|
| Agent workspace shards (headed/headless Chromium "virtual PC") | **Yes** — `workspaceShardSdl` | The isolated, disposable, horizontally-shardable piece; egress-only, no state Akash itself needs to keep durable (see backup/restore below). |
| Shared GPU inference | **Yes** — `inferenceSdl` | GPU availability and per-hour pricing is Akash's actual value proposition here; weights are read-mostly and the persistent volume is treated as a warm cache, not the source of truth. |
| PostgreSQL scheduler/outbox | **No** | Needs durable, provider-independent storage with real backups and point-in-time restore; Akash persistent volumes are provider-local and do not survive lease close or provider migration (see below). Run this on a managed database or an ordinary VPS with its own backup story. |
| Relays and the public read API | **No** | These are cheap, always-on, latency-sensitive to the website, and carry no GPU/browser workload; an ordinary VPS or PaaS avoids paying Akash's per-lease escrow/bidding overhead for a service that never scales like a workspace fleet does. |

Workspaces and inference reach the scheduler/relay/API purely over HTTPS (`HALO_RELAY_URL`,
plus whatever URL the social worker's `social.json` points at — see
`../../runtime/browser/README.md` and `../../runtime/social-cli.mjs`). Nothing in this directory
opens an inbound port on a workspace shard; see "No inbound expose" below.

## Sharding rationale

One Akash *deployment* is one bid/lease/escrow unit. Putting all 100 target agents in a single
deployment would mean: one lease loss takes down every agent's workspace at once, one persistent
volume limit (SDL allows at most one per compute profile) can't be reused across agents anyway
(each agent needs its own private profile volume), and the bid becomes a single enormous resource
request that fewer providers can satisfy. `workspaceShardSdl` therefore builds **one deployment
per shard of `agentsPerDeployment` agents (default 10)**, each agent getting its own service
(`agent-0`, `agent-1`, …) with its own persistent volume mounted at `/profile`. `workspaceShards`
splits an arbitrary agent list into shards and `node deploy/akash/sdl.mjs workspace` writes one
YAML file per shard. 100 agents at the default shard size produces 10 independent deployments —
losing one shard's lease loses at most 10 agents' *local* workspace state (recoverable from the
last encrypted snapshot; see below), not the whole fleet.

### No inbound expose

Workspace services carry **no `expose` block at all** — Akash's provider-generated ingress
hostname is not stable across leases (see `../../../HALO_AKASH_FIRST_TEST.md`), workspaces have no
reason to accept inbound traffic, and every real interaction (signed frames, snapshot upload) is
outbound HTTPS the workspace itself initiates. The inference service is the only exposed one
(`expose: [{port, as: 443, to: [{global: true}]}]`), and it must sit behind an authenticated
gateway with request-size/rate/concurrency limits before any real key is bound to it — the raw
`/v1` port must never be the thing Akash exposes publicly in production (see
`../inference/README.md`, which this SDL generator does not change).

## Generating an SDL

```sh
# One 10-agent shard, or several files when --agents exceeds --agents-per-deployment:
node deploy/akash/sdl.mjs workspace \
  --agents 0xabc...,0xdef...,... \
  --image ghcr.io/OWNER/halo-browser-workspace@sha256:<digest> \
  --chain-id 4663 --registry 0xREGISTRY... \
  --relay-url https://relay.halo.example/v1 \
  --egress-list-url https://cdn.halo.example/browser-egress.json \
  --snapshot-bucket halo-agent-profiles \
  --out deploy/akash/out/workspace.yaml
# 100 agents at the default shard size of 10 writes:
#   workspace.shard-0.yaml .. workspace.shard-9.yaml

node deploy/akash/sdl.mjs inference \
  --image ghcr.io/OWNER/halo-inference@sha256:<digest> \
  --models rtx4090,a5000,l4,a6000 \
  --out deploy/akash/out/inference.yaml
```

Both commands validate every generated document against the allowed Akash SDL v2.0 field set
(`services.*.{image,command,args,env,expose,params.storage}`,
`profiles.{compute,placement}`, `deployment`) before writing it — see `sdl.mjs`'s
`servicesSdl`/`validateSdlYaml` and `test/akash-sdl.mjs`. No `yaml`/`js-yaml` package is present in
this repo's `node_modules`, so `deploy/akash/yaml-lite.mjs` is a small hand-written emitter/parser
for exactly the subset of YAML these documents use (block mappings/sequences, quoted scalars) —
not a general-purpose YAML library. The Console API key that authenticates the inference
endpoint is **never** written into the generated SDL; provision it at deploy time through the
Console UI's environment override or the CLI's `--set-env`, not as a repo-committed value.

## Deploying

### Via Akash Console (recommended for the first real deployment)

1. Create or sign in to an owner-controlled Akash Console account (see
   `../../../HALO_PRODUCTION_HOSTING.md` — account setup is external to this repo).
2. Generate the SDL as above, one shard/inference file at a time.
3. In Console, "Deploy" → "Build your template" → paste (or upload) the generated YAML → review
   bids from providers → select one on measured price/uptime, not the cheapest bid alone → deploy.
4. Record the resulting deployment id and provider hostname (see `../../../HALO_AKASH_FIRST_TEST.md`
   for the shape of that record) and verify external reachability before wiring it into the
   scheduler config, exactly as that connectivity test still has pending for its own deployment.
5. Repeat per shard. Each shard is an independent lease with its own escrow; nothing here bundles
   multiple shards' billing into one deployment.

### Via `console-client.mjs` (programmatic, once verified)

```js
import { createConsoleClient } from './console-client.mjs';
const client = createConsoleClient({ baseUrl: 'https://console-api.akash.network', apiKey: process.env.AKASH_CONSOLE_API_KEY });
const deployment = await client.createDeployment({ sdl: fs.readFileSync('workspace.shard-0.yaml', 'utf8') });
const lease = await client.getLease(deployment.id);
// ... later, to release the shard's escrow:
await client.closeDeployment(deployment.id);
```

**This adapter's endpoint paths and response shapes are marked `VERIFY` in `console-client.mjs`
and have not been exercised against a real Console account from this environment** — no Akash
account or network access is available here. Treat every path/field as a best-effort guess from
public documentation until it is run once against a live account; `test/akash-console-client.mjs`
is fixture-driven (a fake transport, no network) and only proves the adapter's own contract
(origin pinning, bounded responses, id/schema validation), not that the paths are correct.

### Via the Akash CLI (`akash tx deployment create`, `provider-services`)

Follow the current `akash` CLI / `provider-services` onboarding
([Akash setup](https://akash.network/docs/getting-started/)) with a funded owner-controlled
wallet; feed it the same generated SDL files. This repo does not wrap the CLI — the CLI's own
bid/lease/send-manifest flow is well-documented upstream and duplicating it here would drift.

## Backup, restore, and lease-loss behaviour

Akash's persistent storage is **provider-local**: it survives ordinary container restarts and
in-place deployment updates *within one lease*, but is lost on lease close, provider migration, or
provider failure ("If you close your deployment or switch providers, you lose your data" —
[persistent storage docs](https://akash.network/docs/learn/core-concepts/persistent-storage/)).
A workspace's `/profile` volume (Chromium's persistent context: cookies, local storage, login
sessions) is exactly the kind of state that loss would silently destroy — reappearing as `needs-account`
on every affected agent with no way to tell "lost this session" from "never logged in".

`runtime/browser/profile-snapshot.mjs` closes that gap with an out-of-band, provider-independent
copy:

- **Format**: `snapshot()` tars the profile directory with a small deterministic USTAR writer
  (`tarDirectory`/`untarToDirectory` in the same file — no `tar` package is present in
  `node_modules` either), encrypts it with AES-256-GCM under a key derived via HKDF-SHA256 from an
  operator-held master key and the agent's address (`HKDF(masterKey, info="halo-profile-snapshot:<agent>")`,
  so one leaked/rotated agent key never exposes another agent's profile), and uploads a JSON
  envelope `{version, agent, createdAt, iv, authTag, sha256, size, ciphertext}` through an
  **injected** object store (`{put(key,bytes), get(key), list(prefix)}` — no cloud vendor client
  ships in this repo; wire in your own S3/R2/Backblaze adapter, matching this repo's convention of
  injected transports for network calls).
- **Retention**: the last **3** snapshots per agent, kept in three fixed rotating slots
  (`profiles/<agent>/slot-{0,1,2}.json`) so rotation only ever needs `put`/`get`/`list` — no
  `delete` is required of the injected store.
- **Integrity**: `restore()` verifies the GCM authentication tag and the recorded SHA-256 digest of
  the decrypted archive *before* extracting a single file, and extracts into a fresh staging
  directory that only replaces the target profile directory (via an atomic rename) once extraction
  fully succeeds. Any failure — bad tag, checksum mismatch, truncated archive, a symlink smuggled
  into the tarred tree — throws before the target directory is touched at all; a partially restored
  profile is never left on disk. See `test/profile-snapshot.mjs` for tamper-detection cases.
- **Orchestration**: `runtime/browser/workspace-entrypoint.mjs` runs inside each workspace shard
  service. On start, it restores the latest snapshot **only if the local `/profile` volume is
  empty** (an ordinary restart within a live lease already has current, more-recent local state —
  never overwrite that with an older external snapshot). It then spawns the existing
  `runtime/social-cli.mjs` poll loop as a child process (imported by path, not reimplemented —
  see `test/workspace-entrypoint.mjs`), takes a snapshot every `snapshotIntervalMinutes` (default
  15), and takes one final snapshot on `SIGTERM` before killing the worker.

**What this does not solve**: `runtime/browser/container-runner.mjs`'s existing browser execution
path shells out to `docker compose` to run Chromium in its own nested container — that needs a
real Docker host, and an ordinary Akash service is a restricted Kubernetes pod with no Docker
socket, no privileged mode and no `cap-add` (SDL only exposes `image, command, args, env, expose,
params.storage` plus `profiles`/`deployment` — see `sdl.mjs`'s allowed-field-set validator). This
was already flagged before this change: "The existing supervisor needs a Docker host; ordinary
Akash containers do not automatically supply one. Adapt the supervisor before deploying that
layer." Adapting `container-runner.mjs`/`container-executor.mjs` to run Chromium directly inside
the workspace pod (skipping the nested-Docker layer entirely, using the sandbox gate below) is
**not done by this change** and remains required before a workspace shard can actually run a
browser job on Akash — `workspace-entrypoint.mjs` currently spawns `social-cli.mjs` as-is, which
still assumes a Docker host is reachable from wherever it runs.

## The Chromium sandbox trade-off

Chromium's own kernel sandbox needs a user namespace and (per this repo's prior investigation
recorded in `../../runtime/browser/README.md`) a permitted `chroot` syscall inside that namespace.
Docker hosts can grant both without running privileged; **Akash pods cannot** — SDL has no
`user_namespaces`, `cap-add`, or privileged field to request. Running Chromium unmodified in that
environment fails startup.

`HALO_BROWSER_UNSANDBOXED=1` (read in `runtime/browser/worker.mjs`) is the explicit, gated
response: when set, the worker passes Chromium `--no-sandbox` and `chromiumSandbox: false` instead
of failing, emits one loud structured warning at startup (`event: "chromium-sandbox-disabled"`),
and every report/signed frame from that session carries `sandbox: "container-only"`
(`schema.mjs`'s `browserReportSchema`, propagated through `report-writer.mjs` and `forwarder.mjs`
into the frame a viewer verifies) instead of the default `"kernel"` — so a viewer, and anyone
auditing signed history, can see exactly which isolation boundary was actually in effect for a
given session, rather than assuming a uniform guarantee that was quietly weakened for one host.

**The default stays sandboxed everywhere Docker hosts are used** — `unsandboxed` defaults to
`false` in `containerRunnerSchema`, the env var defaults to `0` in `container/compose.yaml`, and
nothing in this change flips it on. Setting it is a deliberate per-deployment operator decision for
hosts (like an unmodified Akash pod) that cannot grant a kernel sandbox at all, not a default this
repo chooses for the sake of convenience — the pod boundary itself (no root, no extra
capabilities, read-only root filesystem, its own network namespace) is real isolation, just a
different and weaker one than Chromium's own sandbox, and that difference should stay visible in
the signed record rather than silently disappearing.

## Cost model (indicative research figures — not a quote)

The figures below are carried over from `../../../HALO_PRODUCTION_HOSTING.md`'s research pass and
the one real bid recorded in `../../../HALO_AKASH_FIRST_TEST.md`. **None of these are verified
current prices for the actual images/regions this repo would deploy** — get a real bid for the
generated SDL before committing spend.

| Item | Indicative range | Source |
|---|---:|---|
| One CPU-only smoke-test deployment (0.5 vCPU / 512MiB, no GPU) | ~$1.27/month bid (measured) | `../../../HALO_AKASH_FIRST_TEST.md`, one ZenCloud EU-west quote |
| Two shared GPU inference deployments, ~24GiB VRAM each | $750–2,200/month combined | `../../../HALO_PRODUCTION_HOSTING.md` research pass, **not an actual bid** |
| A workspace shard (10 agents × 0.5 vCPU/1.5GiB/4Gi beta2 volume) | Not yet measured | Get real bids per shard once an image is published; scales roughly linearly with shard count |

Persistent volume class matters for price and durability: `beta1` (HDD) is cheapest, `beta2` (SSD,
this generator's default for workspace profiles) balances cost and latency, `beta3` (NVMe, this
generator's default for inference weights) is fastest and most expensive. None of the three change
the lease-loss behaviour above — only ordinary I/O performance within a live lease.

## What remains to be verified on a real provider

- The Console API adapter's actual endpoint paths/response shapes (`console-client.mjs`'s `VERIFY`
  comments) — untested against a live account from this environment.
- That a real provider accepts the generated SDL as-is (field names, GPU `attributes.vendor.nvidia`
  matching a real provider's advertised models, persistent-volume `class` availability per
  provider).
- External ingress reachability for the inference service's `expose` block — the one prior
  connectivity test found loopback health checks passing but external HTTP/HTTPS navigation to the
  provider ingress domain blocked, unresolved (`../../../HALO_AKASH_FIRST_TEST.md`).
- Real snapshot/restore timing and object-store egress cost at workspace scale, and a chosen real
  object-store vendor/adapter (this repo only defines the `{put,get,list}` interface).
- Adapting `container-runner.mjs`/`container-executor.mjs` (or replacing their Docker-Compose
  browser execution with an in-pod Chromium launch using the sandbox gate above) so a workspace
  shard can actually run a browser job without a Docker host — not done by this change.
- A real multi-shard failure drill: close one shard's lease deliberately, redeploy it, restore its
  agents' profiles, and measure recovery time, matching the "30 minutes" recovery target in
  `../../../HALO_PRODUCTION_HOSTING.md`.
- Actual GPU/model compatibility and cold-start latency on a real Akash GPU provider (the inference
  image and acceptance checklist in `../inference/README.md` are unchanged by this work).

## Tests

```sh
node test/akash-sdl.mjs             # SDL generation, allowed-field-set validation, 100-agent sharding, CLI
node test/akash-console-client.mjs  # Fixture-driven Console API adapter
node test/profile-snapshot.mjs      # tar/untar, encrypt/decrypt, rotation, tamper detection
node test/workspace-entrypoint.mjs  # restore/run/snapshot orchestration with a stubbed worker
node test/browser-sandbox-gate.mjs  # HALO_BROWSER_UNSANDBOXED gate, schema, and signed-frame propagation
```
