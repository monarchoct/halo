"""Stage only public HALO build inputs for a Linux builder; never publish or deploy."""
import hashlib
import json
import shutil
import subprocess
import sys
from pathlib import Path

root = Path(__file__).resolve().parents[1]
workspace = root.parents[1]
destination = workspace / "work/cloud-release"
runtime = json.loads(subprocess.check_output(
    [sys.executable, str(root / "scripts/package-runtime.py")], text=True))
destination.mkdir(parents=True, exist_ok=True)
inference = destination / "inference"
inference.mkdir(exist_ok=True)
for name in ("Dockerfile", "entrypoint.sh", "linux.lock.json", ".dockerignore"):
    source = root / "deploy/inference" / name
    if source.is_symlink():
        raise RuntimeError("Refuse linked build inputs")
    shutil.copyfile(source, inference / name)
shutil.copyfile(runtime["file"], destination / "runtime-source.tar.gz")
build = '''#!/bin/sh
set -eu
cd "$(dirname "$0")"
python3 - <<'PY'
import hashlib,json,pathlib
root=pathlib.Path('.')
manifest=json.loads((root/'build-inputs.json').read_text())
for name,expected in manifest['files'].items():
    data=(root/name).read_bytes()
    assert hashlib.sha256(data).hexdigest()==expected,name
print('Public build inputs verified')
PY
mkdir -p extracted
tar -xzf runtime-source.tar.gz -C extracted
docker build -f extracted/runtime/deploy/runtime/Dockerfile -t halo-runtime:candidate extracted/runtime
docker run --rm --network none --read-only --cap-drop ALL --security-opt no-new-privileges halo-runtime:candidate check
python3 - <<'PY'
import hashlib,json,pathlib,urllib.request
root=pathlib.Path('inference')
lock=json.loads((root/'linux.lock.json').read_text())['source']
target=root/'llama-source.tar.gz'
if not target.exists():
    with urllib.request.urlopen(lock['url'],timeout=120) as response:
        data=response.read(100_000_001)
    assert len(data)<=100_000_000,'Source archive exceeds limit'
    assert hashlib.sha256(data).hexdigest()==lock['sha256'],'Source checksum mismatch'
    target.write_bytes(data)
assert hashlib.sha256(target.read_bytes()).hexdigest()==lock['sha256'],'Source checksum mismatch'
PY
docker build -t halo-inference:cpu inference
docker run --rm --network none --read-only --cap-drop ALL --security-opt no-new-privileges halo-inference:cpu check-binary
docker build -t halo-inference:cuda --build-arg GPU=ON --build-arg CUDA_ARCH=89 --build-arg BUILD_IMAGE=nvidia/cuda@sha256:4b9ed5fa8361736996499f64ecebf25d4ec37ff56e4d11323ccde10aa36e0c43 --build-arg RUN_IMAGE=nvidia/cuda@sha256:828c4d878adcaa4265d80c95d8ec877149b49bb2419a4cf3bb6aa889bbb7ca2e inference
docker image inspect --format '{{.Id}}' halo-runtime:candidate halo-inference:cpu halo-inference:cuda > candidate-image-ids.txt
printf '%s\\n' 'Candidate builds complete. Real model/GPU acceptance is required before publishing.'
'''
(destination / "build-candidates.sh").write_text(build, encoding="utf-8", newline="\n")
names = ["runtime-source.tar.gz", "build-candidates.sh"] + [
    "inference/" + name for name in ("Dockerfile", "entrypoint.sh", "linux.lock.json", ".dockerignore")]
manifest = {"version": "halo.cloud-build-inputs.v1", "status": "staged-not-built-or-published",
            "runtimeSourceSha256": runtime["sourceSha256"],
            "files": {name: hashlib.sha256((destination/name).read_bytes()).hexdigest() for name in names}}
(destination / "build-inputs.json").write_text(json.dumps(manifest, indent=2)+"\n", encoding="utf-8")
print(json.dumps({"directory": str(destination), "files": len(names), "status": manifest["status"]}))
