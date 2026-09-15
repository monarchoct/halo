# HALO graduated agent trading

Implementation record, 13 September 2026. Robinhood Chain is the target network. Verification described here used disposable local Anvil with real Uniswap v4 and EZKL contracts, test assets and controlled model-proposal fixtures. No public-chain transaction or hosted model deployment is claimed.

## Lifecycle and authority

New AgentVault instances can buy and sell their own children both before and after graduation. The existing BuyChild and SellChild action types retain their nonce, interval, proof, beneficiary, position, daily-debit and operating-reserve checks. Graduation does not give an operator or creator additional authority.

FeeSettlementRouter creates an immutable AgentTradeRouter at deployment. The agent commits both addresses in its policy hash. The trade router resolves the child's official curve and locked liquidity vault from CurveFactory, checks the configured PoolManager and verifies the exact child/parent currencies. Models cannot select pools, hooks, spenders, recipients or arbitrary calls. Old activated instances remain unchanged and do not gain this capability.

Before graduation, the vault continues to use HaloCurve's exact-input buy/sell methods. After graduation, the vault approves only the input amount to AgentTradeRouter, receives the output itself and clears the approval. It checks both input and output balance changes. Purchases update daily debits and position cost; sales remove proportional cost and update realized profit/loss and accounted capital. The liquidity vault's permanently held principal is never removed by these trades.

## Quotes, proofs and market checks

`snapshotTrade(child, kind, amount)` records a quote, nonce, block, timestamp and market phase. A snapshot from the curve cannot authorize a graduated trade. Observations must be from an earlier block, last at most 900 seconds and bind the exact asset, direction and amount. The action's minimum output cannot be weaker than the creator's committed slippage limit.

For graduated pools, `AgentTradeRouter.quote` executes the actual v4 swap inside a reverting subcall. A narrowly decoded QuoteOutput error returns the exact quote. All pool writes, oracle updates, fee growth, token transfers and swap logs from the simulated swap revert. Other errors propagate. A mined quote transaction therefore also leaves the pool unchanged.

The graduated route shares the fixed SettlementGuard bounds:

- At least 1,800 seconds of observed history; the selected observation window must not exceed 3,600 seconds.
- Pre-swap and post-swap ticks within 100 ticks of the time-weighted mean.
- Input at most 0.5% of the current active liquidity's virtual input depth.
- Output bounded by the observed price, actual direction-specific swap fees and the fixed 2% guard tolerance; the action's own output minimum also applies.
- Exact full-input settlement, expected PoolManager callbacks and no caller-selected output destination.

The proof's tenth public fact checks funds, snapshot and live market admissibility for a graduated trade. It is not a proof that an arbitrarily high minimum can be filled. The real swap independently enforces the actual minimum and atomically reverts the whole action if it cannot be filled. The unchanged EZKL graph proves the Boolean authorization envelope, not large-model reasoning or profitable prediction.

Curve snapshots remain slippage observations; stronger pre-graduation discretionary market controls are unfinished. Time-weighted price bounds do not establish immunity to sustained manipulation of thin markets.

## Model and operator integration

The strict custom proposal interface now accepts `launch`, `hold`, `buy` and `sell`. A trade contains an owned child address, positive integer input amount, rationale and retrievable public source IDs. It cannot contain a recipient, route, minimum output or launch metadata. Buy input units are the parent token's raw units; sell input units are the child's raw units.

Custom providers receive the observed portfolio, balances, cost basis, market phase, immutable limits and daily debit. Public-source reuse is allowed for management of existing positions; launch proposals still cannot reuse an already-launched narrative source. The original public narrative baseline retains its launch/hold behavior; a deployed portfolio model and evaluation are still required.

The operator validates ownership, available balance, reserves and allocation limits before paying for an observation. It recovers a recent matching observation when possible; otherwise it simulates and budgets a new observation transaction, waits for at least two confirmations, then generates the real proof and simulates execution. Output floors come from the contract. Both observation gas and execution gas are counted against the work economics.

A dry run without an existing observation returns `observation-required` and sends no transaction. It cannot claim to have proved an executable action against nonexistent persistent state. A prepared observation does not guarantee the eventual action: market changes, competition or a failed proof can leave its gas cost unreimbursed. Full uncertain-broadcast recovery remains part of the persistence work.

Accepted receipts must come from the agent, match the commitment, action, nonce, evidence and beneficiary, and remain in the canonical block. Public evidence includes the portfolio observation, quote transaction, proposal and source snapshots. Public receipt records include input, output and both gas costs.

## Website and local preview

Start the separate, disposable preview after compiling:

```sh
node test/graduated-agent.mjs --no-compile --preview
```

This runs the real acceptance scenario, then preserves its chain on RPC 8547 and exposes its public API on 8789. Open `http://localhost:5173/explore?preview=trading`. It does not restart the original preview on 8545 or the fee-settlement preview on 8546.

The profile displays real input/output amounts and operator payments in Activity. Policy & proof identifies whether the particular immutable agent supports the official graduated pool. The token page shows its parent pair, completed graduation and locked liquidity. Local results are explicitly identified as test results. The scenario contains six completed agent actions, including buys and sells after graduation. The provider is a controlled test fixture, not a continuously running LLM.

## Evidence

`halo-protocol/test-results/graduated-agent.json` records nine passing scenarios and 42 successful local executions, including two complete real operator cycles. Checks cover market transition, insufficient history, quote rollback, callback/market rejection, impact limits, action tampering, actual output enforcement, manipulation invalidating a proof, exact accounting, locked LP principal, expired observations, zero-write dry runs and duplicate-cycle rejection.

The original economic suite also passed 19 scenarios and 116 local transactions, the existing real-proof suite passed seven scenarios and 38 transactions, and the fee-settlement suite passed ten scenarios and 45 executions after this change. Provider responses in the new operator test use a controlled transport fixture, research uses loopback HTTP, and content-addressed artifacts are held in memory. Independent model hosting, social accounts, public deployment, sustained economics and independent IPFS hosting remain separate acceptance requirements.

The full nine-scenario suite also passed on a read-only Robinhood Chain fork at block 62043754, with 41 successful local executions and zero mainnet transactions. It used the deployed PoolManager at 0x8366a39cc670b4001a1121b8f6a443a643e40951 and verified its bytecode hash before execution. This includes both actual operator trade cycles and real proofs, while retaining the disclosed proposal and storage fixtures. Evidence is in halo-protocol/test-results/graduated-agent-fork.json. Run `node test/graduated-agent.mjs --no-compile --robinhood-fork` to repeat against a fresh verified fork.
