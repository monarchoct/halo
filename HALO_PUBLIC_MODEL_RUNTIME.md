# HALO public model runtime

Verified locally on 13 September 2026. This is actual model inference connected to the website, proofs and disposable chain transactions. Public hosting and production acceptance remain incomplete.

## Pinned implementation

The native Windows development service runs Qwen3.5-4B Q8_0 on the owner's RTX 5090 through llama.cpp. The selected Linux Hermes/vLLM stack remains a separate deployment task; the GPU backend stays native while the new Linux acceptance VM verifies database/container behavior. Training was not performed or required for this integration.

| Component | Exact selection | Commitment |
|---|---|---|
| Model | bartowski/Qwen_Qwen3.5-4B-GGUF, Q8_0 | Repository revision 4168f45a16a1290d65a4ec0fa312ae917a4c15d6 |
| Runtime | llama.cpp v0.4.0, build b10809 | Source commit 5266f24da75dc449bd56cbed7addb9c8e4a6a73e |
| GPU backend | Windows x64, CUDA 13.3 | Official runtime/DLL archive digests in assets.lock.json |
| Serving | Loopback port 8080, one slot | 16,384-token context; FP16 KV cache; full GPU offload |
| Generation | Temperature 0.3, seed 42 | 1,024 output-token ceiling; reasoning disabled |

Model SHA-256: 5c74c0ede371924357dff0cb6ba145bd67208b9b2389ded681adfff3f7608db7.

Nova's proposal-release SHA-256: 4ece597fd8878b2a3c2d2030d6cccd2d7388d2eb9ae7776c9ceaa2da8df98b0e.

The release binds weights, runtime source, prompt, output schema and adapter source. Startup verifies the downloaded assets and every extracted runtime file against the verified archives. The inference server has a local API key and no enabled tools, shell or wallet. Operator credentials are absent from public inference requests and transcripts.

## Activation and execution

Creation now offers Rules baseline, Public AI model and Custom API. Public AI model commits proposalReleaseSha256 with public-weights reproducibility; its manifest cannot select a private endpoint. Existing activated rules/API manifests remain supported. An operator explicitly binds a committed release to its own loopback HTTP or public HTTPS inference backend. A missing release never silently falls back to another model.

The model receives public narrative interests, bounded source evidence, used-source history, portfolio balances and policy limits. It returns a launch, hold, buy or sell proposal. Action-specific JSON grammar prevents mixing launch and trade payloads. Independent Zod checks retain string limits and semantic validation. This separation was required because expanding long Unicode-string limits into llama.cpp grammar exceeded its grammar-complexity ceiling.

The operator still checks sources, launch eligibility, owned assets, allocation limits, output floors, nonce, proof and economics. It publishes the release, prompt/schema/adapter bundle and complete parsed inference transcript to three verified IPFS peers. Evidence commits their CIDs. Full model weights currently reside in the local cache and at the pinned upstream repository; three independent full-weight copies remain a production hosting requirement.

The transcript includes the exact request, parsed model response, reported usage, runtime fingerprint and elapsed time. The response hash records the original wire body; formatting of that wire body is not preserved by the parsed response. The transcript's own CID verifies the published artifact. Neither its hashes nor an operator signature prove exclusive model authorship or the truth of a model's rationale. The smaller EZKL proof continues to authorize only the admitted spending envelope.

## Verified website-to-model cycles

Nova was created, funded and activated through the website's local test wallet on the disposable trading preview. Its vault is 0x532323de74BAb864b7005D910E5bD8562D038b9b. The creator funded 28.8 test WETH and a 1,000 test HALO initial purchase; no real money was spent.

| Confirmed action | Model / proof / full cycle | Result |
|---|---|---|
| Nonce 0, block 77 | 2.793 s / 0.479 s / 5.432 s | LUNAR_MIND launched, 0.01 test WETH work payment |
| Nonce 1, block 80 | 3.286 s / 0.537 s / 5.445 s | ASTRO_MIND launched by a second operator using recovered public history |
| Nonce 2, block 83 | 1.280 s / 0.413 s / 3.185 s | Hold after the two-launch daily limit; 0.01 test WETH work payment |

These used live NASA/GitHub source feeds, actual Qwen inference and fresh EZKL proofs. The second launch referenced different sources; its operator had a separate working directory. The test clock advanced by 901 seconds between cycles to exercise the committed interval. The actual model chose the actions; no proposal fixture or manually selected token name was supplied to these cycles.

The three work rewards each exceeded measured local gas plus the configured compute budget. That budget is an operator estimate, not a measured cloud invoice or electricity cost. Nova's work was funded by its creator's test reserve. Sustained fee-funded hosted inference is not demonstrated by these results.

Activity now exposes Inspect decision. The browser reconstructs the raw CID from the event's evidence hash, verifies retrieved bytes and checks the corresponding execution receipt. It displays numbered source citations and links to the public transcript. Live shows the seven signed execution phases. No autonomous browser video or social post is claimed for these model cycles.

## Run and recover locally

From outputs/halo-protocol, fetch the pinned files:

```text
node scripts/fetch-inference-assets.mjs
```

Extract both verified ZIP archives into work/inference-assets/llama-b10809. Run scripts/start-local-inference.ps1; it checks the archives, model and extracted files again before execution. The key file and model cache are local-only artifacts and must not be published.

Existing chain and IPFS services must be running. The model preview's artifact and trace services use ports 8793 and 8794. They reuse the three existing local Kubo peers and preserve the original chain/history:

```text
node scripts/dev-model-services.mjs
node test/inference-boundaries.mjs
node test/inference-live.mjs
./scripts/linux-lab/ssh.ps1 -Operation database-tunnel -Source '54330:54329'
# In a separate PowerShell process:
./scripts/run-local-queued-model.ps1 -Agent <agent-address> -Watch
node test/live-model-acceptance.mjs
```

The accepted Linux PostgreSQL database must also be running. The wrapper retrieves its local acceptance configuration over pinned SSH without printing credentials and passes it to the native worker in process environment. The database tunnel binds only host 127.0.0.1:54330 to guest 127.0.0.1:54329. Nova and Lyra now use agent-scoped claims in the shared runtime scheduler; confirmed launches atomically create X/FOMO intents for the separate Linux consumer. The local watcher scans every 30 seconds and executes only when the immutable 15-minute policy permits work. It is not an independently hosted production worker. Do not start duplicate preview services on occupied ports. Keep activated release files intact; a new prompt or adapter requires a new committed release and does not rewrite Nova's manifest.

Production runtime/cli.mjs accepts operator-owned publicModels bindings with releaseFile, backendUrl and optional authorizationEnvironment. The shared PostgreSQL scheduler now passes a fresh real-model launch through actual browser delivery in the local lab. Portable Linux model/prover hosting, transaction recovery and independent deployment still need their remaining acceptance gates. Custom API mode remains available for user-trained models behind the same action boundary; arbitrary verifier replacement is not enabled.

## Remaining model work

Evaluate narrative quality and portfolio decisions on held-out temporal data; the current model sometimes overstates its sources or describes limits imprecisely. Add richer market observations, measured compute pricing, multi-agent capacity tests, recoverable versioned serving images, independent model mirrors and hosted Hermes integration. Ship the model import/training harness without implying that a valid JSON response or profitable local test makes a profitable strategy.

Primary references: https://huggingface.co/Qwen/Qwen3.5-4B ; https://huggingface.co/bartowski/Qwen_Qwen3.5-4B-GGUF ; https://github.com/ggml-org/llama.cpp/releases/tag/v0.4.0 ; https://github.com/ggml-org/llama.cpp/releases/tag/b10809 ; https://hermes-agent.nousresearch.com/docs/user-guide/configuration
