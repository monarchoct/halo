"""Create a deterministic public runtime build context. No work directories or secrets."""
import gzip
import hashlib
import io
import json
import tarfile
from pathlib import Path

root = Path(__file__).resolve().parents[1]
destination = root.parents[1] / "work/linux-lab/runtime-source.tar.gz"
selected = {"package.json", "package-lock.json", "runtime/requirements.txt"}
# Only code under these reviewed source roots; never copy an entire working directory.
for directory in ("runtime", "sdk", "services", "deploy/runtime"):
    for file in (root / directory).rglob("*.mjs"):
        if not any(part in {"node_modules", "test-results"} for part in file.relative_to(root).parts):
            selected.add(file.relative_to(root).as_posix())
selected.update(file.relative_to(root).as_posix() for file in (root / "runtime/prompts").glob("*.md"))
for file in (root / "artifacts").glob("*.json"):
    artifact = json.loads(file.read_text(encoding="utf-8"))
    source = artifact.get("sourceName", "")
    # Compiling --test leaves fixture artifacts beside deployable contracts.
    # They must never enter a production runtime, even after local acceptance.
    if source.startswith("test/"):
        continue
    generated_core = (file.name == "Halo2Verifier.json" and source == "Halo2Verifier.sol"
                      and artifact.get("contractName") == "Halo2Verifier")
    if (not source.startswith("contracts/") and not generated_core) or ".." in Path(source).parts:
        raise RuntimeError(f"Unreviewed artifact source: {file.name}")
    selected.add(file.relative_to(root).as_posix())
selected.update(file.relative_to(root).as_posix() for file in (root / "services/persistence/migrations").glob("*.sql"))
selected.update({"services/persistence/package.json", "services/persistence/package-lock.json",
                 "services/operations/projections.sql", "services/history/schema.sql", "deploy/runtime/Dockerfile", "runtime/propose.py"})
selected.update({f"models/core-v1/{name}" for name in ("prove_action.py", "requirements.txt", "model.onnx", "model-manifest.json")})
selected.update({f"models/core-v1/release/{name}" for name in ("manifest.json", "manifest.sha256", "settings.json", "core.ezkl", "pk.key", "vk.key", "kzg12.srs")})
selected.update({f"models/proposal-qwen35-4b/{name}" for name in ("assets.lock.json", "release.json", "release.sha256", "schema.json")})
manifest = {"version": 1, "files": {}}
destination.parent.mkdir(parents=True, exist_ok=True)
with destination.open("wb") as output, gzip.GzipFile(fileobj=output,mode="wb",filename="",mtime=0) as compressed, tarfile.open(fileobj=compressed, mode="w") as archive:
    def add(name, data):
        info = tarfile.TarInfo("runtime/" + name)
        info.size, info.mode, info.mtime = len(data), 0o644, 0
        archive.addfile(info, io.BytesIO(data))
    for name in sorted(selected):
        file = root / name
        if file.is_symlink() or not file.resolve().is_relative_to(root) or not file.is_file():
            raise RuntimeError("Refuse missing or external source path")
        data = file.read_bytes()
        manifest["files"][name] = {"bytes": len(data), "sha256": hashlib.sha256(data).hexdigest()}
        add(name, data)
    encoded = (json.dumps(manifest, indent=2) + "\n").encode()
    add("runtime-source-manifest.json", encoded)
print(json.dumps({"file":str(destination), "files":len(selected), "bytes":destination.stat().st_size,
                  "sha256":hashlib.sha256(destination.read_bytes()).hexdigest(), "sourceSha256":hashlib.sha256(encoded).hexdigest()}))
