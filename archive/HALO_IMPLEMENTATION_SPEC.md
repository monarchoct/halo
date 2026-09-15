# HALO — Engineering implementation specification

Version 0.1 · 13 September 2026 · Engineering design and implementation baseline

This specification translates the founder's decisions into a buildable system. It supersedes tentative stack choices in the earlier briefs, but does not change the founder's requirements. An architecture proposal is not evidence of a working deployment. The accompanying website is the first implementation milestone; chain contracts, live agent operators, model training and fee collection have separate acceptance gates below.

## 1. Product contract

HALO lets anyone configure and activate an autonomous token-launching agent. Every agent has an identity, a model configuration, immutable operating rules, a treasury and an associated agent token. Agents can create and manage child tokens using supported existing launch protocols. People discover agents and inspect their records on HALO; ordinary trading happens on external venues.

The intended economic graph is HALO → agent token → child token. For example, HALO → FRED → DOG. Quote-asset support is a requirement of a protocol adapter, not something the frontend can impose. A DOG purchase paid with existing FRED does not automatically execute a fresh FRED purchase. A routed purchase can acquire FRED first, but purchases on outside venues may take a different route. Correlated market exposure is not equity ownership, guaranteed appreciation, or a claim on every downstream asset.

Confirmed constraints:

- Support Solana and Robinhood Chain; do not confuse Robinhood Chain with a Robinhood brokerage integration.
- Anyone can prepare an agent. Live activation requires supported contracts and sufficient initial capital, without a HALO approval queue.
- After activation, neither the creator nor HALO has a discretionary pause or a backdoor that changes active execution policy.
- No human approval is required for routine agent decisions within the activated policy.
- Models are replaceable modules before activation. Any later changes must follow the exact update rule committed at activation.
- Publish economic outcomes and action evidence. Never present illustrative agents or simulated returns as live results.
- Revenue can cover operating costs only after it is received, available for transfer and converted into the resource needed for payment.

The marketing proposition is autonomous memecoin deployment and transparent agent economies. Do not promise easy, guaranteed or predictable profits.

## 2. Decisions made now

| Area | Engineering decision | Why |
|---|---|---|
| First chain implementation | Solana development environment, one adapter first; Robinhood adapter second | Verify an end-to-end launch without multiplying failure modes. Both chains remain visible product targets. |
| First protocol research spike | Official Pump SDK and current public program interfaces | There is a concrete integration surface; arbitrary parent quote support still needs proof. |
| First user-facing delivery | Responsive web explorer, agent detail, guided creation, local draft persistence and JSON export | Makes the product concrete before wallet authority and economic contracts exist. |
| Web stack | TypeScript 5.9.3, React 19.2.6, Vinext 1.0.0-beta.5 / Vite 8.0.13 using Next 16.3.4-compatible routes; existing starter lockfile | This is the actual supported Sites preview/deployment stack. Beta framework risk is limited to the interface, which holds no agent keys. |
| Styling | CSS design tokens, Tailwind 4.2.1 where useful, bundled accessible UI primitives, Lucide icons | HALO lime/ink identity, soft gradients and selective glass portrait cards; PONS-inspired discovery controls. |
| Public application API | TypeScript, Fastify 5, Zod 3 schemas, REST with OpenAPI 3.1 | Easy typed contracts with the frontend and SDK. Separate from the preview site's rendering runtime. |
| Durable application data | PostgreSQL 17, Drizzle ORM 0.45.2, explicit SQL migrations | Queryable registry projection, tasks, accounting, receipts and transactional job claiming. |
| Reasoning worker | Python 3.12, Hermes pinned to a reviewed Git commit, Pydantic 2 | Replaceable reasoning implementation with HALO-controlled inputs and tool boundary. |
| Initial queue | PostgreSQL task table with SKIP LOCKED, leases and transactional outbox | Fewer moving parts than adding a broker immediately; correctness still requires chain-side replay protection. |
| Inference | Shared vLLM GPU services; an HTTP model adapter for alternative compatible endpoints | Many logical agents share capacity and route to model modules. |
| Training | Linux/WSL2 on RTX 5090, Unsloth, Qwen3.5-4B BF16 LoRA; separate Scout and Creator adapters | Narrow specialist training with explicit held-out evaluation. |
| Solana code | Rust + Anchor, official Pump SDK through a dedicated TypeScript adapter | PDA vault and receipt design can constrain supported CPI calls; public protocol keys must be verified. |
| EVM code | Solidity 0.8.30, Foundry, viem 2; no upgradeable proxy for an active agent vault | Immutable agent authority and comprehensible transaction construction. Compiler pin is a design target, not a completed audit. |
| Infrastructure | OCI images, Docker Compose for development; Akash deployments for independent operators | Portable workers and GPU capacity; external operator diversity must be demonstrated. |
| Durable blobs | Content-addressed model/config/receipt blobs, three independent IPFS pins; mirrored object storage for convenience | The content hash is the identity; one gateway or provider is not the authority. |
| Observability | OpenTelemetry traces + Prometheus metrics + structured JSON logs | Diagnose action, execution and payment failures without relying on model prose. |

Frontend versions above come from the installed Sites starter. They are pinned by its lockfile. Backend major lines are explicit implementation targets, not a claim that a full compatible environment has been installed. Before merging each backend service, commit its resolved package lock, `uv.lock`, Cargo lockfile and OCI image digest. Never ship `latest` image tags or an unpinned Hermes Git branch. There is no backend dependency lockfile yet.

## 3. System topology and ownership of truth

```text
Creator wallet -> Web deployment wizard -> Manifest + funding transaction
                                             |
                                     On-chain agent registry
                                             |
Chain events -> Indexer -> Postgres projection + public read API
                   |                         |
                   +-> Durable task queue -> Agent worker -> Model router
                                                  |
                                          Structured intent
                                                  |
                                      Deterministic policy check
                                                  |
                                  Chain executor / signing protocol
                                                  |
                              Agent vault -> Existing launchpad / DEX
                                                  |
                         Fee receipts + positions + on-chain action receipts
                                                  |
                        Treasury allocator -> gas + compute-credit payments
```

On-chain state is authoritative for agent identity, immutable manifest hash, treasury balances, execution nonces and actual transaction outcomes. PostgreSQL is a rebuildable index and work coordinator. IPFS content identifies immutable configuration and public evidence. Hermes SQLite is local worker memory, not the sole accounting database or execution authority. The website and a HALO-hosted API must not be prerequisites for an activated agent to continue.

The preview site's Cloudflare Worker runtime serves the web application. It must not run GPU inference, hold agent private keys, or act as the only live scheduler. The production operator services run as independent containers outside that rendering environment.

## 4. Repository structure

The first website is delivered as `halo-web/`. Evolve it into this workspace after the first UI milestone rather than pretending the unimplemented packages already exist:

```text
halo/
  apps/web/                  # React routes, public explorer, creation wizard
  apps/api/                  # read API and unsigned deployment preparation
  services/indexer/          # chain event ingestion, reorg reconciliation
  services/scheduler/        # event -> deduplicated tasks, leases
  services/executor/         # policy checks, simulation, chain submissions
  services/treasurer/        # claims, settlement, compute/gas funding
  services/agent-worker/     # Python Hermes wrapper; no wallet key
  services/model-router/     # inference gateway, task/model routing
  packages/schema/          # versioned JSON schemas + generated clients
  packages/chain-solana/     # protocol discovery/build/simulate/parse
  packages/chain-evm/        # viem chain + ABI adapters
  packages/accounting/      # fixed precision ledger and cost basis
  contracts/solana/          # Anchor registry/vault/action receipt programs
  contracts/evm/             # immutable registry and vault contracts
  models/scout/              # data recipe, LoRA config, eval reports
  models/creator/            # data recipe, LoRA config, eval reports
  infra/compose/             # local development topology
  infra/akash/               # deployment manifests + funding reconciler
  tests/scenarios/           # replay, failover, duplicate execution, insolvency
```

Use pnpm workspaces for TypeScript once backend services are introduced. Preserve the current website's npm lock until an explicit workspace migration regenerates and verifies dependencies. Do not keep two competing package-manager locks in one package.

## 5. Manifest and model interfaces

Creation produces a versioned deployment draft. Drafts are editable and contain no private keys. Activation resolves every placeholder, canonicalizes JSON using RFC 8785, and commits a SHA-256 digest in the registry (bytes32 in EVM). The full manifest is available through independent content-addressed mirrors.

Required activated manifest fields:

```ts
type ActivatedAgentManifest = {
  schemaVersion: "halo.agent.v1";
  identity: { name: string; ticker: string; description: string; imageCid: string };
  chain: { family: "solana" | "evm"; chainId: string; genesisHash?: string };
  economics: {
    agentMint: string; parentQuoteMint: string;
    protocolId: string; adapterDigest: string;
    feeRecipient: string; allocationPolicyHash: string;
  };
  runtime: {
    workerImageDigest: string; hermesCommit: string;
    scout: ModelReference; creator: ModelReference; planner: ModelReference;
    fallbackModelIds: string[]; maximumInferenceCostPerDay: string;
  };
  execution: {
    policyHash: string; policyVersion: string;
    permittedPrograms: string[]; permittedActionTypes: string[];
    maxSpendPerActionBaseUnits: string; maxDailySpendBaseUnits: string;
    maxSlippageBps: number; maxConcurrentPositions: number;
    maximumLaunchesPerDay: number; minimumGasReserveBaseUnits: string;
    authorityScheme: string; operatorSetCommitment: string;
    operatorReplacementPolicyHash: string; upgradeRule: "immutable";
  };
  treasury: {
    targetRunwayDays: number; initialReserveBaseUnits: string;
    settlementAsset: string; permittedComputeProviders: string[];
    conversionRoutePolicyHash: string; lowRunwayPolicyHash: string;
  };
};

type ModelReference =
  | { type: "lora"; baseModelRevision: string; adapterCid: string;
      tokenizerHash: string; servingImageDigest: string }
  | { type: "weights"; weightsCid: string; tokenizerHash: string;
      servingImageDigest: string }
  | { type: "endpoint"; url: string; modelId: string;
      operatorIdentity: string; credentialReference?: string };
```

This is an interface definition, not a valid activation payload. Live validation must reject unresolved hashes/addresses, cross-chain quote mismatches and an unsupported protocol. Remote endpoints cannot prove that their operator serves unchanged weights; display this trust property when the creator chooses that model type. Credentials are secret references and never included in a public manifest.

All model implementations expose the same typed task interface:

```ts
type ModelTask = {
  taskId: string; agentId: string; kind: "scout" | "create" | "plan";
  observationHash: string; observations: unknown;
  allowedActions: string[]; outputSchemaVersion: string;
  tokenBudget: number; deadline: string;
};
type ModelResult = {
  taskId: string; modelRevision: string; output: unknown;
  evidenceRefs: string[]; usage: { inputTokens: number; outputTokens: number };
};
```

Validate output before it reaches an executor. Retry once for schema errors within a fixed budget, then record a failed task. A configured fallback is selected only from the activated list. Model text never becomes raw executable transaction bytes, a shell command, or a new allowed destination.

## 6. Agent work loop

1. Index finalized/confirmed events according to each event's risk and chain finality policy. Record the observed block/slot and finality state, not just a timestamp.
2. Derive a deterministic task key from agent ID, trigger event ID and task kind. Enforce a database unique constraint.
3. A worker claims a task using a short database transaction with `FOR UPDATE SKIP LOCKED`. Increment its fencing epoch and set lease expiry. Heartbeat while working.
4. Collect bounded observations. Market feeds, social posts, token metadata and model output are untrusted inputs. Never let instructions embedded in them modify tool permissions.
5. Run Scout classification. Call Creator only for a selected launch candidate. Planner proposes an allowlisted action or a reason for taking no action.
6. Calculate budgets, exposure, prices, slippage, token decimals, tax effects and gas using deterministic code and fixed-precision integers/decimal arithmetic.
7. Build a structured intent with `agentId`, `manifestHash`, `actionId`, nonce, expiry, exact asset amounts, permitted venue and minimum received amount. The executor rebuilds transactions from it.
8. Simulate against current chain state. Recheck balances, policy caps, destination/program allowlist, allowance scope and price freshness immediately before submission.
9. Submit through the approved authority mechanism. Write submitted, observed, finalized or failed receipts separately. A timeout is an unknown outcome, not proof of failure.
10. Reconcile the chain before retrying. The same action uses the same receipt key/nonce, even after worker failover. Expired Solana blockhashes require a rebuild only after proving the previous transaction did not settle.
11. Publish transaction reference, model/observation hashes, action summary, actual costs and resulting ledger entries. The model's internal chain of thought is neither required nor a reliable audit record.

Postgres leases prevent many accidental races; they do not prevent a malicious old worker submitting a previously authorized action. The chain vault must enforce action IDs/nonces and applicable authority epoch. End-to-end exactly-once side effects cannot be obtained from a queue alone.

## 7. Chain execution and the no-pause requirement

### What can be enforced

An activated agent vault has no owner pause function, no creator withdrawal of the operating balance, no administrative delegate-call path, and no proxy administrator who can replace the implementation. Its policy commits spend limits, supported actions, accounting rules and operator replacement logic before funding/activation. A deterministic budget check rejecting one action is part of the activated rules; it is not a later human veto. An agent with no usable capital may stop spending and wait for funding under its original policy.

On Solana, use a PDA treasury owned by a HALO vault program and constrained CPI instructions. Registry/vault upgrade authority must be removed only after a tested, audited version and explicit release decision; an upgradeable program does not meet the final promise. On EVM, deploy immutable vault instances with a registry that cannot mutate the authority of existing instances. A future factory version may create new agents without changing old ones.

### What is not solved by a contract

An LLM runs off-chain. Arbitrary model-based decisions cannot be declared correct by a contract simply because someone supplies a hash. An ordinary worker key, a fixed multisig, a hosted model API, a shared RPC or a single provider can withhold service. Threshold signing improves key compromise tolerance but a required quorum can still refuse to sign. Akash provider choice alone does not solve this.

Chosen development path: use a restricted single-operator signer only in isolated development/testnet; then implement and test independently operated execution with chain-enforced replacement after inactivity. A candidate design uses 3-of-5 independently operated authorizers, time-bounded operator epochs and an on-chain replacement auction governed by the immutable manifest. This is a protocol research candidate, not production-ready or guaranteed unstoppable. It needs Sybil resistance, stake/slashing evidence definitions, distributed key generation or vault-native authorization, replacement correctness and incentive analysis. Slashing for an objectively invalid action is different from slashing a model for an unprofitable decision.

Do not launch unrestricted real-money autonomous agents while advertising the final no-pause property if that proof is missing. Website development, manifest tooling, adapters, replay testing and model training can proceed immediately. Production activation is gated on an authority design review and adversarial failover tests; this is an engineering prerequisite, not a per-action human approval flow.

## 8. Protocol adapter contract

Every integration implements:

```ts
interface LaunchAdapter {
  capabilities(chain: string): Promise<ProtocolCapabilities>;
  validatePair(base: string, quote: string): Promise<PairSupport>;
  quoteLaunch(input: LaunchInput): Promise<LaunchQuote>;
  buildLaunch(input: LaunchInput): Promise<UnsignedTransactionPlan>;
  simulate(plan: UnsignedTransactionPlan): Promise<SimulationReceipt>;
  parseReceipt(txId: string): Promise<LaunchReceipt>;
  listFeeClaims(agentId: string): Promise<ClaimableFee[]>;
  buildFeeClaim(claim: ClaimableFee): Promise<UnsignedTransactionPlan>;
  externalTradeUrl(mint: string): string | null;
}
```

Capabilities include network, verified contract/program addresses, supported quote assets, creator fee authority, claim rules, launch permission checks, graduation destination, admin upgrade powers and a checked-at timestamp. No launch button is enabled from a protocol name alone. A successful token creation is also insufficient: verify that the agent treasury actually receives the expected fees after trades and after graduation.

| Protocol | Initial state | Evidence required before activation |
|---|---|---|
| Pump.fun | Research adapter on Solana | Current program IDs/SDK lock, quote-mint support, fee recipient control, creation simulation and post-graduation claims |
| PONS | Product reference; chain adapter unapproved | Actual deployment on selected chain, quote approval, `canLaunch`, fee/admin controls and treasury claim tests |
| Long | Unresolved identity | Exact official URL, repositories/contracts, supported chains and integration terms |
| Stonk | Unresolved identity | Same identity and capability checks; do not guess from similarly named products |

Pump's published creation instruction requires a supported quote mint. PONS v2 has quote and launch controls. Neither fact proves that arbitrary FRED/HALO and DOG/FRED pools are supported permissionlessly. If no existing protocol meets the graph requirement, either secure permissionless quote support in a compatible deployment or explicitly revise the product requirement. Do not silently substitute SOL/USDC pairs and call them the requested economic graph.

For the first release, keep each agent, its parent pair and its children on one chain. Supporting two networks does not automatically create one canonical cross-chain HALO supply. Bridging, supply accounting, mint authority and canonical representation require a separate design and verified deployed addresses.

## 9. Treasury and self-funding

Maintain separate accounts for operating reserve, gas reserve, trading capital, receivable fees, realized profit, unrealized asset value and distributable revenue. A deposit is capital contributed, not profit. A fee shown as claimable is not spendable until claimed. A paper gain is not compute funding.

The treasurer cycle:

1. Read independently verified claimable fees and claim only if net proceeds exceed transaction costs under the manifest policy.
2. Reconcile confirmed fee receipts into the ledger.
3. Keep chain gas reserve at the committed target; use allowlisted routes with slippage and price-age limits.
4. Replenish the liquid operating reserve toward its target runway, proposed as 30 days for a new agent. Compute the target from measured trailing daily expense with a minimum bootstrapping estimate.
5. Fund a dedicated compute payment wallet/escrow through a bounded payment adapter. Akash resources require Akash-compatible funding; a Solana or EVM token balance is not directly a paid lease.
6. Reconcile payment IDs, credit minted/received, provider lease, rate and remaining balance. Never pay a claimed invoice supplied only by a model.
7. Allocate remaining revenue only according to the immutable policy. Fee shares and token-holder distributions are not selected by this specification.

Cross-chain funding needs a supported bridge/exchange path, quote expiry, refund handling and a reserve on both ends. Before that adapter exists, developer-funded compute is acceptable for a labelled testnet pilot. It is not self-funding production.

Use `runwayDays = liquidOperatingReserve / measuredDailyOperatingExpense`. Show “not available” when expense has not been measured. Separate leased idle GPU cost from per-request model charges. Share inference across agents with per-agent token metering and billing; do not provision a 5090-equivalent GPU per agent by default.

Illustration only: if eligible daily volume is V, the received operating fee fraction is r, and actual daily cost is C, fee-only break-even is V = C/r. At C=$5 and r=0.001 this is $5,000/day. These are explanatory inputs, not proposed fees, a cost quote or a revenue forecast. Launch profits may be negative and must not be needed to make the invoice ledger balance.

## 10. Training on the RTX 5090

Use the 5090 as an experimentation and fine-tuning machine; it need not remain online to keep other people's agents operating. The card has 32 GB VRAM. Prefer Linux or WSL2 with a tested NVIDIA driver/CUDA/PyTorch combination and the official Unsloth Blackwell workflow. Pin the final container digest after the first successful smoke test.

First experiment configuration, to tune from measured results:

```yaml
base_model: Qwen/Qwen3.5-4B
base_revision: RESOLVE_AND_PIN_BEFORE_RUN
method: bf16_lora
sequence_length: 2048
micro_batch_size: 1
gradient_accumulation_steps: 16
lora_rank: 16
lora_alpha: 32
learning_rate: 0.0001
epochs: 1
seed: 42
gradient_checkpointing: true
```

This is a starting recipe, not a hardware benchmark. Confirm compatible target modules against the actual Qwen/Unsloth implementation. Measure peak VRAM and throughput before increasing context/batch. Current Unsloth guidance recommends BF16 LoRA for this family over 4-bit QLoRA; do not assume the common 4-bit recipe is appropriate.

Train two independent adapters:

- **Scout:** extract entities, categorize narratives, identify duplicates and low-quality evidence, estimate calibrated task confidence, return structured JSON with evidence. Data includes chronological negatives and failed launches.
- **Creator:** generate names, descriptions and launch metadata that meet specified constraints; evaluate factual grounding, duplication, coherence and schema compliance.

Keep trading arithmetic, gas decisions, transaction signing and accounting out of the model. Keep a general planner baseline until specialist training wins on held-out end-to-end tasks. More fluent coin descriptions are not proof of better economic performance.

Data pipeline: append licensed/consented or otherwise usable observations → strip secrets → label tasks → deduplicate → split by time and narrative/entity clusters → supervised fine-tune → compare baseline and adapter → store evaluation report, dataset hash and adapter digest. Keep final evaluation data untouched. Report JSON validity, grounded extraction precision/recall, calibration, per-task latency, inference cost, tool-action validity and replay outcomes after fees/slippage. Include delisted/failed assets to reduce survivorship bias. Reject adapters that regress executor compatibility or evaluation performance.

Before serving, verify the exact model architecture and LoRA path against the selected vLLM release. If compatible per-request LoRA is unavailable, serve a merged model in a separate inference deployment behind the same model interface. Do not dynamically download arbitrary unreviewed adapters into a privileged shared worker.

## 11. Database and API contracts

Core relational tables:

| Table | Key columns and invariants |
|---|---|
| agents | chain + registry ID unique; manifest hash; immutable activation record; indexed current observed state |
| manifests | hash unique; schema version; content address; canonical bytes |
| protocol_capabilities | protocol + chain + revision unique; allowed quotes; verified addresses; checked_at |
| chain_events | chain + tx + event index unique; block/slot hash; finality; canonical flag |
| tasks | deterministic task key unique; status; lease owner/expiry; fencing epoch; retry count |
| intents | action ID unique; agent nonce; manifest hash; normalized action; expiry |
| transactions | chain + tx ID unique; intent ID; submitted/observed/finalized status |
| ledger_entries | immutable debit/credit lines; asset/decimals; event reference; reconciliation group |
| positions | agent + mint; quantity; cost basis; quote timestamp; realized/unrealized separate |
| model_runs | task ID; input/output hashes; model revision; usage; cost; latency |
| compute_payments | payment ID unique; lease/provider; settlement reference; credit and invoice reconciliation |
| public_receipts | content hash; agent/action ID; schema version; mirrored locations |

Use NUMERIC or integer base units for on-chain asset quantities; serialize large values as decimal strings. Never use JavaScript floating point for transaction amounts. Ledger corrections are reversing entries, not edits to history. Reorg handling marks noncanonical source events, reverses associated projections and rebuilds dependent balances.

Initial API:

```text
GET  /v1/agents?chain=&search=&sort=&cursor=
GET  /v1/agents/:id
GET  /v1/agents/:id/children
GET  /v1/agents/:id/activity?cursor=
GET  /v1/agents/:id/treasury
GET  /v1/protocols?chain=
POST /v1/deployments/validate
POST /v1/deployments/prepare       # returns unsigned plan, fees, capability revision
GET  /v1/deployments/:id/status
GET  /v1/models/catalog
GET  /v1/health
```

Pagination is stable/cursor-based; responses include data origin, indexed-through block and observation timestamp. Validation responses list structured field errors and unmet live activation capabilities. Wallet authentication, if introduced for server-side drafts, uses a domain-bound nonce challenge with expiry, chain and replay protection; mere wallet connection is not authentication. Preview drafts stay in the user's browser and export as files; no claim of cloud persistence is made.

## 12. Website implementation scope

Build the following routes now:

1. `/` — Hermes-inspired HALO introduction, original blue/white art, primary Deploy agent and Explore agents actions, concise explanation of the economic graph.
2. `/explore` — PONS-inspired search, chain/strategy filters, sorting, example agent cards, explicit preview-data designation and useful empty states.
3. `/agents/:id` — agent mandate, model/runtime, economic tree, child assets and public-record layout. Example records have no invented live addresses or returns. No trade button targets a fabricated contract.
4. `/deploy` — editable identity, network, strategy, model source and operating preferences; validation; review; local save and JSON export. Step progression and return editing work. Explain exactly why activation is unavailable until real integrations exist.
5. `/docs` — readable architecture, autonomy constraints, economics and current implementation status, with downloadable specifications.

Use a shared layout, agent-card component, explorer controls, economic-tree component, deployment schema, wallet-provider boundary and draft-storage module. All visible controls must work or communicate a specific unavailable capability. Do not render fake wallet addresses, balances, live P&L charts or a successful activation animation.

Wallet connection is optional for browsing and drafting. Offer an installed-wallet connection only via a user click. Never request a seed phrase. A real activation will show chain, verified contract/program, complete funding amounts, gas estimate, frozen manifest and authority rules before requesting the creator's activation transaction. Subsequent approved-policy agent actions are autonomous.

Visual rules, updated from the founder's latest screenshot: HALO's own lime #CCFF00, ink #15201B and neutral fog #F3F5F1 identity; Manrope sans-serif typography; soft gradients, rounded controls and selective frosted-glass overlays on portrait cards. Hermes remains a loose art-direction reference rather than a template. Discovery uses image-led cards and PONS-inspired filters. Avoid importing PONS economics or token metrics as HALO facts.

## 13. Security and operational implementation

- Model workers have no wallet secret, unrestricted shell, arbitrary outbound tool registration or write access to shared model weights.
- Validate all uploaded metadata, escape displayed strings, limit file size/type, and never execute uploaded code. Model weight uploads belong in a sandboxed verification pipeline, not directly in a shared inference process.
- Remote endpoint selection requires HTTPS, SSRF checks for every DNS resolution/redirect, egress restrictions and secret isolation. Block loopback, private networks, cloud metadata and embedded URL credentials on the server.
- Transaction builders allowlist programs, methods, assets and recipients. Approval amounts and deadlines are bounded. Re-simulate when quotes expire.
- Store only public observations/receipts on public storage. Encrypt operational credentials separately; do not publish private keys, customer secrets or raw sensitive datasets in the name of transparency.
- Independent RPC providers and receipt comparison reduce a single feed's influence. Publish stale-data state and do not calculate reputation from stale or unverified prices.
- All operators restore from independently accessible checkpoints. Test provider loss, not just a process restart in the same datacenter.

## 14. Acceptance tests and release sequence

### Milestone A — Website and machine-readable drafts (this delivery)

Acceptance: desktop/mobile render; working navigation, search, filters, sorting, agent detail, multi-step validation, draft save/reload and JSON export; clear data provenance; no false activation; no browser runtime error. Record source, build result, tested flows and known limits.

### Milestone B — Protocol feasibility and local vertical slice

Implement one adapter against verified deployment information; local database/scheduler; unsigned launch construction; simulation; chain receipt parsing; account balance reconciliation. Prove required quote support and fee recipient behavior. Reject unsupported quote assets. No money should be needed to establish basic schema and local correctness.

### Milestone C — Testnet autonomous loop

Launch, observe, claim where supported, reconcile fees and fund a mock/low-cost compute invoice through deterministic tasks. Test duplicate triggers, crash after submit, stale quotes, reorgs, decimal mistakes, invalid model output, injection in token metadata, zero balance and RPC failures. Label the development signer centralized.

### Milestone D — Model specialization

Measure baseline, train Scout and Creator on the 5090, compare held-out reports, register immutable adapters and test shared inference billing. Accept only demonstrated task improvements. No profit claim follows from training completion.

### Milestone E — Independent operation and audited authority

Implement accepted vault/authority design, recover across independent operators/providers, reconcile state without HALO's server, pay real compute from controlled test receipts and prove replay protection. Audit contracts and funding routes. Establish immutable activation rules and independent-client access before removing program upgrade authority.

### Milestone F — Live activation

Requires verified contracts/program IDs, approved release artifact digests, exact protocol capability matrix, selected fee policy, initial reserve requirements, working fee claims and compute settlement, canonical token/bridge decisions, operational runbooks, threat review and real failover evidence. The permissionless live creation path must not require an off-chain HALO administrator to approve each agent.

Do not assign calendar promises before the protocol quote-support and authority spikes are complete; those determine whether the original economics and autonomy requirements can be achieved with existing protocols.

## 15. Decisions still required, without blocking the website

1. Exact official Long and Stonk products/repositories.
2. A protocol that supports the requested parent quotes on each target chain.
3. Final HALO supply, agent-token issuance, fee allocation and liquidity policy.
4. Whether active agents must remain permanently pinned to model versions or may follow a predetermined autonomous update rule. Default here: immutable version with precommitted fallbacks.
5. Accepted authority/replacement protocol and what objective evidence can penalize an operator.
6. Canonical cross-chain HALO representation and audited funding bridge route.
7. Actual initial reserve and compute pricing from measured workloads and provider quotes.

## 16. Sources and related assets

External technical references were checked on 13 September 2026. They describe components, not proof of the composed HALO system.

- [Hermes architecture](https://hermes-agent.nousresearch.com/docs/developer-guide/architecture) — reasoning runtime and local session storage.
- [Hermes configuration](https://hermes-agent.nousresearch.com/docs/user-guide/configuration) — custom model/provider configuration.
- [Qwen3.5-4B model](https://huggingface.co/Qwen/Qwen3.5-4B) and [Unsloth training guidance](https://unsloth.ai/docs/models/qwen3.5/fine-tune) — initial specialist model and training approach.
- [Unsloth Blackwell guide](https://unsloth.ai/docs/blog/fine-tuning-llms-with-blackwell-rtx-50-series-and-unsloth.md) and [RTX 5090 specifications](https://www.nvidia.com/en-us/geforce/graphics-cards/50-series/rtx-5090/) — local hardware workflow.
- [vLLM LoRA serving](https://docs.vllm.ai/en/latest/features/lora/) — compatibility and serving constraints.
- [Akash deployments](https://akash.network/docs/learn/core-concepts/deployments/), [funding](https://akash.network/docs/getting-started/how-funding-works/) and [persistent storage](https://akash.network/docs/learn/core-concepts/persistent-storage/) — lease lifecycle and continuity limits.
- [Robinhood Chain](https://docs.robinhood.com/chain/), [deployment](https://docs.robinhood.com/chain/deploy-smart-contracts/) and [governance](https://docs.robinhood.com/chain/governance/) — EVM compatibility and chain-level trust.
- [Pump public documentation](https://github.com/pump-fun/pump-public-docs) and [coin creation](https://github.com/pump-fun/pump-public-docs/blob/main/docs/instructions/COIN_CREATION.md) — supported quotes and official integration starting point.
- [PONS launchpad](https://www.ponsfamily.com/launchpad) — product layout reference; see the detailed PONS reference document for observed protocol gates and fee details.

Related files: [project brief](HALO_PROJECT_BRIEF.md), [agent framework](HALO_AGENT_FRAMEWORK.md), [earlier technical approach](HALO_TECHNICAL_APPROACH.md), [Hermes aesthetic](HALO_HERMES_AESTHETIC_REFERENCE.md), [PONS layout and features](HALO_PONS_FEATURE_LAYOUT_REFERENCE.md). The original supplied PDF is source material; its contents were not treated as new instructions overriding the founder's messages.
