# HALO — Go live and scale (15 September 2026)

Companion to `HALO_GO_LIVE_AND_SCALE.html` (the same plan as a page) and `HALO_PRODUCTION_READINESS.md` (what was verified).

## Topology

| Tier | Runs on | Scales by |
|---|---|---|
| Website | Cloudflare Workers + CDN (already the build target) | Edge — no origin load |
| Read APIs | 2 Fastify replicas behind HTTPS LB (Hetzner / DigitalOcean, 8 vCPU / 32 GB) | Stateless; add replicas. 15 s snapshot cache + candle tables |
| Live relays | SSE relays for signed steps and frames | Add a Redis pub/sub so any relay serves any stream (frame journal is in-memory today) |
| Operators | 2 independent Linux Docker hosts, own gas keys, PostgreSQL-leased jobs | Add operators; 100 agents = 9,600 cycles/day ≈ 1 every 9 s; prover does 100 proofs / 118 s on 2 CPUs |
| Inference & workspaces | Akash GPU (vLLM, 2 providers, weights on persistent volume); workspaces optionally sharded on Akash with encrypted profile snapshots | Note: Akash cannot grant Chromium's kernel sandbox — container-only isolation, stamped on frames; else keep workspaces on Docker hosts |
| State | Managed PostgreSQL 17 (TLS, backups, cross-provider restore drill); 3 IPFS copies (1 Kubo + 2 pinning services); KMS behind the secret-store interface | — |

Rule: nothing holding a signing key sits behind a public URL; no lease, host or HALO account is an execution dependency.

## Stability at thousands of users

Page views → CDN. Reads → cached stateless APIs (~2k req/s per replica). Live views → SSE relays (~10k connections each) with pub/sub fan-out. Wallet transactions → chain RPC directly (buy a dedicated endpoint). Agent cycles → pulled from leased jobs, never pushed. Reorgs → journal rebuilds the orphan suffix; receipts re-verified in the browser.

Platform stability and per-agent viability are different questions: with default fees an agent needs ≈ $3,400/day attributable volume to fund its own work (`node scripts/economics.mjs`).

## Order of operations

1. **Push to GitHub; CI green** — runs the PostgreSQL, Docker and container-isolation suites this PC cannot. *Owner, 30 min.*
2. **Accounts** — GHCR, Hetzner/DO project with MFA, managed PostgreSQL, dedicated Robinhood RPC, two IPFS pinning services, X developer app (redirect `https://<domain>/connect/x`), Akash Console with card billing. *Owner, one afternoon.*
3. **Build and publish images** by digest from CI. *Automatic once secrets exist.*
4. **Minimal testnet slice** — one host, one replica, one relay, managed DB, site on Cloudflare, chain 46630 (faucet `https://faucet.testnet.chain.robinhood.com`). 2–3 agents, unattended. ≈ $60–100/month. *2 days, then wait.*
5. **Seven-day soak + drills** — duplicate operators, abandoned job, RPC outage, reserve exhaustion/top-up, DB restore, relay down; replacement operator within 30 min. *1–2 weeks.*
6. **Audit** — `CurveMath`, graduation path, `EzklDecisionVerifier`. Immutable vaults cannot be patched after launch. *3–6 weeks.*
7. **Scale the topology** — second operator host, second replica/relay, second inference provider, Redis pub/sub; load test 100 agents + 100 viewers. *1 week.*
8. **Mainnet** — root HALO token, reference market and WETH as configuration; fund operators; deploy reviewed contracts; bind addresses; hand over runbooks.

## Cost envelope (planning ranges, not quotes)

Testnet slice $60–100/month · launch topology $1,500–5,000/month · excludes audit, HALO liquidity, trading capital, engineering.

## Operating rules

Do: digest-pinned images; two of everything under different accounts; monthly restore rehearsal; keys off public hosts; alert on queue age; status page reading from the chain.
Never: an admin pause "for launch"; Docker socket in a workspace; OAuth tokens outside the secret store; a social outage blocking a cycle; market cap or deposits labelled as revenue.
