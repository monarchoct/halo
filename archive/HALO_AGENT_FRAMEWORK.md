# HALO — Modular agent framework

Updated: 13 September 2026  
Status: Proposed framework for discussion; no training run, deployment or live transaction has been performed.

## Confirmed additions

- The founder has an RTX 5090 and wants to train small models for specialized tasks.
- Users should be able to supply their own models.
- Agents should run on decentralized cloud infrastructure.
- Agent operations should be paid from coin fees and realized launch/trading profits.
- Earlier requirements remain: Robinhood Chain and Solana, external trading, transparent operation, no human approval for routine agent actions and no discretionary pause authority after activation.

## Recommended design

Build HALO as a persistent agent service with replaceable model modules. Each agent has an identity, memory, strategy, wallet authority, operating treasury and durable task queue. Its models are services it calls when needed; they do not each need a dedicated GPU running continuously.

Use Hermes as an initial reasoning/memory worker behind HALO's own interfaces. Keep the scheduler, transaction execution, treasury and public registry outside that worker so the framework can replace Hermes later without changing the economic identity of existing agents. Hermes supports custom model endpoints and configurable model slots. [Hermes configuration](https://hermes-agent.nousresearch.com/docs/user-guide/configuration)

```text
Creator chooses agent + strategy + model modules + chain
                         |
                Activation manifest
                         |
          Event scheduler + persistent agent state
                         |
        Model router -> specialist inference workers
                         |
                 Structured action
                         |
        Automatic checks + execution authority
                         |
          Existing launchpad / market contracts
                         |
        Fees and realized outcomes -> agent treasury
                         |
        Operating reserve -> compute and gas funding
```

All architecture choices below are recommendations, not already implemented features.

## Modules

| Module | Job | Initial implementation |
| --- | --- | --- |
| Scout | Extract themes, entities and evidence from incoming signals; group duplicates. | Small instruction model with a task-specific adapter. |
| Creator | Generate a coherent name, narrative, launch description and content in the agent's style. | A separate adapter; image generation is an independent optional service. |
| Planner | Choose whether to investigate, publish, launch, manage a position or do nothing. | Prompted general model initially, informed by structured metrics. |
| Market analysis | Calculate liquidity, exposure, costs and measured outcomes. | Deterministic calculations; compare any predictive model with simple statistical baselines. |
| Executor | Construct and submit supported protocol actions. | Deterministic adapters, simulation and signing. No language model for arithmetic or transaction encoding. |
| Treasurer | Track income, preserve operating funds and pay infrastructure. | Explicit rules, accounting and automated settlement. |
| Reputation | Publish performance, activity and attribution. | Reproducible indexer and public records. |

Start training Scout and Creator. Both have concrete outputs that can be evaluated without claiming the model can predict winning coins. Train a planning model later from validated decisions and outcomes, after the execution and measurement systems exist.

## Training on the 5090

The desktop RTX 5090 has 32 GB of GPU memory. [NVIDIA specifications](https://www.nvidia.com/en-us/geforce/graphics-cards/50-series/rtx-5090/)

Start with **Qwen3.5-4B using BF16 LoRA**, training separate task adapters. Unsloth's guide reports approximately 10 GB for its 4B LoRA setup and 22 GB for 9B; actual use depends on sequence length, batch size and configuration. It recommends against 4-bit QLoRA for this family. [Unsloth training guide](https://unsloth.ai/docs/models/qwen3.5/fine-tune)

This is a practical baseline, not a claim that it is the best model on HALO tasks. Benchmark the untouched checkpoint first. LoRA fine-tuning updates a small set of additional parameters; it is more appropriate here than pretraining a language model from scratch. Use smaller models only when evaluation shows they retain the required skill.

Use a pinned Linux training environment, locally through WSL2 or native Linux. Verify a short GPU training run before preparing a long job. Unsloth documents Blackwell support and a compatible container route. [Blackwell setup guide](https://unsloth.ai/docs/blog/fine-tuning-llms-with-blackwell-rtx-50-series-and-unsloth.md)

Suggested first experiment, subject to measurement:

- One 4B base checkpoint, trained sequentially into two specialist adapters.
- Text-only examples with a short initial context window, such as 2,048 tokens.
- Microbatch of one with gradient accumulation; increase only after measuring memory.
- A curated seed dataset on the order of 1,000–3,000 examples per task, expanded according to observed failures. This is a planning range, not a sufficient-data guarantee.
- An untouched evaluation set and comparison against the original model plus a strong prompt.

Keep inference evaluation separate from training so GPU memory and timing measurements remain interpretable. No training-duration or production-throughput guarantee is made before testing the actual device and workload.

## Data and evaluation

Scout examples should include observed text, its timestamp and sources, followed by correct entities, narrative clusters and evidence. Creator examples should include an agent persona and supported facts, followed by a consistent launch/content package. Include duplicates, irrelevant signals, misleading claims and situations where the right result is no action.

Use original or permitted training material. Stronger models can help draft labels, but synthetic labels need verification. A model's explanation that a coin will win is not evidence that the trade was profitable.

Separate training and evaluation by time and by related token/narrative groups. Do not allow later prices, later posts or the same launch in a different spelling to leak into the test set. Include failed coins and quiet markets. Evaluate factual accuracy, structured-output validity, duplicate detection, style consistency, task latency and cost.

For any trading or launch-timing strategy, use historical replay with transaction costs, slippage and realistic available liquidity, then forward paper operation. Report realized results and uncertainty separately from backtest results. Training loss and token price appreciation alone do not establish an economic edge.

Publish each trained version with the base checkpoint revision, adapter hash, tokenizer/template, training recipe and evaluation report. Keep runtime memory updates separate from weight updates.

## Users bringing their own models

Support three integration modes:

1. **Compatible adapter:** a user supplies an adapter for a supported, exact base checkpoint. Efficient shared inference is possible where the serving engine supports that combination.
2. **Full weights:** a user supplies a model package with its architecture and runtime requirements. Deploy it in an isolated worker with an explicit compute price.
3. **Remote endpoint:** a user supplies a compatible inference endpoint. This is flexible, but the endpoint operator can change or withdraw service; show that dependency clearly.

Provide a standard request/response contract per role. It should specify input/output schema, tool-calling support, context limits, timeouts, cost ceilings and failure behavior. Classification models need not emulate a chat model; a small adapter can translate the common task contract into the appropriate inference request.

Each agent's manifest records model role, artifact revision/hash or endpoint, template version, supported tools, fallback rules and budget. Different base architectures use separate serving pools. A LoRA adapter is not a universal plugin for unrelated base models.

For production, consider vLLM for batched shared serving. It supports per-request adapters on compatible models, but verify the exact checkpoint, adapter and quantization combination. Isolate user artifacts and keep dynamic model-loading controls away from public inference clients. [vLLM LoRA documentation](https://docs.vllm.ai/en/latest/features/lora/)

Creators choose models before activation. Unrestricted replacement afterward would let them change an agent into one that stops, contradicting the no-pause requirement. Default to pinned execution/model rules. Any autonomous update or fallback mechanism must be declared at activation and verifiable; publishing a new model does not silently replace existing agents.

## Cloud deployment

**Akash is my first infrastructure candidate to evaluate.** It provides a marketplace for GPU deployments. Use it for portable containers rather than building HALO around one centralized hosted-agent account. [Akash GPU documentation](https://akash.network/docs/learn/core-concepts/gpu-deployments/)

Split production into lightweight agent workers and shared GPU inference pools. Batch similar requests, cache reusable signal extraction and wake agents on events. Account for each agent's actual usage and its allocated idle capacity. Low utilization can make a rented GPU more expensive than metered inference; benchmark before selecting a billing model.

Use independent operators with recoverable state, inference fallback and durable job identifiers. A replacement worker must first reconcile pending actions against chain receipts so failover does not issue duplicate launches. Rehost the same pinned model when possible rather than silently changing the agent's behavior.

Akash storage is provider-local and does not automatically survive provider migration or lease closure. Keep recoverable checkpoints outside any single provider and test restoration. [Akash storage documentation](https://akash.network/docs/learn/core-concepts/persistent-storage/)

A decentralized compute marketplace does not make an individual instance unstoppable. Providers can close leases, and depleted escrow closes deployments. [Akash deployment lifecycle](https://akash.network/docs/learn/core-concepts/deployments/)

The remaining engineering problem is autonomous operator replacement and signing authority. A single deployment-owner key can remain a shutdown control even with replicated containers. A single signer can stop actions even while every model is online. HALO needs an explicit execution authorization and recovery protocol; distributed signing or trusted execution can be candidates, but neither should be described as solving the full problem without validation.

## Paying for itself

Create an agent treasury with distinct balances for operating funds, strategy capital, fee receipts and distributable surplus. The language model cannot arbitrarily spend the compute reserve.

```text
External trades in agent-created coins
       -> protocol's actual creator/agent fee entitlement
       -> claim or settlement into agent treasury

Closed profitable positions or realized launch proceeds
       -> return principal to strategy capital
       -> record actual realized profit

Allocatable cash
       -> refill operating reserve under published rules
       -> fund inference, workers, data, storage and gas
       -> distribute remaining surplus under chosen economics
```

An agent being associated with a coin does not itself entitle it to fees. The launch must record a supported payout recipient or sharing rule. HALO's percentages are still open decisions.

Use a rules-based settlement service to claim fees and convert enough liquid receipts into the assets required for operation, with bounded slippage and batch thresholds. Count conversion, bridge and settlement costs. A treasury holding only an illiquid child coin cannot automatically pay an infrastructure invoice.

For Akash specifically, current documentation describes compute escrow funded in ACT; income from Robinhood Chain or Solana needs a verified settlement path into the required funding asset. Direct self-custody deployment and managed Console funding are different integration paths. Neither means Akash natively accepts $FRED. [Akash escrow](https://akash.network/docs/learn/core-concepts/deployments/), [Console funding](https://akash.network/docs/getting-started/how-funding-works/)

Keep the payment service independently recoverable and record invoice/usage evidence. It must not withdraw arbitrary amounts from the treasury. Provider replacement and treasury payments must operate under the same published rules without relying on a HALO staff member.

### Sustainability calculation

For a single accounting period:

```text
Operating cash contribution =
    external eligible volume × trade fee × agent share × operating allocation
    + allocated realized net profit

Net operating cash flow =
    operating cash contribution - all operating expenses
```

Realized net profit here is after the position's trading costs, before any operating expense counted on the second line. Do not subtract or count costs twice. Revenue is counted once even if assets move between wallets or chains.

**Illustration only:** if daily expenses total $5 and the effective portion of external trading volume reaching operating funds is 0.10%, then $5 / 0.001 = $5,000 of daily eligible volume covers those expenses without trading profits. These are hypothetical inputs, not a cloud quote, forecast or chosen HALO fee.

Track agent-level cost and platform-level cost separately. Include shared infrastructure, redundancy, storage, external APIs, RPC, failed transactions and support overhead where applicable. Training has an upfront cost too, even if the founder owns the GPU.

### Bootstrap and low-revenue operation

Require starting operating capital at activation. A suggested policy is 14–30 days of measured baseline costs, with the exact threshold chosen after benchmarking. Coins that have not traded yet cannot pay the first bill.

A predeclared budget policy can reduce expensive research, image generation and new launches when runway falls, while preserving essential monitoring and settlement. This is automatic economic behavior, not a creator pause button. It cannot guarantee execution after every funding source is exhausted. Public subsidies, if any, should be visible rather than described as self-funding revenue.

## First complete framework milestone

Build one example agent, Fred, that:

1. Uses the default model or a creator-supplied compatible model package.
2. Runs the Scout and Creator specialists trained on the founder's 5090.
3. Persists identity, memory and jobs independently of the website.
4. Launches a child token through a proven protocol adapter with the required pairing.
5. Receives actual configured fee income, distinguishes it from capital and profit, and funds an operating payment.
6. Continues through one worker failure without duplicate actions or a manual approval.
7. Publishes costs, runway, model versions and outcomes.

Validate chain integrations separately for Robinhood Chain and Solana. Then expand the same model/worker interfaces to many user-created agents. The full release still needs the public creation experience, both networks, performance pages and decentralized execution guarantees defined in the project brief.

The first experiment to build is the data/evaluation pipeline plus one agent's fee-to-compute accounting. Those measurements determine which specialists deserve fine-tuning and whether the intended operating economics work.
