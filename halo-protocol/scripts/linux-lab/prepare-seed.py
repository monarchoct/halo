"""Create a private NoCloud seed and pinned SSH identities for the acceptance VM."""
import hashlib
import io
import json
import sys
from pathlib import Path

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

here = Path(__file__).resolve().parent
lab = here.parents[3] / "work" / "linux-lab"
private = lab / "private"
private.mkdir(parents=True, exist_ok=True)
if (private / "seed.iso").exists():
    raise SystemExit("Seed already exists; preserve its identity and encrypted client key")
wheel = lab / "assets" / "pycdlib-1.20.0-py2.py3-none-any.whl"
assert hashlib.sha256(wheel.read_bytes()).hexdigest() == "cb675959dd6d61e94f02560ed7e9a5d368a3188b5f7f31813bc25a750cff0863"
sys.path.insert(0, str(wheel))
import pycdlib

def identity(name):
    target = private / name
    if target.exists():
        key = serialization.load_ssh_private_key(target.read_bytes(), password=None)
    else:
        key = Ed25519PrivateKey.generate()
        with target.open("xb") as file:
            file.write(key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.OpenSSH, serialization.NoEncryption()))
    return target.read_text(), key.public_key().public_bytes(serialization.Encoding.OpenSSH, serialization.PublicFormat.OpenSSH).decode()

_, client_public = identity("id_ed25519")
host_private, host_public = identity("ssh_host_ed25519_key")
(private / "known_hosts").write_text(f"[127.0.0.1]:22240 {host_public}\n", encoding="ascii")
config = {
    "hostname": "halo-linux-lab",
    "manage_etc_hosts": True,
    "users": [{"name": "halo", "lock_passwd": True, "shell": "/bin/bash", "sudo": "ALL=(ALL) NOPASSWD:ALL", "ssh_authorized_keys": [client_public]}],
    "disable_root": True,
    "ssh_pwauth": False,
    "ssh_deletekeys": True,
    "ssh_keys": {"ed25519_private": host_private, "ed25519_public": host_public},
    "package_update": True,
    "package_upgrade": False,
    "packages": ["docker.io", "docker-compose-v2", "curl", "ca-certificates"],
    "runcmd": [["systemctl", "enable", "--now", "docker"], ["mkdir", "-p", "/home/halo/lab"], ["chown", "halo:halo", "/home/halo/lab"]],
    "final_message": "HALO Linux acceptance VM initialized. This is a local development host.",
}
documents = {
    "user-data": "#cloud-config\n" + json.dumps(config, indent=2) + "\n",
    "meta-data": json.dumps({"instance-id": "halo-linux-lab-noble-20260911-v1", "local-hostname": "halo-linux-lab"}) + "\n",
}
seed = private / "seed.iso"
if seed.exists():
    raise SystemExit("Seed already exists; preserve the running VM identity instead of overwriting it")
iso = pycdlib.PyCdlib()
iso.new(interchange_level=3, joliet=3, rock_ridge="1.09", vol_ident="cidata")
buffers = []
for name, value in documents.items():
    data = value.encode()
    stream = io.BytesIO(data)
    buffers.append(stream)
    iso.add_fp(stream, len(data), iso_path="/" + name.replace("-", "_").upper() + ";1", rr_name=name, joliet_path="/" + name)
iso.write(str(seed))
iso.close()
print("Private seed generated; SSH host key pinned before first connection. No keys printed.")
