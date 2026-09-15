# HALO technical approach

Updated 13 September 2026. Robinhood Chain, the Ethereum L2, is the only public-chain deployment target for this release.

## Exact stack

| Layer | Implementation / selected stack | State |
|---|---|---|
| Contracts | Solidity 0.8.30, OpenZeppelin 5.4.0, Uniswap v4-core 1.0.2, Foundry 1.7.1 | Local lifecycle and Robinhood fork verified |
| EVM SDK | viem 2.56.5 | Contract reads, simulation, submission and receipts working |
| Small proven core | ONNX 1.19.1, EZKL 23.0.5, pinned public model and EVM verifier | Actual action proofs working |
| Runtime | Python 3.12, Pydantic 2.13.5, Node 22.23.2 executor | Public baseline, evidence, payments and replacement operator working locally |
| Larger models | Qwen3.5-4B Q8_0 with llama.cpp b10809; hosted Hermes/vLLM selected | Actual local GPU proposals and launches verified; hosting/evaluation pending |
| Public API | Fastify 5.12.4, Zod 4.6.4 | Stateless chain projections working |
| Durable projections | PostgreSQL 17, Drizzle, transactional outbox and leased jobs | Linux jobs/outbox and crash recovery passed; indexing and full integration pending |
| Content storage | Kubo 0.43.0, SHA-256 raw-block CIDs, multiformats 14.0.5 | Three real local peers with pin/retrieval checks |
| Frontend | React 19.2.6, TypeScript 5.9.3, Tailwind 4.2.1, Vinext 1.0.0-beta.5 | Seven connected routes and Live tab |
| Wallets | EIP-1193/EIP-6963; WalletConnect | Injected discovery working; WalletConnect pending |
| Hosting | Akash shared inference and independent CPU operators | Deployment manifests and funded providers pending |
| Observability | Signed SSE timeline; OpenTelemetry, Prometheus, Grafana | Local timeline working; production telemetry pending |

Dependencies are pinned in lockfiles and proof manifests. Node preview is used on this Windows host because workerd's process IPC is unavailable; the production frontend build retains Cloudflare Worker output. No production hostname or backend is claimed.

## Module boundaries

Contracts own funds and authority. The executor owns only its gas-paying operator key. Python proposal and proof processes receive public files and an allowlisted environment. Retrieved material is data and cannot choose arbitrary contracts, transfers, shell commands or credential destinations. Public HTTP requests reject local/private addresses, mixed DNS answers, redirects and oversized responses, and pin the resolved connection address.

The API is a projection, not a signer. A worker can recover manifests and prior evidence from the chain and IPFS without this API. New manifests use IPFS URIs; the old local HTTP-manifest format can recover through a previous on-chain narrative's public artifact when available.

The public custom-provider interface accepts bounded public narrative and portfolio inputs. It returns strict launch, hold, buy or sell proposals. Unknown fields, arbitrary destinations and unavailable source IDs are rejected. The operator connects trade proposals to contract observations, real proofs, simulation and verified receipts. Graduated buys and sells passed the complete operator flow locally and on a Robinhood fork; the proposal provider in that test is a disclosed fixture, not deployed LLM inference.

Public-model mode separately commits a release containing weights, prompt, grammar and adapter hashes. Actual Qwen inference has now produced two website-visible child launches and a daily-limit hold for Nova. Its local watcher and three IPFS peers share one machine. Operator-configured model endpoints cannot be selected through an agent manifest; the model receives no tools or wallet. See HALO_PUBLIC_MODEL_RUNTIME.md for exact releases and acceptance evidence.

## Deployment configuration

Mainnet: chain 4663, public RPC https://rpc.mainnet.chain.robinhood.com, explorer https://robinhoodchain.blockscout.com.

Testnet: chain 46630, public RPC https://rpc.testnet.chain.robinhood.com, explorer https://explorer.testnet.chain.robinhood.com.

Public RPCs are for initial development and are rate limited. Supply independent production/archival RPC endpoints through configuration. Root HALO, its reference market, WETH and all deployed protocol addresses must be verified before funding. The SDK rejects unsupported public chain IDs.

Official source: https://docs.robinhood.com/chain/connecting/

## Operating economics

Compute and gas are real expenses. A worker simulates the action, estimates fees, applies its own gas-cost ceiling and refuses work whose committed reward does not cover its compute budget and required margin. A local-only test override permits explicitly subsidized test work. It is rejected for testnet/mainnet configuration.

A local fee-funded cycle now passes: earned parent/base receipts convert through bounded routes into the operating token and cover subsequent proof-authorized work. AgentFeeTreasury isolates those receipts from trading capital; HALO_FEE_SETTLEMENT.md specifies the guards and keeper workflow. Sustained self-funding on real WETH markets and hosted compute remains an acceptance gate. Market capitalization, deposits and unconverted balances cannot be labeled operating income. Use measured chain-specific costs before setting the irreversible work reward.
