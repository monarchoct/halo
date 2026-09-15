"""Produce a fresh action proof using pinned public proving material. Never signs a transaction."""
import argparse
import asyncio
import hashlib
import inspect
import json
import os
from pathlib import Path
import re
import time

import ezkl

MODEL_SHA256 = "77d2eba11110e97767e99c15787f796886f41164295b32e7df9d5d4330ce3f89"
VERIFIER_HASH = "0x00a2201cf2d52a79f8817f1d83d2e90c7a6c0fcb7b0b80ee6d00dc3c2a4dc5d1"


def sha256(path):
    with path.open("rb") as source:
        return hashlib.file_digest(source, "sha256").hexdigest()


def validate_release(directory, expected_hash):
    manifest_path = directory / "manifest.json"
    if sha256(manifest_path) != expected_hash:
        raise ValueError("Proving release manifest checksum mismatch")
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    if manifest["modelSha256"] != MODEL_SHA256 or manifest["verifierRuntimeCodeHash"] != VERIFIER_HASH:
        raise ValueError("Release does not match the immutable decision core")
    if ezkl.__version__ != manifest["ezklVersion"]:
        raise ValueError("EZKL version differs from the proving release")
    for filename in ("settings.json", "core.ezkl", "pk.key", "vk.key", "kzg12.srs"):
        candidate = directory / filename
        spec = manifest["files"][filename]
        if candidate.stat().st_size != spec["bytes"] or sha256(candidate) != spec["sha256"]:
            raise ValueError(f"Corrupt proving artifact: {filename}")
    return manifest


async def invoke(name, **arguments):
    result = getattr(ezkl, name)(**arguments)
    if inspect.isawaitable(result):
        result = await result
    if result is False:
        raise RuntimeError(f"EZKL {name} returned false")
    return result


async def prove_action(request, release, output, expected_release_hash):
    validate_release(release, expected_release_hash)
    commitment = request.get("commitment", "")
    facts = request.get("facts")
    if not re.fullmatch(r"0x[0-9a-fA-F]{64}", commitment):
        raise ValueError("Commitment must contain exactly 32 bytes")
    if not isinstance(facts, list) or len(facts) != 10 or any(type(value) is not int or value not in (0, 1) for value in facts):
        raise ValueError("Exactly ten integer Boolean facts are required")
    output.mkdir(parents=True, exist_ok=True)
    os.environ["EZKL_REPO_PATH"] = str(output / "ezkl-cache")
    values = list(bytes.fromhex(commitment[2:])) + facts
    data = output / "input.json"
    data.write_text(json.dumps({"input_data": [[float(value) for value in values]]}), encoding="utf-8")
    started = time.perf_counter()
    await invoke("gen_witness", data=str(data), model=str(release / "core.ezkl"), output=str(output / "witness.json"))
    await invoke("prove", witness=str(output / "witness.json"), model=str(release / "core.ezkl"),
                 pk_path=str(release / "pk.key"), proof_path=str(output / "proof.json"), srs_path=str(release / "kzg12.srs"))
    await invoke("verify", proof_path=str(output / "proof.json"), settings_path=str(release / "settings.json"),
                 vk_path=str(release / "vk.key"), srs_path=str(release / "kzg12.srs"))
    await invoke("encode_evm_calldata", proof=str(output / "proof.json"), calldata=str(output / "calldata.bytes"))
    result = {"version": "halo-core-v1", "commitment": commitment, "facts": facts,
              "authorization": int(all(facts)), "releaseSha256": expected_release_hash,
              "elapsedSeconds": time.perf_counter() - started, "proofSha256": sha256(output / "proof.json")}
    (output / "result.json").write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(result), flush=True)
    return result


async def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--request", type=Path, required=True)
    parser.add_argument("--release", type=Path, default=Path(__file__).resolve().parent / "release")
    parser.add_argument("--release-sha256", required=True)
    parser.add_argument("--output", type=Path, required=True)
    options = parser.parse_args()
    if options.request.stat().st_size > 32768:
        raise ValueError("Oversized proof request")
    request = json.loads(options.request.read_text(encoding="utf-8-sig"))
    await prove_action(request, options.release.resolve(), options.output.resolve(), options.release_sha256)


if __name__ == "__main__":
    asyncio.run(main())
