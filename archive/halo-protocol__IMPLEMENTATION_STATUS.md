# Implementation evidence

This file records verified implementation state. A planned component is not a completed component.

## Accepted additions

- Robinhood Chain first; one externally supplied HALO token.
- A HALO-owned curve with child/parent pairing and Uniswap v4 graduation.
- Agents are persistent multi-token deployers, with replaceable narrative discovery and token creation modules.
- Immutable activated policy; no discretionary creator or HALO pause.
- Public small decision core with cryptographic inference proofs; modular larger models remain advisory.

## Verified on 13 September 2026

- Solidity 0.8.30 compilation succeeds with EIP-170 size checks for every HALO artifact.
- The BigInt reference model passed 12,000 seeded mixed buy/sell steps at four target scales and three fee rates.
- `node test/run.mjs` passed 18 scenarios and 101 local Anvil transactions. Coverage includes custom parent quotes, exact final reserves, partial fills, immutable fees, fixed supply, migration retry, agent activation funding, per-position/daily limits, repeated agent-owned child launches, executor payments, actual Uniswap v4 graduation and fee collection.
- The activated-agent scenarios use an explicitly named **test verifier** to isolate vault behavior. Those results do not establish cryptographic authorization.
- `node test/fork.mjs` passed 14 local transactions against a Robinhood Chain fork at block **61876868**, using the deployed PoolManager at `0x8366a39cc670b4001a1121b8f6a443a643e40951`. Its observed code hash was `0xbd3881180b547f5fe817545743cfb4343e96b1bc6640dcd70c106b0066e95626`. Zero mainnet transactions were submitted.
- The generated public ONNX core produced a real EZKL 23.0.5 proof. Native proving took approximately **0.38 seconds for the fixture**. This is not a production throughput guarantee.
- `node test/proof.mjs` compiled the generated verifier with Solidity 0.8.30, deployed it to local Anvil, accepted the actual proof, and rejected altered commitment bytes, altered authorization output and corrupted proof bytes. Measured verification was **770,495 gas**, with **7,332 bytes** of calldata.
- The SRS SHA-256 matches EZKL v23.0.5's published `kzg12.srs` hash. Model and SRS hashes are recorded with the proof benchmark.
- A Linux CI workflow is configured. A hosted CI execution has not yet been observed.

Machine-readable evidence is written to `test-results/contracts.json`, `test-results/robinhood-fork.json` and `test-results/real-proof.json`. These generated files are ignored by Git; CI uploads them as test artifacts.

## Important open integrations

- Bind the real verifier to the vault and reconstruct the exact Boolean model features from authoritative state. The fixture proves a real small computation but does not yet authorize actual agent actions.
- Replace live-balance decision snapshots with finalized, recoverable snapshot semantics; the present exact live-state binding can be invalidated by unsolicited balance changes.
- Add graduated-pool agent trading and bounded conversion of base/parent fees into quote assets and WETH. Base-side LP fees currently remain explicitly recorded and unconverted.
- Implement the research/narrative runtime, persistent source evidence and model routing. Multiple narratives are represented in contract tests; autonomous narrative generation has not run yet.
- Implement accounting/API, independent-host recovery, paid operators and full website integration. The existing frontend is still a partial scaffold.
- Regenerate user-facing documentation/PDF after the connected implementation is verified.

There is no production deployment, public testnet soak, independent audit or demonstrated multi-host operation yet.

## Remaining acceptance gates

1. Broaden economic/adversarial coverage for the complete deployed configuration.
2. Replace the binding-only verifier fixture with the actual verified core in agent lifecycle tests.
3. Complete authoritative feature construction, model-proof/vault binding and proof abuse tests.
4. Canonical market inputs, inference, operator payments and recovery.
5. Rebuildable accounting/API and fully connected website.
6. Public testnet, seven-day soak, 20-agent benchmark and external review.
7. Mainnet configuration, deployment and documented operational handover.
