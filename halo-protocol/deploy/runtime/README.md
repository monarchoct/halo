# Portable HALO runtime

This package moves the existing operator, small decision prover and read APIs into a Linux image. It does not deploy cloud resources or include chain fixtures, private keys, GPU model weights, database contents or browser profiles. The browser supervisor is a separate host service; never give this container a Docker socket.

## Build and verify

From the protocol source directory, run `python scripts/package-runtime.py`. The deterministic archive is written to the workspace's `work/linux-lab/runtime-source.tar.gz`. Transfer this public archive to a Linux builder, extract it, and run:

```sh
docker build --file runtime/deploy/runtime/Dockerfile --tag halo-runtime:reviewed runtime
docker image inspect --format '{{.Id}}' halo-runtime:reviewed
docker run --rm --network none --read-only --cap-drop ALL --security-opt no-new-privileges halo-runtime:reviewed check
```

The build uses pinned Node and Python base digests, npm lockfiles, and exact Python dependency versions. The startup verifies every included source/artifact against `runtime-source-manifest.json`. The `pk.key` inside the core release is a **public proving key**, not a wallet key. The package does not contain the full language model; workers call a separately hosted inference endpoint.

The artifact checksum manifest establishes release integrity when matched against a trusted release digest. It is not remote attestation. Python wheel hashes and a published signed registry release remain release-hardening work; exact version pins alone do not provide reproducible dependency bytes across every platform.

## Services

| Mode | Invocation after image name | Authority |
|---|---|---|
| Check | `check` | Local source checks only |
| API | `api /config/api.json` | Public chain reads; no upload or signing |
| Operations | `operations /config/operations.json` | Restricted PostgreSQL public views and registry reads |
| Operator | `operator /config/operator.json` | Dry-run by default |
| Execute | `operator /config/operator.json --execute` | Independent operator gas key; activated vault policies still apply |
| Proof benchmark | `proof-benchmark 100 2` | Public random inputs, CPU proofs and native verification; no network or transactions |

The API and operator modes refuse a local-chain deployment. Local chain helpers remain separate. Set `python` to `/usr/local/bin/python`, `directory` to `/state/work`, `operatorKeyFile` to `/run/secrets/operator.key`, and public-model `releaseFile` to `/opt/halo/models/proposal-qwen35-4b/release.json`. Public model backends require HTTPS outside loopback. Mount provider credentials only into the service that needs them.

API configuration is `{ "deploymentFile": "deployment.json", "host": "0.0.0.0", "port": 8787, "allowedOrigins": ["https://YOUR_HALO_DOMAIN"] }`. Operations uses the same origin/host fields, port 8796, `credentialEnvironment` and optional `caFile`. Install its restricted reader using `services/operations/install.mjs`; an administrative database account is rejected at service startup.

Prepare configuration directories and private environment/key files outside the source checkout. They must already exist; Compose will not silently create missing bind paths. Operator state must be owned by UID/GID 1000. Keep private files mode 0600, directories 0700. Never place a key in an API configuration directory. PostgreSQL 17 must use authenticated TLS; apply and verify the release migrations before starting workers.

`compose.yaml` starts only read services by default. Explicit `--profile execute` adds transaction execution. Its loopback ports require a separately configured HTTPS reverse proxy on the host. Set the `HALO_*` file-path variables named in the Compose file and a published `repository@sha256:...` image. Use a separate Compose project, unique gas key, state directory and configuration per operator. Do not use `--scale operator` with a shared signing key: durable per-key nonce coordination is not yet complete.

This Compose file is a runtime component, not the whole production platform. It does not provision TLS, PostgreSQL, replicated content storage, inference, desktop workers, telemetry or a cloud account. Production acceptance includes those systems and recovery on independent providers.

## CPU proof capacity

Create a dedicated UID-1000 state directory and run the reviewed image with `--network none --read-only --cap-drop ALL --security-opt no-new-privileges --pids-limit 128 --cpus 2 --memory 3g`, `/tmp` as a bounded tmpfs, and that directory mounted at `/state`. Invoke `proof-benchmark 100 2`.

It generates fresh commitments, exercises both permitted and rejected decision outputs, verifies each proof natively, and checks the exact 75 public inputs in Node. Results go to `/state/latest-proof-benchmark.json`. The benchmark does not submit transactions or establish 100-agent production capacity. Measure container memory externally; its reported Node RSS excludes Python children.
