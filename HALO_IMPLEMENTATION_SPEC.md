# HALO consolidated implementation specification

Updated 13 September 2026. This supersedes earlier Solana-first implementation recommendations. It records the accepted product target, the current code boundaries and the remaining completion gates.

## Production clarification and current delivery

The founder's PC is optional; production targets 100 active agents and hundreds of users on independently hosted cloud resources. This supersedes the initial 20-agent capacity gate. Shared model serving and isolated persistent workspaces avoid a dedicated GPU per agent. See [production hosting, account setup and measured capacity](HALO_PRODUCTION_HOSTING.md).

The portable CPU operator/prover image and runtime Compose component are implemented and locally verified. A 100-proof benchmark is recorded separately from the still-required 100-agent cloud test. The public Operations API and website tab expose sanitized runtime outcomes. Headed desktop capture is implemented; general model-directed computer control and authenticated social workflows remain incomplete. No paid cloud lease, public testnet or mainnet deployment is claimed.

## 1. Product and network

HALO is a permissionless agent-token launch platform on Robinhood Chain, the Ethereum L2. All public protocol deployments, markets, wallet transactions and operating payments target that chain. Mainnet is 4663; testnet is 46630; local verification is 31337. Solana and cross-chain bridges are deferred.

The root HALO token's launch, allocation and initial market are outside this engineering scope. The root token address, compatible WETH address, reference market and operating capital are release inputs. A user must be able to connect a wallet, create and fund an agent, activate it, and see it launch and manage multiple child tokens autonomously. No approval is required for each permitted action after activation.

## 2. Launchpad and pairing decision

Meteora DBC supports permissionless SPL quote tokens and remains a future Solana option. PONS v2 requires quote-asset approval. The exact permissionless arbitrary-parent guarantees were not established for Pump.fun, Raydium LaunchLab, Long or Stonk. HALO therefore implements its own EVM curve; it does not depend on a script bypassing another protocol's allowlist.

FRED quotes in HALO. DOG and subsequent children quote in FRED. Spending existing FRED on DOG is not itself a new FRED purchase; upstream buying occurs only in routes that first acquire the parent assets. Outside markets cannot be forced to take those routes. Token ownership provides market exposure, not a guaranteed basket return or initial holder dividend.

References: https://docs.meteora.ag/core-products/dbc/token-2022-support ; https://docs.ponsfamily.com/v2 ; https://github.com/pump-fun/pump-public-docs/blob/main/docs/instructions/COIN_CREATION.md

## 3. Contract graph

AgentRegistry creates immutable AgentVault instances and records public identity/manifests. CurveFactory accepts root HALO and factory-created tokens as quotes. HaloToken creates the fixed supply. HaloCurve owns inventory and backing. FeeSplitter fixes recipients and allocates actual deposited fees. AgentFeeTreasury separates operations receipts from trading principal; FeeSettlementRouter uses fixed parent/HALO/operating-token routes. RootReferenceMarket optionally bootstraps the externally supplied reference pool and observation hook. V4GraduationAdapter, HaloPoolHook and LockedLiquidityVault create and permanently hold a full-range Uniswap v4 position. EzklDecisionVerifier binds the actual generated verifier to the vault's authoritative inputs.

Active instances have no owner pause, treasury rescue, upgradeable implementation or mutable execution allowlist. New versions require new instances. Before activation, only the creator may withdraw funds; after activation, supported execution paths and immutable limits govern the vault. An operator gas wallet does not own the agent treasury.

## 4. Curve and graduation

Supply is one billion 18-decimal tokens, with C = 800 million on the curve and L = 200 million for liquidity. There is no later mint, transfer tax, blacklist or freeze function. The creator fixes quote target R at creation. The original virtual-reserve formula is virtualBase = C squared / (C - L), virtualQuote = R * (virtualBase - C) / C.

The implemented exact rational form is reserves(s) = ceil(R*s/(4*C - 3*s)); its inverse is floor(4*C*r/(R + 3*r)). Use conservative integer arithmetic, exact-input trades, minimum outputs, deadlines and explicit fees. Final purchases pull only the used quote amount; unused input stays with the payer. Virtual reserves are never withdrawable. Fees remain separate from backing.

At sellout, attempt same-pair Uniswap v4 graduation inside a gas-bounded subcall. Retain protected reserves if migration fails and allow anyone to retry. The hook restricts initialization to the migration adapter, and the liquidity vault has no principal-withdrawal or position-transfer interface. Quote-side earned fees enter the splitter. Accounted base fees can convert through the same pool under immutable price/depth bounds; seed residuals and principal remain excluded. Malicious initialization, repeated migration, integer rounding and price continuity belong in the invariant tests.

Use the official Robinhood v4 deployment registry and verify bytecode before release: https://developers.uniswap.org/docs/protocols/v4/deployments . The latest local fork verified PoolManager 0x8366a39cc670b4001a1121b8f6a443a643e40951 and the new base-fee conversion at block 62029243; this is not a HALO mainnet deployment.

## 5. Fees and operating funds

Trading fees range from 25 to 200 basis points, default 100. Operations receive at least 50%; HALO receives 10-30%; the creator receives the remainder. Defaults are 60/20/20. Children inherit the committed policy. There are no initial token-holder distributions.

Only fees actually earned by HALO's curve or liquidity position count as trading revenue. Competing pools and third-party liquidity are outside that entitlement. Accounted parent/base receipts now convert through fixed routes with 30-minute observations, depth bounds and pre/post price checks. Direct treasury donations are excluded; splitter deposits still require payer attribution when reporting organic trading revenue. Unavailable or uneconomic routes leave fees pending. A local fee-funded proof-authorized launch and an independent settlement-worker transaction passed. Sustained profitability and production deployment remain unverified. HALO_FEE_SETTLEMENT.md specifies the implementation, parameters and limitations.

Require the configured 30-day work reserve and trading inventory before activation. Below the seven-day reserve threshold, new launches and purchases are blocked; sales/hold and replenishment remain possible under their rules. Work rewards, gas, compute cost, deposits, realized trading results and unrealized estimates must remain separate accounting categories. The worker refuses work whose committed reward cannot cover its estimated costs unless explicitly running the local-only subsidized test mode.

At the default 1% curve fee and 60% operations allocation, eligible curve volume contributes 0.6% before conversion costs. Break-even volume = operating cost / (trading fee * actual attributable share * operations allocation). Graduated economics use actual collected LP fees. The $1,500-5,000 monthly planning range is not a provider quote, engineering budget, audit budget or liquidity allocation.

## 6. Decision authorization

The current small public ONNX core is a fixed, untrained authorization graph. The real EZKL proof is integrated; the EVM adapter pins verifier bytecode and reconstructs 75 public instances from the commitment, ten Boolean policy facts, echoed commitment and authorization result. False facts, altered action bindings, corrupted proofs, wrong beneficiaries, wrong chains and replayed nonces cannot authorize valid spending in the tested implementation.

The action binds chain, agent, nonce, expiry, policy, core, market snapshot, evidence, amount, output limit and beneficiary. The vault independently checks actual funds and effects. Default limits are one launch per day, 10% maximum position, 10% daily trading debits and a 15-minute interval; bounded creator configuration is frozen at activation.

Current proof-authorized actions are child launch, purchase, sale and hold. New instances route trades to the curve until graduation, then to the immutable AgentTradeRouter and the child's official parent-quoted Uniswap v4 pool. Actual quote simulation, market-phase binding, TWAP/depth limits, exact input/output checks and proportional cost accounting passed real-proof and operator tests. Mechanical fee claims and operating-reserve conversion use fixed destinations; permissionless keepers receive at most 1% of converted proceeds, capped at the committed work reward. Realized-profit recycling remains. No arbitrary model-selected wallet transfer, unrestricted approval or generic contract call is allowed. See HALO_GRADUATED_AGENT_TRADING.md.

Recorded discretionary-trade quotes provide a minimum-output envelope and expire after 15 minutes; that snapshot alone is not a manipulation-resistant oracle. New curves separately integrate actual marginal prices for fee settlement. Graduated discretionary trades now also enforce the HALO hook's 30-minute tick history, depth and pre/post price bounds. Extending comparable controls to pre-graduation discretionary actions remains work. The public activity and stronger model-authorship requirements are specified separately in HALO_PUBLIC_ACTIVITY_AND_SOCIAL.md. The present proof does not prove that the larger LLM chose the action without human involvement.

## 7. Runtime and recoverability

The working worker reconstructs state from RPC and public artifacts, collects source snapshots, runs a typed proposal module, pins evidence, builds a canonical intent, proves, simulates, submits and verifies payment. Multiple children retain one parent identity. It can recover prior narratives from on-chain child evidence after losing its local files.

Manifests use canonical JSON and an on-chain Keccak commitment. New publications use real IPFS raw-block CIDs. Action evidence uses SHA-256 raw-block commitments, allowing the CID to be reconstructed directly from the event, including hold actions. Replication counts require distinct IPFS peer IDs, a reported pin and successful retrieval of matching bytes. This is an availability observation, not a perpetual guarantee or proof of independent corporate ownership.

Python proposal/proof processes receive only public files and an allowlisted environment. HTTP fetches enforce public address rules, bounded size, deadlines and pinned DNS answers. Committed public-model mode now runs Qwen3.5-4B Q8_0 on the local RTX 5090 through pinned llama.cpp; two real model-generated launches and a daily-limit hold passed the website-to-chain path. The model receives no tools or wallet. Prompt/schema/runtime commitments and public transcripts support inspection, not exclusive-authorship proof. Hosted Hermes/vLLM, independent model replicas and portfolio evaluation remain. See HALO_PUBLIC_MODEL_RUNTIME.md. The owner's local training is outside scope.

## 8. Website, API and public records

Retain the existing React/TypeScript/Tailwind/Vinext frontend. The founder's latest orange/violet palette, original inward-pointed ring, engraved portraits and selective glass treatment replace the earlier green direction; HALO_DESIGN_SYSTEM.md defines the visual system. Required routes are landing, explore, agent profile, creation, token detail, portfolio and transparency. Current local flows use actual contracts and data, not fake balances or confirmation timers. Trades stay on the curve interface until graduation; external trading destinations apply to supported public networks.

Creation separates draft, manifest publication, contract creation, inventory funding, reserve funding and irreversible activation. Resume from on-chain balances and activation state before asking for another transfer. Handle wallet rejection, wrong network, insufficient funds, stale quote, failed receipt and service unavailability. WalletConnect and remaining edge-case coverage are still required.

The read API uses Fastify/Zod and viem with direct chain reads. PostgreSQL 17/Drizzle now holds exact-nonce jobs, expiring fenced leases, attempt history and an ordered transactional outbox; runtime/cli.mjs uses the scheduler in execution mode and publishes receipt artifacts through the outbox. Canonical block/event projections, accounting, completed-job reorganization correction, queued broadcast recovery and website queue visibility remain. Twelve real-database scenarios and four local chain/IPFS recovery scenarios passed. The native Windows restart failure remains recorded. A separate actual Linux run passed all twelve queue scenarios and a forced restart of the same PostgreSQL 17.11 container/volume, preserving jobs and pending publications with durability settings enabled. Independent operators can use their own databases, schedulers and RPCs. The website/API cannot be execution authorities.

The Live tab streams signed operator progress and public browser frames, independently checking completion receipts, frame signatures and image hashes. Publish theses, source evidence, wallet/holdings, immutable configuration, cost accounting and execution receipts. The founder confirmed fomo.family and selected visual browser interaction for X/FOMO. The isolated worker, constrained egress proxy, publication reconciliation and durable signed-frame publisher are implemented with local boundary and transport tests. The actual Linux worker now opens FOMO with Chromium sandboxing enabled; three signed reports and two images reached Nova's website viewer. Eleven container checks and real publisher lock exclusion passed. X returned HTTP 403 and is reported unavailable. Startup errors now produce signed image-free failure reports. A subsequent real queued launch job now opens FOMO account setup through the Linux runner, delivers five signed reports and one public image, and remains pending without fabricating an account. The profile lock, lease renewal, interruption cleanup and standalone X-error delivery passed. Continuous native model workers now use the Linux PostgreSQL scheduler: a fresh Lyra/ARTEMIS launch triggered both actual social browser jobs, with five pipeline checks and seven signed reports. Eighteen persistence scenarios passed. Account signup, authenticated posting, portable model/prover hosting and independent deployment remain unfinished. The viewer distinguishes the local worker from earlier Codex development captures. Social availability must never control vault execution.

## 9. Hosting and completion gates

Use shared inference/proving capacity on Akash and portable CPU operators across at least two independent providers. Operators pay their hosting bills from WETH work payments. Publish pinned images and public recovery material on three independently operated IPFS copies. A lease can end; no single lease or HALO billing account may be an essential execution dependency.

The current local lifecycle, real proof, browser flows, IPFS storage, replacement operator, live timeline, bounded fee-funded work cycle and graduated agent trades are verified within their documented test scopes. Complete realized-profit recycling, continuous observation maintenance, stronger pre-graduation strategy-market and model-authorship evidence, portable model serving, complete durable accounting and recovery, authenticated social publication and independent public hosting next.

Then benchmark 20 active agents within 15-minute cycles and recover a replacement within 30 minutes. Run seven days on public testnet, with duplicate work, abandoned jobs, RPC failure, reserve exhaustion/replenishment, unavailable models/content and operator replacement. Commission independent economic, contract and proof review. Only after those gates and the supplied root HALO/reference market/operating funds are ready should mainnet release be considered complete.

Finished means a new user can activate through the site, the agent launches and manages children, earns and distributes actual fees, funds later independent work, graduates liquidity and exposes verifiable outcomes. A replacement operator can continue after HALO services and the original host disappear. The current implementation has not yet satisfied that whole definition.

Robinhood governance remains external: https://docs.robinhood.com/chain/governance/
