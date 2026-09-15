"""Compile the real EZKL circuit and prove a fixture. No test verifier or signing key is used."""
import argparse
import asyncio
import hashlib
import inspect
import json
import os
from pathlib import Path
import time
import ezkl
from build_model import build_model


async def invoke(name, *args, **kwargs):
    started = time.perf_counter()
    result = getattr(ezkl, name)(*args, **kwargs)
    if inspect.isawaitable(result):
        result = await result
    if result is False:
        raise RuntimeError(f"EZKL {name} returned false")
    elapsed = time.perf_counter() - started
    print(f"{name}: {elapsed:.3f}s", flush=True)
    return result, elapsed


async def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--solc-dir", type=Path)
    options = parser.parse_args()
    output = options.output.resolve()
    output.mkdir(parents=True, exist_ok=True)
    # EZKL's Windows build otherwise assumes HOME exists, even with explicit SRS paths.
    # Keep its additional cache in the caller's workspace rather than altering HOME.
    os.environ["EZKL_REPO_PATH"] = str(output / "ezkl-cache")
    if options.solc_dir:
        os.environ["PATH"] = str(options.solc_dir.resolve()) + os.pathsep + os.environ.get("PATH", "")
    model = build_model()
    files = {name: str(output / filename) for name, filename in {
        "settings": "settings.json", "circuit": "core.ezkl", "srs": "kzg12.srs", "vk": "vk.key", "pk": "pk.key",
        "data": "input.json", "witness": "witness.json", "proof": "proof.json", "verifier": "CoreVerifier.sol",
        "abi": "verifier-abi.json", "calldata": "calldata.bytes"}.items()}
    commitment = hashlib.sha256(b"HALO_CORE_V1_FIXTURE").digest()
    inputs = [float(value) for value in commitment] + [1.0] * 10
    Path(files["data"]).write_text(json.dumps({"input_data": [inputs]}), encoding="utf-8")
    args = ezkl.PyRunArgs()
    args.input_visibility = "public"
    args.output_visibility = "public"
    args.param_visibility = "fixed"
    args.input_scale = 0
    args.param_scale = 0
    args.logrows = 12
    args.lookup_range = (-16, 512)
    args.disable_freivalds = True
    timings = {}
    _, timings["settings"] = await invoke("gen_settings", model=str(model), output=files["settings"], py_run_args=args)
    _, timings["compile"] = await invoke("compile_circuit", model=str(model), compiled_circuit=files["circuit"], settings_path=files["settings"])
    if not Path(files["srs"]).exists():
        _, timings["public_srs"] = await invoke("get_srs", settings_path=files["settings"], srs_path=files["srs"])
    # Published by EZKL v23.0.5 in src/srs_sha.rs. A different SRS is not silently accepted.
    if hashlib.sha256(Path(files["srs"]).read_bytes()).hexdigest() != "28b151069f41abc121baa6d2eaa8f9e4c4d8326ddbefee2bd9c0776b80ac6fad":
        raise RuntimeError("Public SRS checksum does not match the pinned EZKL release")
    _, timings["witness"] = await invoke("gen_witness", data=files["data"], model=files["circuit"], output=files["witness"])
    _, timings["setup"] = await invoke("setup", model=files["circuit"], vk_path=files["vk"], pk_path=files["pk"], srs_path=files["srs"])
    _, timings["prove"] = await invoke("prove", witness=files["witness"], model=files["circuit"], pk_path=files["pk"],
        proof_path=files["proof"], srs_path=files["srs"])
    _, timings["verify"] = await invoke("verify", proof_path=files["proof"], settings_path=files["settings"], vk_path=files["vk"], srs_path=files["srs"])
    compiler_note = None
    try:
        _, timings["evm_verifier"] = await invoke("create_evm_verifier", vk_path=files["vk"], settings_path=files["settings"],
            sol_code_path=files["verifier"], abi_path=files["abi"], srs_path=files["srs"])
    except RuntimeError as error:
        # EZKL writes the complete Solidity source before trying its hard-coded solc 0.8.20 installer.
        # The project's EVM test compiles that source with pinned solc 0.8.30 and must pass independently.
        if "[eth] svm error" not in str(error) or not Path(files["verifier"]).is_file():
            raise
        compiler_note = "EZKL generated Solidity; its SVM compiler install failed. Project solc 0.8.30 compilation and EVM tests are required."
        print(compiler_note, flush=True)
    await invoke("encode_evm_calldata", proof=files["proof"], calldata=files["calldata"])
    evidence = {"ezkl_version": ezkl.__version__, "commitment": commitment.hex(), "inputs": inputs,
        "timings_seconds": timings, "srs_sha256": hashlib.sha256(Path(files["srs"]).read_bytes()).hexdigest(),
        "model_sha256": hashlib.sha256(model.read_bytes()).hexdigest(),
        "compiler_note": compiler_note,
        "verification": "EZKL native verification passed; EVM deployment and negative tests are a separate gate"}
    (output / "benchmark.json").write_text(json.dumps(evidence, indent=2) + "\n", encoding="utf-8")
    print("Real EZKL proof and Solidity verifier generated. On-chain verification still requires its own test.", flush=True)


if __name__ == "__main__":
    asyncio.run(main())
