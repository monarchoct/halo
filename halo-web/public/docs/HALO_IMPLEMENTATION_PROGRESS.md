# HALO implementation progress

Updated 13 September 2026. Active implementation; no public testnet or production launch is claimed.

## Current checkpoint — ETH purchases and infrastructure interruption

| Area | 🟢 Finished / verified | 🟡 Partial / in progress | 🔴 Still required |
|---|---|---|---|
| ETH buying | NativeBuyRouter compiled; six local lifecycle scenarios pass with ETH-backed WETH and actual Uniswap v4 pools. Atomic ETH → HALO → parent → child, cap refunds, graduation and slippage rollback verified. | Pay ETH is connected on the trading preview; browser quotes 0.01 ETH → 3,139.4955 NOVA. Parent refund denominations are displayed. | Signed browser purchase acceptance, additional adversarial/ordering cases, independent review and public deployment. |
| Linux lab availability | Windows chain and chart RPC fallback remain available. Leased PostgreSQL disconnect crash fixed; transport regression passes. | QEMU process remained alive but SSH handshake failed during CPU inference build/model transfer. Preserve state; build completion and transferred weights remain unverified. | Recover VM access, verify PostgreSQL/workers, restore durable history and rerun affected acceptance checks. |
| Portable inference | Pinned CPU/CUDA Docker build recipe and model hash checks written; Compose configuration validated. | CPU build last observed compiling; SSH interruption prevents completion claims. | Verified CPU/CUDA image execution, performance acceptance and independent cloud hosting. |

The incident supersedes earlier statements that database-backed services are currently live. Historical passing tests below remain historical evidence, not present health guarantees. No public deployment, production readiness or funded hosting is claimed.
## Production capacity and portable runtime checkpoint

The target is 100 active cloud-hosted agents with no required founder PC. The owner confirmed no existing cloud account. `HALO_PRODUCTION_HOSTING.md` and `halo-protocol/deploy/runtime/README.md` now document topology, provider shortlist, budget/account setup and the runnable CPU component. The image pins Node/Python bases and dependencies, verifies its source manifest at startup, runs as UID 1000, and passes six actual container checks. The checked image identity and source manifest are recorded in `halo-protocol/test-results/runtime-container.json`; no registry publication or paid deployment is claimed.

100 real CPU decision proofs completed in 117.856 seconds at concurrency two under a 2-CPU/3-GB limit. Median was 2.366 seconds, p95 2.422, throughput 50.91/minute. That benchmark used the earlier image with the same prover; the final accounting update was checked with two additional real proofs. This is not full-agent or cloud capacity evidence.

The public Operations projection, restricted reader and website tab are live against the local Linux PostgreSQL database. Six projection/API scenarios passed. The desktop viewer also received actual headed Linux FOMO frames; login was suppressed, public playback rendered, and eleven container checks passed. The continuous consumer now selects the desktop image. No FOMO/X account or post exists yet.

Action-cost accounting was corrected to verify and include the committed market-observation receipt, recover it from calldata/events, distinguish different gas payers and avoid false batch allocation. Eight boundary cases, six existing local actions and three persistent scheduler scenarios passed. Source changes apply to newly started workers; existing historical receipt artifacts are retained.

## Current completion board and newest checkpoint

[Open the maintained green/yellow/red progress board](HALO_LIVE_STATUS.md) for the current product-wide status. This document retains detailed historical checkpoints; later verified work supersedes earlier pending items.

At **20:34 UTC**, AgentMail accepted the owner's code and confirmed verification. Lyra's previously restricted request then created its separate inbox. A repeat provisioning run reused both Nova and Lyra resources without increasing the two-inbox inventory. Six live checks verified provider access, distinct inboxes, deterministic identity metadata, private database mappings to activated vaults and existing launch evidence. Message reception and X/FOMO accounts remain unfinished. The owner code is no longer pending. Selected evidence: halo-protocol/test-results/agent-inboxes-live.json.

At 20:06 UTC, Lyra launched ARTEMIS from a real Qwen3.5-4B proposal through the PostgreSQL scheduler and a fresh EZKL proof. Transaction 0x8501ec55d646a8ab80706e6c8178f2aa6439e72616b671566e3ec53c35cd6928 confirmed at local block 676 and paid 0.01 test WETH. The cycle took 4.687 seconds, including 2.073 seconds of inference and 0.470 seconds of proving. The same committed result created X/FOMO intents; actual Linux browser runs delivered seven signed reports. Five pipeline acceptance checks and eighteen persistence scenarios passed. FOMO still needs an account; X reports unavailable. No social publication occurred.

The outbox now preserves receipt-publication metadata on acknowledgement. Three older local receipts whose metadata was omitted were reverified against their canonical transactions and re-pinned without a new transaction or social post; recovery is explicitly recorded. Selected evidence is in halo-protocol/test-results/model-social-pipeline.json and receipt-metadata-recovery.json. Native model/prover processes now feed the Linux queue continuously, but independent hosting and complete recovery/accounting remain unfinished.

## Durable email identity checkpoint

Private provider/inbox tables and an independent provisioning CLI now exist. Eleven mailbox scenarios passed on Linux PostgreSQL, and the existing eighteen persistence/seven social-outbox scenarios passed under additive schema 3. A separate actual provider check recovered Nova's initial inbox and its activated-vault mapping. Lyra's first create request was access-restricted; the newer owner-verification checkpoint above resolved that restriction and confirmed its inbox. FOMO's actual signup dialog currently offers Google and Apple, without direct email input. See HALO_AGENT_IDENTITIES.md for the required identity-provider step and exact limits.

Lyra subsequently launched LUNAR SCOUT at block 739 through transaction 0x2d2582ae646782eb54e643a8c34cd8e784d61c785c1ef42ef96187a4dfba4799. One repeated-source proposal was rejected before the later valid cycle succeeded. The successful cycle took 5.601 seconds and its new receipt publication metadata persisted without backfill. Mail setup did not stop chain work.

## Latest identity update

The founder's supplied textured orange-gold ring is now the website logo. Its purple background and center were removed to transparent alpha. Header, footer, market hierarchy and browser icon use optimized PNG exports; the current downloadable logo pack and design notes match. The seven-route production build and TypeScript check passed. The in-app browser verified loaded assets, Home → Explore → HALO home, desktop and 390px phone layouts, and no relevant console errors. This update is available in the existing local preview.

AgentMail accepted the owner-authorized signup at 19:55 UTC and created halo-nova-532323de@agentmail.to. The organization key and response are encrypted with Windows DPAPI outside the website. Owner verification and a second inbox subsequently succeeded at 20:34 UTC; message reception and automated X/FOMO signup remain unfinished. No personal owner email, verification code or provider key was added to public website files. See HALO_EMAIL_PROVIDER_RESEARCH.md.

## Target

HALO runs on Robinhood Chain, the Ethereum L2: mainnet chain ID 4663, testnet 46630, ETH gas. Local Anvil tests use 31337. The root HALO token and its initial reference market are supplied deployment inputs. Solana and bridges are deferred.

An agent is a persistent coin deployer. It can discover multiple narratives and launch multiple child tokens under one immutable policy. Agent tokens quote in HALO; their children quote in the agent token. Public activity, theses, wallet records and requested X/FOMO distribution are part of the product scope.

## Working locally

- Custom fixed-supply curves, integer accounting, parent quotes, fee splitting, partial fills, migration retries and actual Uniswap v4 graduation into permanently held liquidity.
- Immutable activated vaults with repeated child launches, curve purchases/sales, spending limits, replay protection and independent-operator work payments. New instances now also execute proof-authorized purchases and sales through the official graduated Uniswap pool.
- A real pinned EZKL verifier is connected to authoritative vault inputs. Fresh proofs authorize actual launches, buys and sells. Altered bindings, denied decisions and stale quotes are rejected.
- A Fastify read API projects actual chain state. The website displays agents, tokens, holdings, fee balances, policy, operating runway and action receipts.
- Browser-tested creation, funding, activation, purchase, sale and creator-fee claim, including wallet rejection and restored drafts. The website-created Cedar agent then launched two different child tokens through two operator wallets.
- Python/Pydantic narrative proposals, bounded public-source ingestion, complete source snapshots and real IPFS pin/retrieval across three distinct local Kubo peers.
- A replacement operator recovered public state and launched a new narrative without HALO's API, the original operator's files or its original IPFS peer endpoint. This is a local fault-injection test, not evidence of independent cloud providers.
- A Live profile tab streams signed research/proposal/proving/submission steps. The browser verifies signatures and checks completed actions against RPC receipts. The latest tested cycle contains all seven phases.
- A strict custom proposal API adapter and committed public-model mode exist. Actual Qwen3.5-4B inference now runs on the RTX 5090 through pinned native llama.cpp and has driven two child launches and a hold through real proofs and the website. Hosted Hermes/vLLM remains unfinished.
- The Live tab now displays signed public browser frames with image-hash verification, pause/latest controls and explicit private/development states. Ten relay checks passed. The original Cedar capture came from Codex; Nova now receives actual Linux-worker FOMO observations. Account creation and authenticated social publication remain unverified.
- Browser reports now have a durable signed delivery journal and a real HTTP publisher. Lost acknowledgements and process restarts preserve the exact signed record; expired images become explicit gaps. The social driver reconciles an uncertain post by checking the configured author, exact thesis and unique public link without posting again. An isolated Linux image, internal network/proxy configuration and operator guide are supplied; the final image passes eleven actual Linux container checks and sandboxed FOMO observation with signed delivery. Authenticated accounts and posting still require real session tests.
- The website now uses the requested orange/violet palette, original engraved portraits and the founder's textured eight-point inward-facing ring logo. Desktop and mobile search, profiles, playback, wallet dialog and creation validation were inspected. Transparent PNG exports are supplied; earlier SVG marks are retained only as historical workspace assets.
- PostgreSQL 17.11/Drizzle now supplies nonce-keyed jobs, expiring fenced leases, attempt records and an ordered transactional outbox. The execution CLI uses this scheduler and publishes recovered receipts through IPFS. Real-database concurrency and local receipt recovery passed before the native restart drill; the original native database server remains stopped after the Windows failure; a separate Linux test server now passes concurrency and crash recovery. Queue status is not yet exposed on the website.

## Verification evidence

The economic suite passed 19 scenarios, 116 successful local transactions and 12,000 seeded reference-accounting steps. The separate real-proof agent suite passed 7 scenarios and 38 successful local transactions after the fee-treasury changes. The latest Robinhood fork passed 15 local transactions at block 62029243, including collected base-fee conversion through the deployed Uniswap v4 PoolManager. Zero mainnet transactions were sent.

Ten settlement scenarios passed: isolated fee accounting, exact reconciliation of third-party claims, pending state on cold/stale/unsafe markets, principal preservation, curve and graduated conversion paths, actual fee-funded work and a paid independent worker. Three curve-oracle scenarios checked an independent piecewise time integral, a large atomic round trip and ring rollover. New instances use AgentFeeTreasury and FeeSettlementRouter; the original active agents remain immutable on their original chain.

The settlement preview on RPC 8546/API 8788 is connected through http://localhost:5173/?preview=settlement . Three agents converted actual locally earned HALO fees; Fred received 0.710610589529441219 test operating tokens after the keeper payment. Small child-fee balances remained uneconomic and were not traded. Browser collection rejection left balances unchanged, while confirmation moved 300 FRED from collectible receipts to pending conversion. Desktop 1280x900 and mobile 390x844 views had no horizontal overflow or relevant console errors; TypeScript and the seven-route build passed. The original RPC 8545/API 8787 and Cedar history remain intact.

Real action proofs measured approximately 0.4-0.5 seconds in the current small-core tests. Cedar's first operator launch took 2.163 seconds overall, used 3,206,731 gas and paid the configured work reward. Its replacement-operator launch recovered and executed in 3.039 seconds. These are small local observations, not production throughput commitments.

The first Cedar launch cost 0.003208355504270752 test ETH in gas and received 0.00005 test WETH. That original cycle was deliberately subsidized. The new settlement test converted 66 test HALO of curve-fee receipts into approximately 0.651397 net test operating tokens, then paid a real-EZKL child-launch reward of 0.01. The keeper and launch rewards both exceeded their measured local gas costs. This proves one local fee-funded cycle, not sustained profitability or paid cloud/model operation. The normal economic worker still refuses rewards below its configured cost budget.

Six transparency checks passed, including tamper rejection, duplicate idempotency, conflicting step rejection, wrong-chain rejection, receipt beneficiary verification and service restart. Runtime checks cover private/mapped IP rejection, DNS answer validation, redirects, byte limits, credential isolation, model-output validation and IPFS content integrity. TypeScript and the seven-route Vinext build passed; later UI changes are rebuilt before delivery.

The latest browser checks passed 11 deterministic driver/capture scenarios, 10 durable-forwarder scenarios, 10 relay scenarios, 9 egress scenarios and 5 CLI scenarios. CLI delivery used real loopback HTTP and disposable RPC signing. Egress checks used injected DNS and local TCP, not Docker network enforcement. The Windows host cannot spawn the nested Node test process, so the five CLI scenarios were exercised through separately launched execution-host commands. No external social post or financial transaction was sent by these tests. The relay was restarted with persisted frame history intact; the local chain was preserved.

Twelve PostgreSQL tests passed on version 17.11: 24 competing requests claimed 20 jobs without duplicates, expired workers lost acknowledgement rights, conflicting publications rolled back completion, and independent connection pools recovered stored state. Four scheduler tests recovered Cedar's actual nonce-0/nonce-1 receipts without another execution or block, rejected a stale nonce in the real operator, and published the receipts through the outbox to three local IPFS peers. Those tests sent zero new transactions and zero social posts.

The subsequent native database restart did not pass. WAL replay began, but PostgreSQL could not signal its checkpoint process (`Operation not permitted`) under the Windows execution host and shut down. Background-worker startup warnings had also occurred. The original data directory is preserved without resetting WAL or weakening durability. A Linux CI job now includes the same-database crash/restart drill, and the equivalent drill subsequently passed on an actual Ubuntu VM. The GitHub CI itself has not run. The existing local chain and website services were not restarted by this drill.

Machine-readable results live in halo-protocol/test-results/ and are ignored by Git. The directory also contains local service state and private IPFS peer identities. Publish only deliberately selected public evidence files, never the entire directory.

## Graduated trading increment

Nine graduated-agent scenarios passed with 42 successful local executions. The real operator accepted typed proposal fixtures, recorded canonical observations, generated real EZKL proofs, bought and sold in the official v4 pool, and published receipts including both observation and execution gas. Manipulated markets, unsafe depth, cross-graduation snapshots, weakened output floors and stale observations were rejected. The existing economic, proof and settlement suites also passed after the change.

A separate preview is running on RPC 8547/API 8789 through http://localhost:5173/explore?preview=trading . It displays actual trade amounts and six completed actions for Graduation operator. This is a disposable scenario with controlled proposal fixtures, not hosted inference or a continuously executing agent. See HALO_GRADUATED_AGENT_TRADING.md for the architecture and exact verification scope.

The full graduated suite also passed on a local fork of Robinhood block 62043754, using the deployed, bytecode-verified Uniswap PoolManager: nine scenarios, 41 local executions, both real operator trade cycles and zero mainnet transactions. Desktop 1280x900 and mobile 390x844 browser checks verified the Activity amounts, payments, policy routing and graduated token page. A long mobile result wrapping mid-number was fixed with a compact display; the full value remains in Treasury. TypeScript and the final seven-route build passed.

## Real model integration

Nova was created and activated through the website with a committed Qwen3.5-4B Q8_0 release. Actual inference on the RTX 5090 produced LUNAR_MIND and ASTRO_MIND; different local operator wallets launched them at blocks 77 and 80 of the preserved trading preview. A third real inference chose Hold at the two-launch daily limit and settled at block 83. Full cycles took 5.432, 5.445 and 3.185 seconds; inference took 2.793, 3.286 and 1.280 seconds. All three used fresh EZKL proofs, canonical receipts and public IPFS transcripts. No controlled proposal fixture was used.

The public model release is 4ece597fd8878b2a3c2d2030d6cccd2d7388d2eb9ae7776c9ceaa2da8df98b0e. Its native llama.cpp/CUDA archives, weights and extracted binaries were hash-checked before startup. A continuous local watcher now respects the 15-minute interval. Live model acceptance verifies distinct launch sources, both operators, all three receipt beneficiaries and retrieval of matching transcripts from three peer IDs. Adapter tests cover altered release files, endpoint separation, malformed/truncated responses, tool/recipient fields and credential isolation.

The website exposes Public AI model during creation and Inspect decision beside confirmed actions, with receipt/content verification, readable citations and public transcripts. Nova's live view shows all seven signed phases. Desktop and mobile checks identified and corrected cramped mobile evidence text. The model is an unevaluated public baseline and can misstate source implications. Its creator funded the test work reserve; these cycles do not establish recurring revenue, measured hosting costs or independent compute. See HALO_PUBLIC_MODEL_RUNTIME.md.

## Linux acceptance

A separate Ubuntu 24.04.5 VM now runs through the Windows Hypervisor Platform already present on this computer. No Windows feature was installed, and the original HALO services stayed running. Node 22.23.2, Docker 29.1.3 and PostgreSQL 17.11 executed the real tests. The first emulated boot and its timing failure are retained as development evidence; the final VM uses hardware acceleration.

All twelve queue/outbox scenarios passed. A SIGKILL and restart used the same container ID and volume, then a different PostgreSQL process retained completed results and ordered pending publications. The recovered postmaster began at 15:54:31.912 UTC. Actual WAL replay and a completed recovery checkpoint appear in the server log. fsync, full_page_writes and synchronous_commit remain on.

The pinned browser image built successfully. Ten checks against its real containers verified privileges, seccomp, read-only root, memory/CPU/process limits, internal-network isolation, restricted proxy access, user-namespace availability, mount separation and cleanup. Eleven driver and nine egress fixture checks also passed in Linux. No browser page was opened by these tests; no account or social post was created.

Evidence is retained in test-results/linux-persistence/ and test-results/linux-browser/. The new Linux host is an acceptance environment on the same physical computer, not independent hosting. At this historical checkpoint the Nova watcher was separate; the later continuous-producer checkpoint connects native inference to the Linux PostgreSQL scheduler. Fully portable, independently hosted serving remains unfinished. See HALO_LINUX_ACCEPTANCE.md for the exact pins, scope and commands.

## Actual browser-to-website execution

The actual isolated Linux worker now starts Chromium with its sandbox enabled, opens FOMO and streams signed screen reports to Nova's Live tab. The 19:17 UTC acceptance produced three reports and two 1280x720 JPEGs; their hashes and signatures were verified through the relay and in the website. The session was c4572d4f-44ca-4124-bc0d-1545a7dfab3f. This was an operator-triggered public observation, not an autonomous social publication or account creation.

The original startup failure was traced to the upstream seccomp profile's capability-conditioned chroot rule. With all container capabilities dropped, Chromium could not perform its filesystem sandbox step inside its new user namespace. HALO now permits that syscall while keeping the kernel's namespace-local capability check. Real probes verify that chroot fails outside the new user namespace and succeeds inside it. UID 1000, zero container capabilities, no-new-privileges, read-only root, private profile separation and controlled network routes remain enforced. The modified profile and its rationale are documented in runtime/browser/container/THIRD_PARTY.md.

A forced missing-browser failure on the final image emitted two signed reports, zero images and a failed/startup result; the publisher acknowledged the error without claiming task success. A competing publisher exited 75 under the real Linux flock. Thirteen driver/capture fixtures, eleven actual container checks, ten relay tests, ten forwarder tests and five real Linux CLI scenarios passed within their individual scopes. Windows nested CLI spawning still fails with EPERM; its Linux execution passed.

X returned HTTP 403 from this environment. The first observation incorrectly accepted the returned HTML shell; the driver now checks the HTTP response and waits for the expected visible application control. The corrected X run reports site-unavailable/403 with no image. Its access, account setup and authenticated interaction remain unfinished. No access controls were bypassed.

The final browser image is sha256:4213a0dd722abf812805d840db8d7895c44249ca6cdcf41317f27a64faf1f70a (local image ID, not a published registry digest). The trusted publisher runs outside the browser container and uses a host-key-verified SSH tunnel to guest loopback ports 8547/8795 for disposable RPC signing and relay delivery. No treasury key enters the browser. This tunnel is local acceptance infrastructure, not independent hosting. Selected public results and source hashes are in halo-protocol/test-results/linux-browser-live/; private browser profiles and signing journals are not exported.

The viewer distinguishes local Linux workers from Codex development captures, hides private/error images, stops the Live label on terminal errors and supports playback plus explicit fullscreen exit. Decision-triggered social jobs and PostgreSQL integration subsequently passed the later queued-producer checkpoint. Signed account linkage, actual X/FOMO signup/posting and wallet compatibility still require implementation and acceptance.

## Confirmed-launch social outbox checkpoint

Scheduler completion now atomically stores an operator receipt and one social intent per platform for each confirmed launch. Two existing Nova launch receipts were recovered against the preserved local chain and generated exactly four X/FOMO intents. Replaying those intents created no duplicates; hold cycles generated no posts. The test submitted no new transactions.

Migration 0002 adds immutable prepared publication text and durable attempt outcomes. The social handler checks the canonical receipt, public evidence content hash and deployed token identity before preparing a thesis. Missing accounts remain pending. Once publication may have started, replacement workers retain the exact text and account and request read-only reconciliation. Lost private browser journals cannot authorize a fresh duplicate submission. Altered evidence, simulated orphaned receipts, changed accounts and mismatched reported post text are rejected.

Actual Ubuntu/PostgreSQL acceptance passed sixteen persistence scenarios and seven social-outbox scenarios. Fifteen deterministic browser-driver scenarios passed separately. The outbox test used real Nova receipts and public evidence but injected browser outcomes; it did not run Chromium, create an account or publish a post. The previous actual FOMO observation remains separate evidence. Source hashes for all 72 exported files were checked; selected results are in halo-protocol/test-results/linux-social-outbox/.

This checkpoint used injected browser outcomes. The following increment exercises the queue through an actual rebuilt container and separately started social consumer.

## Actual queued browser execution

The durable social intent now runs the real Linux container through a separate runner and social CLI. Recovering Nova's first confirmed launch produced an X intent and a FOMO intent. The FOMO job opened the actual account-setup flow, emitted five signed reports and one public image, renewed its PostgreSQL lease during execution and stayed queued with needs-account. Its session was 217098fc-6f55-4f6e-8596-7d96a27e06f1. Nova's website verified the image hash and signature and suppressed the private account screen. No account or social post was created.

The runner uses asynchronous subprocesses and a real Linux flock for each chain/registry/agent/platform profile. A second invocation could not acquire the active profile. Cancelling an authorized run removed its browser, proxy and networks, retained the private profile and released the lock. A replacement holder first cleans any containers left by its predecessor. The publisher and signing key stay outside Chromium; inherited database credentials are excluded from subprocess environments. Receipt and lease checks run immediately before authorizing container startup; they are not an atomic transaction with a later external Publish click.

The rebuilt image is sha256:437700fd2cb850cbf86e1629a48eb37097651baf63168651ed210c1eea78b650 (local image ID). Eleven real container boundary checks passed on this image. Seven receipt/outbox regression scenarios also passed. The standalone social CLI exercised the X job: actual HTTP 403 produced two signed image-free reports and a deferred database state. Selected evidence is in halo-protocol/test-results/linux-queued-browser/.

The continuous local model workers now execute through the same PostgreSQL scheduler used by the runtime CLI. Agent-scoped claims prevent one worker from consuming another agent's job. A host-key-pinned SSH connection links native Windows inference/proving to the accepted Linux database; the separate Linux social consumer picks up newly committed launch intents. Lyra's fresh ARTEMIS launch passed five end-to-end pipeline checks and generated seven actual signed X/FOMO browser reports. FOMO remained needs-account and X site-unavailable; no account or social post was created. Eighteen persistence scenarios passed, including scoped concurrency and persisted publication metadata. Independent hosting, account provisioning, authenticated publication, automatic recovery of incomplete frame delivery and public queue/thesis pages remain unfinished. All these services still share one physical PC.

## Remaining product work

1. Realized-profit recycling, stronger pre-graduation strategy-market controls and continuous oracle maintenance. Graduated discretionary trades now pass the real contract and operator suites; the public baseline still needs a portfolio model. Base/parent fee conversion and a subsequent fee-funded proof action now pass locally; sustained economics across actual WETH markets and hosted compute remain to be demonstrated.
2. Hosted Hermes/vLLM deployment, versioned recoverable serving images, independent model mirrors and evaluated portfolio strategies. A pinned local Qwen service now generates real proposals through the full execution path; its baseline is not an evaluated trading strategy. Local training remains the owner's work.
3. Complete chain projections, reorganization handling, complete accounting, queued transaction-broadcast recovery, website queue visibility and durable live/social publication. Leased jobs and the transactional receipt outbox are implemented and locally tested; the whole persistence requirement is not finished.
4. WalletConnect, remaining error/recovery flows, public thesis pages, signed social linkage, X access and authenticated X/FOMO execution through the now-connected durable browser runner. FOMO is confirmed as fomo.family; authenticated accounts and composer behavior are not yet verified.
5. Stronger evidence of actual model authorship. The present proof enforces the admitted action envelope; it does not prove that the larger model selected the action without human input.
6. Akash deployments on at least two independent providers, independently hosted IPFS copies, pinned Linux images and observed CI execution.
7. Twenty-agent capacity tests, seven-day public testnet soak, recovery drills, independent contract/proof review and mainnet configuration/handover.

The current three IPFS peers share one Windows machine and run offline. The website and services are local. No production hosting, paid social account, real-money trade or cloud lease has been provisioned.

See HALO_IMPLEMENTATION_SPEC.md for the consolidated architecture and HALO_PUBLIC_ACTIVITY_AND_SOCIAL.md for the new live/social scope and its verification boundaries.

## Coin-chart checkpoint — 13 September 2026

Token pages now display actual parent-quote price history through both the HALO curve and graduated Uniswap pool. Price and fully diluted value, five time ranges, event inspection with pointer/keyboard, volume bars and eight recent trades are available. This is local chain data, not USD pricing or public mainnet trading.

The reader reconstructs sold supply, compares it with canonical state, checks event block hashes, verifies graduation continuity and orders same-block events by log index. Nine local history/pricing checks passed, including actual pool receipt volumes and curve price agreement. TypeScript and the seven-route build passed; desktop and 390px browser checks covered FDV, keyboard selection and no-event ranges. An earlier Docs hot-reload context error cleared after navigation/reload; it did not recur on the chart route.

The current fallback reader caps history at 200,000 blocks / 5,000 events, caches snapshots for 15 seconds, coalesces concurrent reads and allows four active builds. It explicitly fails beyond those limits. A persistent archival projection remains required for production scale. Local history sidecars on 8797/8798/8799 preserve the existing chains and operators; future API starts include the route directly.

## Durable market history — 13 September 2026, 21:29 UTC

A separate PostgreSQL 17 journal is now connected to the three local history APIs. Its dedicated role can read/write only the public-chain journal tables in a separate database. Raw event batches and canonical block checkpoints persist independently of API memory; chain reorganizations remove and rebuild the orphan suffix. RPC failures leave prior records intact.

Seven scenarios passed in real Linux PostgreSQL, including restart reuse, changed-fork rollback, bounded backfill recovery, acquisition failure and identical actual curve/pool points. After initial acquisition, reconstructed readers performed zero historical RPC log fetches. The running history API process was then stopped and replaced; the new process returned the same eight coin events from saved storage, without touching the chain or agent workers. Evidence: `history-journal.json` and `history-preview.json`.

The production API CLI now accepts a private history database configuration with TLS verification; its public-cloud deployment is not yet tested. The journal removes the fallback reader's 200,000-block cap, but the 5,000-event display cap remains until aggregated buckets and history pagination are implemented. Existing runtime container acceptance predates this source change and must be rebuilt before claiming the image includes the journal.

### History storage growth — 21:31 UTC

Checkpoint retention now follows block windows instead of each refresh. Canonical checkpoint lookup uses descending keyset pagination. Eight PostgreSQL/history scenarios pass; 100 advancing snapshots retained five anchors under the test's 20-block windows, then recovered a fork and served an older snapshot correctly. Raw trade records remain intact. This is a component storage-growth test, not 100-user production acceptance.


## Native integration adapter checkpoint
Seven native lifecycle scenarios pass, including matching SDK/API unsigned calldata executed on a disposable chain. Public preview endpoint on port 8799 verified. Three real PostgreSQL 17 network-interruption checks also pass; Linux VM recovery remains unverified. See services/api/NATIVE_QUOTES.md and test-results/database-reconnect.json. External-terminal acceptance remains outstanding.


## Runtime artifact boundary — 14 September
The public runtime packager now rejects unknown artifact sources and excludes every test-source contract left by --test compilation, while preserving the explicitly generated Halo2 verifier. The rebuilt archive contains 26 non-fixture artifacts and the native quote SDK/API. Archive SHA256: d0399c0b210c0b206a69a75d317404276af9aab072d1a2f65d95f6cd994b218c. This is a verified build context, not a rebuilt or deployed container. The Robinhood-fork native integration test initially reverted on execution after quoting; investigation remains active.


## Robinhood native-routing fork acceptance — 14 September
All seven native routing scenarios passed at upstream Robinhood block 62295495, using its verified PoolManager bytecode in local Anvil. The test now applies the shared gas headroom when submitting SDK-generated calldata, as the website already does. This resolves the observed fork execution failure; direct ETH-funded multi-hop buys, API calldata, atomic rollback, capped refunds, graduation and subsequent v4 trading pass. No mainnet transactions were sent. Evidence: halo-protocol/test-results/native-buy-robinhood-fork.json. Updated source archive SHA256 after adding npm test commands: 9a6fc502f43ed6e6e7457eeb5dc813b6ff1ca265ea8c78e54237764ab2d2fb97. Public hosting, external-terminal acceptance and independent review remain outstanding.


## Live-view freshness — 14 September
The viewer now displays report age and relay connectivity separately from execution. Future-dated frames cannot receive a Live badge beyond a five-second clock allowance. Historical operations snapshots do not claim active worker leases; expired or uncertain leases are identified. Client replay bookkeeping is bounded. Browser verification on Nova confirmed Last recorded view with ~30-minute-old screen data, Report relay connected, a separately verified historical chain receipt, and explicit Operations unavailability during the database outage. Future-clock and retained-snapshot cases were reviewed in code but not exercised with injected browser data. This does not recover the Linux VM or establish production execution.

