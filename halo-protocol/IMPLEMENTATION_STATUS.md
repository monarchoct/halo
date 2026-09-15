# HALO implementation progress

Updated 13 September 2026. Active implementation; no public testnet or production launch is claimed.

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
- A strict custom proposal API adapter exists. It has boundary tests, but a deployed Hermes/vLLM/Qwen service has not been exercised yet.
- The Live tab now displays signed public browser frames with image-hash verification, pause/latest controls and explicit private/development states. Ten relay checks passed. The observed FOMO homepage capture came from Codex's browser; an autonomous social session has not been run.
- Browser reports now have a durable signed delivery journal and a real HTTP publisher. Lost acknowledgements and process restarts preserve the exact signed record; expired images become explicit gaps. The social driver reconciles an uncertain post by checking the configured author, exact thesis and unique public link without posting again. An isolated Linux image, internal network/proxy configuration and operator guide are supplied; the image and authenticated accounts still need real execution tests.
- The website now uses the requested orange/violet palette, original engraved portraits and an eight-point inward-facing ring logo. Desktop and mobile search, profiles, playback, wallet dialog and creation validation were inspected. SVG and transparent PNG logo exports are supplied.
- PostgreSQL 17.11/Drizzle now supplies nonce-keyed jobs, expiring fenced leases, attempt records and an ordered transactional outbox. The execution CLI uses this scheduler and publishes recovered receipts through IPFS. Real-database concurrency and local receipt recovery passed before the native restart drill; the database server is currently stopped following the Windows signaling failure described below. Queue status is not yet exposed on the website.

## Verification evidence

The economic suite passed 19 scenarios, 116 successful local transactions and 12,000 seeded reference-accounting steps. The separate real-proof agent suite passed 7 scenarios and 38 successful local transactions after the fee-treasury changes. The latest Robinhood fork passed 15 local transactions at block 62029243, including collected base-fee conversion through the deployed Uniswap v4 PoolManager. Zero mainnet transactions were sent.

Ten settlement scenarios passed: isolated fee accounting, exact reconciliation of third-party claims, pending state on cold/stale/unsafe markets, principal preservation, curve and graduated conversion paths, actual fee-funded work and a paid independent worker. Three curve-oracle scenarios checked an independent piecewise time integral, a large atomic round trip and ring rollover. New instances use AgentFeeTreasury and FeeSettlementRouter; the original active agents remain immutable on their original chain.

The settlement preview on RPC 8546/API 8788 is connected through http://localhost:5173/?preview=settlement . Three agents converted actual locally earned HALO fees; Fred received 0.710610589529441219 test operating tokens after the keeper payment. Small child-fee balances remained uneconomic and were not traded. Browser collection rejection left balances unchanged, while confirmation moved 300 FRED from collectible receipts to pending conversion. Desktop 1280x900 and mobile 390x844 views had no horizontal overflow or relevant console errors; TypeScript and the seven-route build passed. The original RPC 8545/API 8787 and Cedar history remain intact.

Real action proofs measured approximately 0.4-0.5 seconds in the current small-core tests. Cedar's first operator launch took 2.163 seconds overall, used 3,206,731 gas and paid the configured work reward. Its replacement-operator launch recovered and executed in 3.039 seconds. These are small local observations, not production throughput commitments.

The first Cedar launch cost 0.003208355504270752 test ETH in gas and received 0.00005 test WETH. That original cycle was deliberately subsidized. The new settlement test converted 66 test HALO of curve-fee receipts into approximately 0.651397 net test operating tokens, then paid a real-EZKL child-launch reward of 0.01. The keeper and launch rewards both exceeded their measured local gas costs. This proves one local fee-funded cycle, not sustained profitability or paid cloud/model operation. The normal economic worker still refuses rewards below its configured cost budget.

Six transparency checks passed, including tamper rejection, duplicate idempotency, conflicting step rejection, wrong-chain rejection, receipt beneficiary verification and service restart. Runtime checks cover private/mapped IP rejection, DNS answer validation, redirects, byte limits, credential isolation, model-output validation and IPFS content integrity. TypeScript and the seven-route Vinext build passed; later UI changes are rebuilt before delivery.

The latest browser checks passed 11 deterministic driver/capture scenarios, 10 durable-forwarder scenarios, 10 relay scenarios, 9 egress scenarios and 5 CLI scenarios. CLI delivery used real loopback HTTP and disposable RPC signing. Egress checks used injected DNS and local TCP, not Docker network enforcement. The Windows host cannot spawn the nested Node test process, so the five CLI scenarios were exercised through separately launched execution-host commands. No external social post or financial transaction was sent by these tests. The relay was restarted with persisted frame history intact; the local chain was preserved.

Twelve PostgreSQL tests passed on version 17.11: 24 competing requests claimed 20 jobs without duplicates, expired workers lost acknowledgement rights, conflicting publications rolled back completion, and independent connection pools recovered stored state. Four scheduler tests recovered Cedar's actual nonce-0/nonce-1 receipts without another execution or block, rejected a stale nonce in the real operator, and published the receipts through the outbox to three local IPFS peers. Those tests sent zero new transactions and zero social posts.

The subsequent native database restart did not pass. WAL replay began, but PostgreSQL could not signal its checkpoint process (`Operation not permitted`) under the Windows execution host and shut down. Background-worker startup warnings had also occurred. The original data directory is preserved without resetting WAL or weakening durability. A Linux CI job now includes the same-database crash/restart drill, but no successful Linux run is claimed. The existing local chain and website services were not restarted by this drill.

Machine-readable results live in halo-protocol/test-results/ and are ignored by Git. The directory also contains local service state and private IPFS peer identities. Publish only deliberately selected public evidence files, never the entire directory.

## Graduated trading increment

Nine graduated-agent scenarios passed with 42 successful local executions. The real operator accepted typed proposal fixtures, recorded canonical observations, generated real EZKL proofs, bought and sold in the official v4 pool, and published receipts including both observation and execution gas. Manipulated markets, unsafe depth, cross-graduation snapshots, weakened output floors and stale observations were rejected. The existing economic, proof and settlement suites also passed after the change.

A separate preview is running on RPC 8547/API 8789 through http://localhost:5173/explore?preview=trading . It displays actual trade amounts and six completed actions for Graduation operator. This is a disposable scenario with controlled proposal fixtures, not hosted inference or a continuously executing agent. See ../HALO_GRADUATED_AGENT_TRADING.md for the architecture and exact verification scope.

The full graduated suite also passed on a local fork of Robinhood block 62043754, using the deployed, bytecode-verified Uniswap PoolManager: nine scenarios, 41 local executions, both real operator trade cycles and zero mainnet transactions. Desktop 1280x900 and mobile 390x844 browser checks verified the Activity amounts, payments, policy routing and graduated token page. A long mobile result wrapping mid-number was fixed with a compact display; the full value remains in Treasury. TypeScript and the final seven-route build passed.

## Remaining product work

1. Realized-profit recycling, stronger pre-graduation strategy-market controls and continuous oracle maintenance. Graduated discretionary trades now pass the real contract and operator suites; the public baseline still needs a portfolio model. Base/parent fee conversion and a subsequent fee-funded proof action now pass locally; sustained economics across actual WETH markets and hosted compute remain to be demonstrated.
2. Complete Hermes/vLLM model service, immutable public model/runtime releases, evaluated portfolio strategies and recovery artifacts. Typed portfolio proposals now execute; the larger strategy model remains to be deployed. Local model training remains the owner's work.
3. Linux PostgreSQL restart acceptance, chain projections, reorganization handling, complete accounting, queued transaction-broadcast recovery, website queue visibility and durable live/social publication. Leased jobs and the transactional receipt outbox are implemented and locally tested; the whole persistence requirement is not finished.
4. WalletConnect, remaining error/recovery flows, public thesis pages, signed social linkage, Linux execution of the X/FOMO browser worker and integration with the durable publication outbox. FOMO is confirmed as fomo.family; authenticated accounts and composer behavior are not yet verified.
5. Stronger evidence of actual model authorship. The present proof enforces the admitted action envelope; it does not prove that the larger model selected the action without human input.
6. Akash deployments on at least two independent providers, independently hosted IPFS copies, pinned Linux images and observed CI execution.
7. Twenty-agent capacity tests, seven-day public testnet soak, recovery drills, independent contract/proof review and mainnet configuration/handover.

The current three IPFS peers share one Windows machine and run offline. The website and services are local. No production hosting, paid social account, real-money trade or cloud lease has been provisioned.

See ../HALO_IMPLEMENTATION_SPEC.md for the consolidated architecture and ../HALO_PUBLIC_ACTIVITY_AND_SOCIAL.md for the new live/social scope and its verification boundaries.
