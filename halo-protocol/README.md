# HALO protocol

New agent instances support real-proof discretionary trading in their official graduated Uniswap v4 pools. Run `node test/graduated-agent.mjs --no-compile` after compiling to verify the contract and operator lifecycle, or add `--preview` for an isolated RPC 8547/API 8789 website preview at `http://localhost:5173/explore?preview=trading`. Existing previews are preserved. See [graduated trading](../HALO_GRADUATED_AGENT_TRADING.md) for the exact scope and remaining model/hosting work.

Robinhood Chain (Ethereum L2) implementation of the accepted HALO plan. This is a working local product slice under active development, not a deployed or audited production release.

Read ../HALO_IMPLEMENTATION_SPEC.md, IMPLEMENTATION_STATUS.md and ../HALO_PUBLIC_ACTIVITY_AND_SOCIAL.md for scope, evidence and remaining gates.

## Commands

- npm ci --ignore-scripts: reproducible Node dependencies, including platform-specific Foundry binaries.
- npm run compile: Solidity 0.8.30 compilation with contract size checks and the separately compiled pinned Halo2 verifier.
- npm test: economic/reference lifecycle suite on disposable Anvil.
- npm run test:real-agent: real EZKL launch/buy/sell proof lifecycle. Requires the pinned Python environment and models/core-v1/release artifacts.
- npm run test:fork: read the public Robinhood RPC, then transact only on a local fork.
- npm run test:runtime: egress, model-output, credential-isolation and artifact integrity boundaries.
- npm run test:curve-oracle: verify the exact price integral, an atomic manipulation attempt and observation rollover.
- npm run test:settlement: fee isolation, guarded conversion, real proof-authorized work and the independent paid settlement worker.
- npm run export:web: export current contract ABIs to the sibling web application.
- npm run dev:stack: create the disposable local chain and read API. Requires compiled artifacts and the proving release. This chain is not persisted across restarts.
- npm run dev:artifacts: start three real local offline Kubo peers and the manifest/content service. Requires Kubo 0.43.0; set HALO_IPFS_BINARY to its executable.
- npm run dev:transparency: start the signed public step journal and SSE service.
- npm run dev:operator -- AGENT_ADDRESS: run one explicitly subsidized local baseline cycle using a disposable operator account.
- npm run test:recovery: recover the latest launched local agent with a different operator and replacement IPFS peer. Requires the local stack and a successful prior launch.
- npm run test:transparency: verify signatures, receipt binding and journal restart against local-chain evidence.
- npm ci --prefix services/persistence: install the pinned PostgreSQL/Drizzle adapter.
- npm run db:migrate -- DATABASE_CONFIG: apply the checksum-pinned schema with migration credentials.
- npm run test:persistence: real PostgreSQL queue, lease and outbox checks in a uniquely named disposable database.
- npm run test:scheduler-recovery: recover existing local agent receipts through PostgreSQL and publish them on the local IPFS peers.

Set HALO_PYTHON to the Python 3.12 executable containing models/core-v1/requirements.txt and runtime/requirements.txt. The development fallback points at the workspace's work/halo-python environment. Wallet credentials are not forwarded to proposal/prover children.

Production worker, funding and deployment commands must use explicit Robinhood configuration, real gas-cost budgets, reviewed artifacts and operator-owned credentials. No mainnet submission path is present in the disposable development helpers.

## Source layout

contracts/ contains immutable economic and agent contracts. sdk/ contains RPC projections, content identifiers, safe transport and the proof wrapper. models/core-v1/ contains the public ONNX core and verifier release. runtime/ contains research, typed proposals, the executor and signed trace publication. services/ contains read, artifact and transparency APIs. test/ and test-results/ contain executable checks and generated evidence. The sibling halo-web/ contains the connected website.

Execution through runtime/cli.mjs now requires the database configuration described in services/persistence/README.md. It uses leases tied to an exact agent nonce and a transactional receipt outbox. Twelve PostgreSQL scenarios and four local chain/IPFS recovery scenarios passed. Native Windows database crash recovery failed because the host denied inter-process checkpoint signaling; a separate Linux VM now passes the same-volume recovery drill. The GitHub CI definition remains unexecuted. The final browser image passes eleven actual container checks and opens FOMO in sandboxed Chromium; its signed captures reach Nova's website. Linux journal locking and startup-failure reporting also pass. X returns HTTP 403 here; authenticated social sessions remain unverified. See scripts/linux-lab/README.md and ../HALO_LINUX_ACCEPTANCE.md.

Fee settlement now has an isolated treasury, fixed curve/v4 routes, price/depth guards and a gas-budgeted independent worker. runtime/cli.mjs runs it before decision work by default. Read ../HALO_FEE_SETTLEMENT.md for exact configuration and evidence. The separate local preview uses scripts/dev-stack.mjs --settlement-preview (RPC 8546/API 8788) and http://localhost:5173/?preview=settlement, preserving the original Cedar chain. scripts/dev-settlement.mjs --warmup advances only that disposable preview and executes a bounded round.

Public model mode now runs pinned Qwen3.5-4B Q8_0 through native llama.cpp on the local RTX 5090. Nova was created through the website, launched two different child narratives through different operators and held at its daily limit. The exact release, transcripts, three local IPFS replicas and canonical payments passed test/live-model-acceptance.mjs. scripts/dev-model-operator.mjs supports --watch; production runtime/cli.mjs accepts explicit publicModels bindings. Read ../HALO_PUBLIC_MODEL_RUNTIME.md before changing a committed release or starting a preview service. Never publish the local inference key, model cache or the whole test-results directory.

Chain projections/reorganization handling, durable live/social delivery, actual Hermes/vLLM hosting, continuous checkpoint maintenance, realized-profit recycling and independent public deployment remain implementation work. The public progress document must not be replaced by a claim that the full product is finished.
