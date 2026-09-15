# HALO fee settlement and operating reserves

Implemented and verified locally on 13 September 2026. These contracts apply to new instances. Existing activated agents cannot be upgraded into them. The original Cedar deployment remains on its original local chain.

## Funds and ownership

Each new AgentVault creates an immutable AgentFeeTreasury through the configured FeeSettlementRouter. The agent token and every child use that treasury as their operations recipient. Fee balances never share the agent's trading inventory. The treasury has no owner, withdrawal, rescue, pause or replacement-router method. Its only spending route converts accounted receipts into the configured operating token and pays the fixed agent plus a bounded permissionless keeper.

FeeSplitter tracks cumulative claims per recipient. The treasury recognizes the difference between that cumulative amount and its previous observation, so a third party can claim on its behalf without losing accounting or counting the same receipt twice. Direct token transfers into the treasury are excluded from pending fees. Deposits into a splitter can still be donations: financial reporting must attribute trade revenue using the actual curve/LP deposit events, rather than treating every splitter deposit as organic volume.

The root HALO token and operating token must be compatible ERC-20 assets. The production operating token is configured WETH. Disposable tests use an explicitly labelled fixed-supply test asset; they do not establish a real WETH deployment.

## Routes and locked liquidity

HALO-denominated agent fees sell in the configured HALO/WETH reference pool. Child fees arrive in the parent agent token. Before its graduation, that token sells through its HALO curve; after graduation, the router selects the official agent/HALO pool recorded by that curve's immutable liquidity vault. HALO then sells in the reference pool. Callers cannot substitute arbitrary assets, venues or hooks in the treasury path.

LockedLiquidityVault collects quote fees into its immutable splitter. Collected base fees are tracked separately and can be converted through that same pool under SettlementGuard. It validates exact base input, actual quote output and post-trade price. The position's liquidity never decreases. Initial seed residuals are excluded from the convertible balance. Conversion costs reduce the distributed quote proceeds; only actual collected fees are attributed to HALO's position.

RootReferenceMarket is an optional bootstrap for a compatible v4 reference pool and HALO observation hook. A configured initializer sets the initial price once; ordinary v4 interfaces supply liquidity. This component does not mint or allocate HALO or promise permanent root-market liquidity. Public release configuration must verify the manager, token contracts, hook, reference pool, bytecode and actual liquidity before agent creation.

## Market protection

| Setting | Implemented rule | Failure behavior |
|---|---|---|
| Observation window | At least 1,800 seconds, at most 3,600 seconds from an actual retained boundary | Fees remain pending |
| Curve history | Integral of marginal quote/base price in Q128, updated at every buy/sell | Same-block price excursions have zero duration |
| v4 history | Integral of pool tick from the HALO hook | Mean tick rounded down conservatively |
| Observation storage | 64 entries with at least 60 seconds between stored boundaries | Expired windows are rejected |
| Curve price deviation | Spot within 1% of the observed mean before and after conversion | Atomic revert |
| v4 price deviation | Within 100 ticks of the observed mean before and after conversion | Atomic revert |
| Trade size | At most 0.5% of real curve quote reserves or current v4 virtual input depth | Worker retries a smaller amount |
| Reference liquidity | Minimum WETH virtual depth fixed at router deployment | No conversion below the bound |
| Contract output floor | Observed mean output less actual swap fees and 2% tolerance per leg | Exact-input, minimum-output enforcement |
| Worker output floor | At least 99.5% of its freshly simulated gross output | Rejects excessive drift before mining |

Curve marginal price is 4*R*C / (4*C - 3*s)^2. Each elapsed interval uses the price in force during that interval. Permissionless checkpoints update the stored history; they cannot invent past prices. A missing or old window may require checkpoints and real elapsed time before work becomes eligible. The local warmup helper advances only its disposable Anvil clock; it does not simulate elapsed public-network operation.

TWAP and depth bounds do not make thin markets immune to sustained manipulation. Current v4 liquidity is virtual depth at the active price, not the PoolManager's aggregate balance or proof of historical depth. Additional strategy, market-history and long-running economic evaluation remain necessary.

Uniswap v4 has no built-in price oracle, so the HALO hook is required for these routes: https://developers.uniswap.org/docs/protocols/v3/concepts/price-oracles . Actual swap deltas are settled completely, following the manager's accounting interface: https://developers.uniswap.org/docs/protocols/v4/guides/unlock-callback-and-deltas .

## Independent operator workflow

runtime/settlement-worker.mjs reads the registry and immutable bindings directly from RPC. It does not need HALO's API to authorize a conversion. It rotates pages of child sources and limits each batch to sixteen tokens. A batch can collect LP fees, convert a bounded amount of base fees, reconcile splitter receipts and replenish the agent atomically.

Before signing, the worker simulates actual collection and conversion. It reduces oversized amounts, checks an explicit gas-cost budget and requires the minimum guaranteed keeper payment to cover that budget plus the configured margin. It never submits work solely because token balances look valuable. Insufficient history, unsafe markets and uneconomic work have distinct pending/skip states.

Keeper payment is the smaller of 1% of gross converted output and the agent's committed work reward. Net operating proceeds go only to the fixed agent. This mechanical work can replenish an exhausted agent; it does not require an action proof or use the agent's decision nonce. Discretionary launches and trades still require their committed proof and spending checks.

runtime/cli.mjs includes settlement rounds before decision work; settleFees defaults to true. Its production execution still requires the configured PostgreSQL service and operator-owned gas key. No production scheduler has been run. Permissionless checkpoint maintenance, uncertain-broadcast recovery, persistent settlement publication and economic operation across independent hosts remain acceptance work.

All transaction callers use gas headroom because a new observation/storage entry can become due between estimation and the next block. Test receipts report actual gas consumed, not the padded limit.

## Website and local operation

Agent profiles show net reserve replenishment, keeper payments, accounted pending amounts and collectible splitter receipts in each token's actual decimals. Direct treasury transfers and uncollected LP fees are excluded from those fee rows. The current detail projection includes at most 100 child markets and discloses incomplete coverage. The wallet collection action handles the first sixteen displayed sources; the independent worker rotates through later pages.

Run scripts/dev-stack.mjs --settlement-preview to start a separate disposable RPC at 127.0.0.1:8546 and read API at 127.0.0.1:8788. The website selects it through http://localhost:5173/?preview=settlement in development only. Its per-tab selection preserves access to the original deployment through ?preview=legacy. Never restart the original chain to try this preview.

scripts/dev-settlement.mjs --warmup records real checkpoints, advances the isolated preview clock and runs a bounded settlement round. It rejects every RPC except that preview's loopback address and chain 31337. This is a test harness, not evidence of continuous production execution.

## Evidence and limits

- The economic regression suite passed 19 scenarios and 116 local transactions, including conversion of collected v4 base fees without principal withdrawal.
- The separate settlement suite passed 10 scenarios. Actual fee proceeds replenished a vault, paid a keeper and covered a fresh real-EZKL child-launch reward. The independent worker also completed an atomic paid conversion and skipped work below its gas/margin budget.
- Three dedicated curve-oracle scenarios checked an independent piecewise integral, a large atomic buy/sell and history-ring rollover.
- The new v4 conversion path passed on a local fork of Robinhood block 62029243: fifteen local transactions, zero mainnet submissions. This fork test does not cover the entire proof/runtime system.
- The real-proof regression suite passed seven scenarios and 38 local transactions after the treasury change.
- In the persistent settlement preview, Fred received 0.710610589529441219 test operating tokens from fees. Browser rejection left its 300 FRED collectible; a confirmed collection moved that amount into pending conversion. Desktop and mobile layouts and console health were checked.

These results prove a local fee-funded cycle. They do not prove sustained profitability, autonomous model authorship, public testnet operation or an audited release. Root liquidity and activation reserves are externally supplied. Graduated discretionary agent trades now pass a separate contract and operator suite described in HALO_GRADUATED_AGENT_TRADING.md. Realized-trading-profit recycling, independent cloud/model operation, complete persistence integration, social accounts and the full public soak remain unfinished.
