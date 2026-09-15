"""Export only reviewed source paths; never include local secrets or service state."""
import hashlib
import io
import json
import tarfile
from pathlib import Path

root = Path(__file__).resolve().parents[2]
destination = root.parents[1] / "work/linux-lab/source.tar.gz"
selected = ["package.json", "package-lock.json", "scripts/compile.mjs", "scripts/compile-core.mjs", "test/persistence.mjs", "test/persistence-restart.mjs", "test/browser-driver.mjs", "test/browser-egress.mjs", "test/browser-container.mjs", "test/browser-container-probe.mjs", "test/browser-live-observe.mjs", "test/browser-forwarder-cli.mjs", "artifacts/AgentRegistry.json"]
selected += ["artifacts/AgentVault.json", "runtime/scheduler.mjs", "runtime/outbox.mjs", "runtime/social.mjs", "runtime/proposals.mjs", "test/social-outbox.mjs"]
selected += ["runtime/social-cli.mjs", "test/browser-queued.mjs"]
selected += ["test/browser-runner-lifecycle.mjs", "test/social-cli-local.mjs"]
selected += ["scripts/dev-model-operator.mjs", "scripts/run-local-queued-model.ps1", "test/create-model-pipeline-agent.mjs", "test/model-social-pipeline.mjs", "test/agent-inboxes.mjs"]
selected += ["test/public-operations.mjs", "test/browser-desktop.mjs"]
selected += ["test/action-costs.mjs", "test/action-costs-live.mjs", "test/scheduler-costs.mjs"]
for directory in ["sdk", "services/persistence", "services/browser", "services/operations", "runtime/browser", "runtime/identity", "scripts/linux-lab"]:
    for file in (root / directory).rglob("*"):
        relative = file.relative_to(root)
        if any(part in {"node_modules", "__pycache__", ".git", "test-results"} for part in relative.parts):
            continue
        if file.is_file() and (file.suffix in {".mjs", ".json", ".yaml", ".sh", ".sql", ".md", ".py", ".ps1"} or file.name.startswith("Dockerfile")):
            selected.append(relative.as_posix())
manifest = {}
with tarfile.open(destination, "w:gz") as archive:
    for name in sorted(set(selected)):
        file = root / name
        if file.is_symlink() or not file.resolve().is_relative_to(root):
            raise RuntimeError("Refuse external source path")
        data = file.read_bytes()
        manifest[name] = hashlib.sha256(data).hexdigest()
        info = tarfile.TarInfo("protocol/" + name)
        info.size = len(data)
        info.mode = 0o644
        archive.addfile(info, io.BytesIO(data))
    data = json.dumps(manifest, indent=2).encode()
    info = tarfile.TarInfo("protocol/source-manifest.json")
    info.size = len(data)
    info.mode = 0o644
    archive.addfile(info, io.BytesIO(data))
print(json.dumps({"file": str(destination), "files": len(manifest), "bytes": destination.stat().st_size, "sha256": hashlib.sha256(destination.read_bytes()).hexdigest()}))
