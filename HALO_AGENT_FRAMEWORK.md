# HALO agent framework

Updated 13 September 2026. Runtime target: Robinhood Chain, the Ethereum L2. The owner's RTX 5090 training work remains outside implementation scope.

## Execution cycle

1. Read the chain, agent identity, nonce, policy, treasury and confirmed creation record.
2. Recover the manifest and every prior child narrative from content-addressed public artifacts.
3. Retrieve bounded public source data and pin the complete source snapshots on three distinct peers.
4. Run the public Python/Pydantic rules baseline, a committed public Qwen model release, or a strict custom proposal endpoint.
5. Validate sources, identity and funding/allocation limits. For a trade, recover or confirm a contract quote observation before publishing the complete proposal evidence.
6. Ask the vault for the exact action commitment and authoritative policy facts. Generate a fresh EZKL proof using the pinned public proving release.
7. Recheck the observed block, simulate execution, estimate gas and enforce the operator's economics.
8. Submit from the operator's own gas wallet. Verify the receipt, reward beneficiary and nonce; publish the outcome.

The contract interval defaults to 15 minutes. Local scripts support on-demand cycles and Nova's continuous model watcher. A PostgreSQL leased-job scheduler and receipt outbox are implemented, with Linux same-volume crash/restart acceptance now passed; independently deployed continuous workers and complete publication integration remain required. The contract enforces interval and replay rules even when operators compete.

## Narrative modules

The working baseline selects unused public sources, scores topic overlap with the agent description and generates a clearly fictional community concept. It is deterministic engineering logic, not a trained model or demand forecast. Default research sources currently include NASA's public article feed and the Hermes project's public GitHub release feed. These are initial source adapters, not a finished memecoin strategy.

Source IDs are derived from public URLs. Prior source IDs are recovered from every child token's on-chain evidence commitment, so a replacement operator does not need the original operator's private memory. Missing or unverifiable history stops that worker from launching another narrative rather than silently forgetting earlier launches.

The custom API receives public interests, evidence, prior source IDs, launch eligibility and observed portfolio balances, cost basis, market phases and limits. It returns halo.proposal.v1 for launch, hold, buy or sell. Trades require an owned child and positive integer input amount; models cannot choose destinations, routes or minimum outputs. The operator records or recovers the contract observation, proves the action and accounts for both observation and execution gas. A malformed response or unavailable endpoint does not silently select another model. The original public narrative baseline still only launches or holds; a deployed portfolio model and evaluations remain. See HALO_GRADUATED_AGENT_TRADING.md.

## Proof and spending boundary

The public small core has 42 inputs: 32 action-commitment bytes and 10 Boolean policy facts. It echoes the commitment and authorizes only when every fact is true. The EVM adapter pins the generated verifier's runtime code hash and constructs its public inputs itself. A valid proof of a denied decision cannot authorize spending.

The action commitment binds chain, vault, immutable policy/core, full action, nonce, expiry, evidence, operator beneficiary and accounted treasury state. Live balances are checked as inequalities so unsolicited donations do not invalidate otherwise valid work. Trades use an immutable quote snapshot at least one block old, a 15-minute expiry and the committed slippage floor. Graduated trades also use 30-minute pool observations, depth and pre/post price checks. Pre-graduation discretionary snapshots alone remain insufficient as a manipulation-resistant oracle.

This proves admissibility under the current graph. It does not prove exclusive model authorship. A stronger model-output-to-action proof or measured-runtime attestation is needed for the new requirement that outsiders cannot directly choose the agent's decisions. See HALO_PUBLIC_ACTIVITY_AND_SOCIAL.md.

## Models, training and hosting

The selected hosted stack is Hermes with configurable providers, vLLM and Qwen3.5-4B. Actual native Windows inference now uses pinned Qwen3.5-4B Q8_0 and llama.cpp b10809 on the RTX 5090. A website-created agent launched two children through different local operators, then held at its daily limit. The model, prompt, schema and adapter are committed; transcripts and source bundles are public IPFS artifacts. HALO_PUBLIC_MODEL_RUNTIME.md records exact versions, timings and the remaining hosted/reproducibility boundaries.

Provide a model import/evaluation interface before accepting trained replacements. Export small decision models to ONNX, fix preprocessing and supported operators, quantize deliberately and evaluate on held-out temporal data. Package LoRA adapters with exact base-model and tokenizer hashes. Report execution cost, calibration, failures and out-of-sample results; a successful training run is not proof of profitability. The Qwen baseline now uses the owner's GPU for inference; no local training was performed.

Akash is selected for portable shared GPU inference and independent CPU operators. Each operator pays its own hosting bills from earned work payments. At least two independent providers and three independently hosted IPFS copies are required for the production design. The three current Kubo peers are distinct processes on one local machine and do not satisfy that deployment requirement.

Hermes provider documentation: https://hermes-agent.nousresearch.com/docs/user-guide/configuration

EZKL: https://docs.ezkl.xyz/

Akash deployments: https://akash.network/docs/learn/core-concepts/deployments/
