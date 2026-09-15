# Public decision core v1

This is a transparent, untrained authorization baseline. It is a small ONNX computation with fixed published coefficients, not a claim of profitable trading intelligence. It proves the configured decision computation; larger models remain advisory.

The model takes 32 separate action-commitment bytes and ten Boolean state facts. Each byte is exactly representable at scale zero. Never encode a full 256-bit hash as one floating-point input. The graph copies the commitment and computes `relu(sum(flags) - 9)`. The EVM adapter must reconstruct those Boolean facts from the vault's authoritative context and require authorization output 1. Accepting arbitrary caller-provided flags would invalidate the design.

`build_model.py` creates the model and its SHA-256 manifest. `prove_fixture.py --output <workspace-proof-directory> --solc-dir <native-solc-directory>` exercises the real EZKL compiler, public SRS download, witness, proving, verification and EVM-verifier generation. Python requirements are pinned in `requirements.txt`.

The fixture is a proof feasibility gate. It is not yet the production adapter or the final policy/model interface. Native verification, EVM verification, rejection tests, complete vault binding and an independent security review are separate acceptance gates.

All proving artifacts use explicit caller-selected paths. Production requires an identified public SRS and pinned verification artifacts. Do not generate a private trusted setup as a substitute for the public SRS.
