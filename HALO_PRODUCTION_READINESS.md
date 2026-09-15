# HALO — Production readiness, verified 15 September 2026

This document records what was **executed and observed** on 15 September 2026 in the `halo-claude` working copy, what was changed, what cannot be verified on the founder's Windows PC, and exactly what remains owner-only before a public launch. It supersedes the status claims in `HALO_LIVE_STATUS.md` (14 September) where they differ.

## 1. Repository integrity (fixed today)

| Finding | Effect | Fix |
|---|---|---|
| Windows `core.autocrlf=true` rewrote 433 files with CRLF on clone | Content hashes broke: model release verification failed, and the solc metadata of `models/core-v1/Halo2Verifier.sol` changed so `EzklDecisionVerifier` reverted `WrongVerifier` — every real-proof suite failed | `.gitattributes` forces LF and marks binaries; CI fails on any CRLF checkout |
| `halo-web/build/` (the Sites vite plugin) and `halo-protocol/services/artifacts/` were excluded by over-broad ignore patterns | Website typecheck/build failed; artifact service could not start | Patterns anchored; files restored |
| `test/proof.mjs` read fixtures from a folder outside the repository | Suite could only run in the original Codex workspace | Fixtures vendored to `test/fixtures/core-proof`; verifier read from `models/core-v1/Halo2Verifier.sol` |
| CI workflow lived under `halo-protocol/.github/` | GitHub never ran it | Moved to the repository root, extended to every suite, PostgreSQL and Docker jobs included |

## 2. Test suites — executed on this machine today

All commands run from `halo-protocol/` with `HALO_PYTHON` pointing at the pinned Python 3.12 / EZKL 23.0.5 environment.

| Suite | Result |
|---|---|
| `npm test` (contract lifecycle) | **PASS** 19 scenarios, 116 EVM transactions |
| `test:curve-oracle` | PASS |
| `test:proof` (real EZKL/EVM verification) | PASS — 770,495 gas, tampered proofs rejected |
| `test:inference` | PASS |
| `test:settlement` | PASS 10 scenarios, 45 executions |
| `test:real-agent` | PASS 7 real-proof scenarios, 38 transactions |
| `test:graduated-agent` | PASS 9 scenarios, 42 executions (real Uniswap v4) |
| `test:native-buy` | PASS (ETH → HALO → agent → child routing) |
| `test:runtime` | PASS |
| `test:browser-driver`, `test:browser-egress` | PASS |
| `test:browser-forwarder`, `test:browser-relay` (against the live local stack) | PASS 10 + 10 |
| `test:market-history` (rewritten, 753 real events), `test/market-candles.mjs` | PASS |
| `test:social-connect` (real chain), `test:x-oauth`, `test:secret-store` | PASS 8 + 11 + 8 |
| `test/akash-sdl`, `akash-console-client`, `profile-snapshot`, `workspace-entrypoint`, `browser-sandbox-gate` | PASS 8 + 6 + 7 + 4 + 5 |
| Website `tsc`, `eslint`, `vinext build` | PASS — lint went from 13 errors / 9 warnings to 0 / 0; seven routes build |

Not runnable here and therefore **only reviewed, not executed**: the PostgreSQL suites (`persistence`, `persistence-restart`, `social-outbox`, `agent-inboxes`, `history-journal`, `history-candles-journal`), the Docker browser-container suite, and the Linux acceptance procedures. The root CI workflow runs all of them on Linux with a PostgreSQL 17 service and Docker; **its first run on GitHub is still pending** because the repository has no remote yet.

`test:transparency` still fails locally for a fixture reason: the dev stack seeds its demo agents with placeholder manifest URIs (`https://example.invalid/…`), so an operator cycle against them cannot recover a manifest. It passes only after an agent is created the way the website creates one (manifest pinned through the artifact service) and one operator cycle completes. This is a dev-fixture limitation, not a runtime defect; it is listed in §6.

## 3. Features completed today

- **History aggregation and pagination.** The 5,000-event hard failure is gone in both the RPC reader and the PostgreSQL journal. `GET /v1/tokens/:address/history` adds `candles`, `bucketMs`, `truncated`; `GET /v1/tokens/:address/trades` paginates with a cursor. Documented in `halo-protocol/services/api/MARKET_HISTORY.md`.
- **Social accounts: creator-connected, never agent-created.** The automatic signup path (`onboard`) is removed. The creator signs `HALO_SOCIAL_CONNECT_V1` with the wallet that is the vault's immutable `creator`; X connects via OAuth 2.0 PKCE and posts through X's official API; FOMO links a profile and awaits an operator-run connect session (specified, not built). Migration `0004_social_bindings.sql`, store, secret store, public `GET /v1/agents/:agent/social`, connect/disconnect routes, and the website's Social tab.
- **Akash hosting.** SDL generator for sharded agent workspaces and GPU inference, Console API adapter (endpoints marked VERIFY), encrypted profile snapshot/restore for lease loss, and an explicit `HALO_BROWSER_UNSANDBOXED` gate that stamps `sandbox: container-only` on every signed frame. See `halo-protocol/deploy/akash/README.md`.
- **Network activity feed.** `GET /v1/activity` and the website's Activity page.
- **Unit economics model.** `node scripts/economics.mjs` — break-even volume and lifespan under volume decay from measured gas. With defaults, a vault must attract about **$3,400/day of attributable volume** to fund its own work.
- **Website.** Rebuilt on a structured design system (commit `47411fd`); two further standalone design directions published for the founder's decision (`halo-design/redesign-v2`, `redesign-v3`). The React app will be re-skinned to the chosen direction; its data layer is stable.

## 4. Owner-only gates (cannot be done by engineering alone)

1. **Push the repository to GitHub** and let the root workflow run: this executes the PostgreSQL, Docker and Linux suites that this PC cannot.
2. **Root HALO token and reference market** on Robinhood Chain, plus the real WETH address, supplied as deployment configuration.
3. **Accounts and funding:** a container registry, a Hetzner/DigitalOcean host (or Akash workspaces), managed PostgreSQL, an RPC provider, an X developer app (client id/secret, redirect URI) — see `HALO_PRODUCTION_HOSTING.md` and `deploy/akash/README.md`.
4. **Independent audit** of `CurveMath`, the graduation path and `EzklDecisionVerifier` before any real funds: activated vaults are immutable, so a contract bug is permanent.
5. **Seven-day public-testnet soak** (chain 46630; test ETH from the faucet at `https://faucet.testnet.chain.robinhood.com`, or bridge Sepolia ETH via the Arbitrum bridge) and the 100-agent load test.
6. **Product decisions still open:** whether the FOMO connect session (live input into the agent's isolated browser) should be built; whether Akash's container-only Chromium isolation is acceptable for social browsing or those workspaces stay on Docker hosts.

## 5. What "production ready" means after today

Everything that can be built and verified on one machine without accounts, funds or a Linux host has been built and verified, and the defects that would have broken a fresh checkout are fixed. The remaining path is operational, not engineering-blocked: push, let CI prove the Linux suites, provision, deploy to testnet, soak, audit, then mainnet.

## 6. Known limitations carried forward

- Dev-stack demo agents cannot be driven by `dev:operator`; create an agent through the website (or `test/create-model-pipeline-agent.mjs`) to exercise the transparency suite.
- Akash workspaces: the entrypoint still spawns the Docker-based social runner; running the browser worker natively inside a pod is unfinished.
- Console API endpoint shapes are unverified against a live Akash account.
- The proof establishes that an action is permitted, not that the model authored it; the docs and website copy now say exactly that.
