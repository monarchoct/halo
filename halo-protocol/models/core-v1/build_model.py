"""Generate the transparent, untrained HALO v1 authorization scoring graph."""
from pathlib import Path
import hashlib
import json
import numpy as np
import onnx
from onnx import TensorProto, helper, numpy_helper

MODEL_DIR = Path(__file__).resolve().parent


def build_model():
    # 32 commitment bytes avoid lossy conversion of a 256-bit hash through floating point.
    # Ten Boolean facts will be derived by the vault/verifier adapter from authoritative state.
    # ReLU(sum(flags)-9) equals 1 iff all ten facts pass, for inputs in {0,1}.
    weights = np.zeros((42, 33), dtype=np.float32)
    weights[:32, :32] = np.eye(32, dtype=np.float32)
    weights[32:, 32] = 1
    bias = np.zeros(33, dtype=np.float32)
    bias[32] = -9
    graph = helper.make_graph([
        helper.make_node("MatMul", ["inputs", "weights"], ["linear"]),
        helper.make_node("Add", ["linear", "bias"], ["shifted"]),
        helper.make_node("Relu", ["shifted"], ["outputs"]),
    ], "halo_public_authorization_core_v1",
        [helper.make_tensor_value_info("inputs", TensorProto.FLOAT, [1, 42])],
        [helper.make_tensor_value_info("outputs", TensorProto.FLOAT, [1, 33])],
        [numpy_helper.from_array(weights, "weights"), numpy_helper.from_array(bias, "bias")])
    model = helper.make_model(graph, producer_name="halo", producer_version="1.0.0",
        opset_imports=[helper.make_opsetid("", 13)])
    model.ir_version = 8
    model.doc_string = "Public deterministic authorization baseline, not a trained predictor of trading profits."
    onnx.checker.check_model(model)
    destination = MODEL_DIR / "model.onnx"
    onnx.save(model, destination)
    digest = hashlib.sha256(destination.read_bytes()).hexdigest()
    manifest = {
        "version": "halo-core-v1", "model_sha256": digest, "trained": False,
        "input_shape": [1, 42], "output_shape": [1, 33],
        "commitment_encoding": "32 separate bytes, each an exact integer between 0 and 255",
        "authorization": "relu(sum(ten_boolean_facts)-9)",
        "limitations": ["Does not prove the larger LLM ran", "Does not establish the truth of off-chain sources",
            "Ten facts must be reconstructed from authoritative state and restricted to Boolean values by the EVM adapter",
            "Model artifacts alone do not authorize spending; contract integration is required"],
    }
    (MODEL_DIR / "model-manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    print(f"Built ONNX core {digest}", flush=True)
    return destination


if __name__ == "__main__":
    build_model()
