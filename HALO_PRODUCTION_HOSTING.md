# HALO — Production hosting and capacity

Updated 13 September 2026. The required product is a cloud platform serving hundreds of users. The initial acceptance target is **100 active agents**, not 100 always-running virtual PCs. The founder's RTX 5090 is optional for training and testing. Production must continue while that computer is switched off.

**Current state (14 September update):** Akash account exists and the approved one-hour ZenCloud connectivity test was launched. Its container-local health check passed. No hosted HALO agent or public production deployment exists. Registry ownership and a reachable Linux release builder remain outstanding. The portable operator/prover image and headed desktop image build and run in the local Linux VM. That VM is development infrastructure on the same PC and is not independent hosting.

## Production topology

| Layer | Initial deployment target | Isolation and recovery |
|---|---|---|
| Website | Existing Sites deployment, public domain and HTTPS | Static assets and application shell independent of operator machines. Public service URLs replace every localhost dependency. |
| Public services | Two API/relay replicas behind an HTTPS gateway | Read APIs carry no signing keys; Operations uses a restricted database role. Viewer traffic must not consume inference capacity. |
| Agent execution | Two Linux hosts operated independently, starting at 8 vCPU / 32 GB RAM each | Two bounded operator processes per host, each with its own gas key and state. Leased work avoids duplicate jobs; vault nonces prevent repeated accepted actions. |
| Desktop workspaces | On those Linux hosts; initially two simultaneous desktop jobs per host | A persistent private profile per chain/registry/agent/platform; isolated containers wake for work and stop afterward. Display exists only inside that workspace. |
| Shared inference | Two GPU deployments on different Akash providers, initially 24 GB VRAM each | Pinned baseline weights and serving release; bounded context and request concurrency. Select providers and limits from measured bids and inference tests. |
| Database | PostgreSQL 17 with TLS, backups and a tested restore destination outside the primary provider | Each independent operator group can have its own scheduler database. Public state can be rebuilt; private social sessions need separate encrypted recovery. |
| Public artifacts | Three independent IPFS replicas with retrievable content | Model releases, manifests, evidence and recoverable public agent state remain content-addressed. |
| Private recovery | Encrypted external object storage, separate from public artifacts | Browser profiles and credentials never enter IPFS or public screen storage. Recovery needs an explicit key-custody implementation. |

The CPU/runtime Compose component is `halo-protocol/deploy/runtime/compose.yaml`. The desktop supervisor currently requires a real Linux Docker host. Do not mount a host Docker socket into a browser or assume an ordinary Akash application container supplies that host API. Akash's GPU deployment interface supports container-based inference; its persistent volumes remain provider-local and do not survive every lease termination or provider migration. [GPU deployment documentation](https://akash.network/docs/learn/core-concepts/gpu-deployments/), [storage guarantees](https://akash.network/docs/learn/core-concepts/persistent-storage/).

Two rented machines controlled through one HALO account are separate infrastructure, not independent operators. The acceptance drill must include a second operator with its own credentials, funding and recovery material. Neither an operator signature nor a screen recording proves exclusive AI control. Current browser actions use bounded drivers; unrestricted model-directed computer interaction has not been completed.

## How an agent pays for its computer

1. Creation funds the immutable work budget and trading capital. No revenue is assumed before activity exists.
2. Eligible curve fees and actual fees collected from HALO's liquidity position enter the configured treasury split.
3. Bounded settlement converts eligible operating revenue into the WETH reserve. Unconvertible fees stay pending.
4. An operator runs a due job, supplies the proof and pays transaction gas from its own wallet.
5. The vault pays the committed work reward for accepted work. The operator uses its business funds to pay hosting, inference and storage providers.
6. Monitoring compares real costs and reserve runway. Low reserves invoke the committed reduced-activity policy; replenishment permits work to resume.

This mechanism does not require every agent to hold an Akash wallet or card. The current local system has demonstrated one fee-to-reserve-to-work-payment cycle. Cloud billing reconciliation, ongoing profit recycling and sustained economic viability still need implementation and measurement. Akash lease escrow and operator working capital must stay funded; a token price or market capitalization does not pay a hosting invoice.

Accounting now distinguishes execution gas, the exact market-observation gas, and fees paid by the rewarded operator versus another submitter. Eight boundary scenarios and six existing local actions were checked. A transaction batch that cannot be allocated reliably remains unresolved instead of becoming a false zero. Failed attempts, cloud invoices and model costs remain separate from the accepted action's two transaction receipts.

## Capacity target and first measurement

At a 15-minute interval, 100 active agents require **400 cycles/hour**, or **9,600/day** before reduced-activity policies. Spread activation and due times across the interval. Queue age and completion latency, rather than registered user count alone, determine additional worker capacity.

The first portable-runtime benchmark generated and verified **100 fresh decision proofs in 117.86 seconds**, at concurrency 2, under a Docker limit of **2 CPUs / 3 GB RAM**. Median completion was **2.366 seconds**, p95 **2.422 seconds**, and throughput **50.91 proofs/minute**. It ran without network access on a local four-vCPU VM backed by the Ryzen 9950X3D. Both authorized and rejected core outputs were checked. The 3 GB value is a configured limit, not measured peak usage. Evidence: `halo-protocol/test-results/runtime-proof-capacity.json`.

This proves CPU/prover portability and measures that component on this host. It does **not** establish hosted GPU throughput, on-chain gas costs, 100 complete agents, simultaneous desktop capacity or uptime. Required next measurements:

- 100 agent cycles per interval with public-model inference, chain simulation/execution, replicated evidence and operating settlement.
- Deliberate loss of one inference provider, one worker host, the primary database and HALO's API, with recovery within 30 minutes.
- 100 simultaneous website sessions, profile/API requests and desktop viewers; measure p95 latency, queue delays, CPU, memory and egress.
- Seven days of public-testnet operation, including no-revenue agents and exhausted/replenished budgets.
- Model output quality and strategy evaluation; throughput alone says nothing about profitability.

## Provider shortlist and cost approval

Use **Hetzner Cloud** as the first CPU-host candidate and **DigitalOcean** as a separate second-provider candidate, with GPU inference on two independently selected Akash providers. This is a deployment recommendation, not an account purchase. Hetzner exposes Linux VMs, dedicated-resource choices, firewalls and snapshots; the exact server and region remain subject to availability. [Hetzner server capabilities](https://docs.hetzner.com/cloud/servers/overview/), [current plans](https://www.hetzner.com/cloud/).

DigitalOcean currently lists a regular General Purpose instance with **8 dedicated vCPU, 32 GiB RAM and 100 GiB SSD at $252/month**. This is a listed base price, excluding added backups, storage, taxes and other services; verify the chosen region and checkout before spending. [DigitalOcean pricing](https://www.digitalocean.com/pricing/droplets).

| Category | Monthly planning envelope | Approval evidence still required |
|---|---:|---|
| Two CPU/workspace hosts | $300–600 | Selected plans, regions, disks, backup options and taxes |
| Two shared GPU inference leases | $750–2,200 | Actual provider bids and 30-day cost; GPU/model compatibility test |
| PostgreSQL, backups and storage replicas | $150–500 | Instance sizes, storage retention, independent restore quote |
| RPC, gateway, monitoring and egress | $150–700 | Traffic assumptions and provider limits |
| Capacity/recovery reserve | $150–1,000 | Remaining approved budget after measured usage |

These engineering allocations total **$1,500–5,000/month**. They are not a verified combined quote or a promise of capacity. Audits, development, root-token liquidity and trading capital are separate. If measured costs exceed the approved budget, adjust concurrency/capacity or seek a revised budget before increasing spend.

## Account setup and deployment order

1. Create owner-controlled accounts in Hetzner Console and DigitalOcean, enable MFA, and complete their identity/billing steps. Use a project dedicated to HALO. The owner controls billing and recovery; credentials do not go into chat, Git or public manifests. [Hetzner Console](https://console.hetzner.com/), [DigitalOcean Console](https://cloud.digitalocean.com/).
2. Set up Akash Console or an owner-controlled deployment wallet and select two different providers. Obtain actual bids before funding leases. Follow the current wallet/Console onboarding; do not send seed phrases to an agent. [Akash setup](https://akash.network/docs/getting-started/).
3. Choose the HALO public domain and create restricted deployment access. Configure DNS/TLS only after service addresses exist.
4. Publish reviewed immutable runtime, desktop and inference images. Validate release hashes and absence of private material. The runtime Dockerfile is built; its registry publication and cloud inference image are not complete.
5. Provision PostgreSQL 17 and TLS, run migrations, install the separate Operations reader, and verify external backup restoration. [PostgreSQL cluster setup](https://docs.digitalocean.com/products/databases/postgresql/how-to/create/).
6. Deploy a public-testnet release with supplied compatible token/market inputs, independent RPC access and operator gas funding. Bind real deployment addresses to workers and the website.
7. Run a small cloud acceptance slice, then the 100-agent tests and failure drills. Keep the PC off for the independence test.
8. Complete independent security review, measured cost approval, mainnet deployment and operational handover. Public-chain operation and production launch remain separate gates.

Account setup and provider funding are external dependencies. Engineering, packaging, tests and documentation continue while those are arranged. No paid infrastructure has been purchased as part of this checkpoint.

