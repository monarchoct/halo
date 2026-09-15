# Local Linux acceptance host

This is a portable, disposable **development VM**, not an Akash deployment or an independently operated host. It exists to execute the Linux database and browser acceptance gates on the current Windows machine. Existing RPC, website, model and IPFS processes stay separate.

## Pinned inputs

- Ubuntu Noble cloud image, build `20260911`, with its published SHA-256.
- QEMU Windows `11.1.0`, installer build `20260811`, with the publisher's SHA-512. Extract the archive; do not run its system installer.
- 7-Zip `26.03` with GitHub release-asset digests, and pycdlib `1.20.0` with its PyPI digest.
- PostgreSQL `17.11` by immutable Docker image index in `postgres.compose.yaml`.
- Node `22.23.2` Linux x64 with the official distribution checksum.

`assets.lock.json` records exact download URLs and checksum sources. The QEMU/Ubuntu artifacts are test infrastructure, not a proposed production runtime release.

## Windows preparation

Run `node scripts/linux-lab/fetch.mjs` from the protocol directory. The script checks existing files and refuses mismatches or unfinished downloads; inspect the existing download process before retrying a partial file.

Extract `7z2603-x64.exe` using the downloaded `7zr.exe` into `work/linux-lab/7zip`. Use the extracted `7z.exe` to extract the QEMU installer into `work/linux-lab/qemu`. All `work` paths are relative to the outer HALO workspace, not the protocol directory.

Run `prepare-seed.py` with the bundled Python that provides `cryptography`. It imports the hash-verified pycdlib wheel directly and creates an individual client identity, a pinned server identity, and a NoCloud seed. Then run `protect-key.ps1` immediately: the client key is encrypted with Windows CurrentUser DPAPI and its plaintext file is removed.

The managed workspace's inherited ACLs cannot be tightened by this execution host and native OpenSSH rejects them. The lab client uses DPAPI-encrypted storage instead of retaining an unprotected client key. `ssh.ps1` decrypts into memory and passes the key through an anonymous pipe to the pinned `ssh2` client. It always verifies the precommitted server key. Install that client's dependencies with `npm ci --ignore-scripts --omit=optional` in this directory. No wallet key, social account credential or funded operator key belongs in the VM seed.

`start.ps1` creates a separate 40 GiB copy-on-write disk over the verified Ubuntu image. SSH binds only to `127.0.0.1:22240`; there is no public listener, shared host folder, graphical desktop or browser control port. It uses 8 GiB RAM and four CPUs with Windows Hypervisor Platform (WHPX). The Windows capability API and a separate VM probe confirmed WHPX was already usable; no Windows feature was enabled. QEMU holds an exclusive disk lock. Do not delete a disk or lock to start another writer.

The first multi-threaded TCG boot failed with a kernel APIC/timer panic, before any database was started. Its serial output is retained in `work/linux-lab/boot-mttcg-panic.log`. Instruction-counted, single-threaded TCG then booted successfully, but package preparation was slow. After a verified WHPX probe, the guest was shut down through systemd and booted from the same disk with hardware acceleration. That boot completed and the pinned Node runtime executed. `-Accelerator tcg` retains the two-CPU fallback. Neither local VM mode constitutes an independent hosting or cloud capacity test.

The intentional shutdown interrupted cloud-init package preparation. Its later `status: done` did not establish Docker availability. Finish or verify Docker with `install-docker.sh`; the package manager's signed repositories and actual daemon response are checked separately. Preserve the original setup log instead of treating the interrupted run as successful.

## Source transfer and acceptance

1. `pack.py` creates a small explicit source allowlist and SHA-256 manifest. It excludes `node_modules`, local test state, private keys, models and service data.
2. Use `ssh.ps1 -Operation put -Source <archive> -Destination /home/halo/source.tar.gz` and the pinned SSH client to unpack it into `/home/halo/lab` after cloud-init has completed.
3. Run `install-node.sh` and `install-docker.sh`, then prepend `/home/halo/lab/node/bin` to the command's PATH.
4. Run `accept-persistence.sh`. It verifies every source hash, creates a separately named Linux Docker database volume, runs the existing real-database concurrency tests, kills the actual database process, restarts the same container and verifies the saved database in a different postmaster process.
5. Retrieve only the selected public result JSON files and database log. Keep the VM volume and password private. The script refuses to overwrite an earlier acceptance result.

This setup does not repair or replace `work/postgres-data`, which contains the earlier failed native Windows drill. A successful VM run must be reported separately from GitHub CI, public testnet operation and independent hosting.

## Primary references

- [QEMU's Windows distribution entry](https://www.qemu.org/download/)
- [Windows binary publisher and checksums](https://qemu.weilnetz.de/w64/)
- [Ubuntu Noble image and published checksums](https://cloud-images.ubuntu.com/noble/20260911/)
- [QEMU instruction counting and timing limitations](https://www.qemu.org/docs/master/devel/tcg-icount.html)
- [NoCloud boot configuration](https://docs.cloud-init.io/en/latest/reference/datasources/nocloud.html)

## Actual browser and viewer acceptance

Run the existing trading-preview RPC/API first. Start `node scripts/dev-browser.mjs --trading` on Windows; it binds the new relay to 127.0.0.1:8795 and updates only deployment-trading.json. Preserve the original relay on 8792. Use `ssh.ps1 -Operation tunnel -Source '8547,8795'` to bind the matching ports only to guest loopback through the pinned SSH identity. The helper accepts that fixed RPC/relay pair, or a separate 8793 read-only artifact-gateway tunnel used by the social consumer. It exposes no arbitrary port mapping. The isolated browser cannot reach those listeners; its internal network and proxy remain separate.

Transfer the public deployment-trading.json to /home/halo/lab/protocol/test-results/browser-trading-deployment.json, together with the browser source, SDK, relay source, AgentRegistry artifact and test scripts. Never transfer the operator key or whole test-results directory. Install the root package dependencies, then build the browser Dockerfile and use its returned immutable image ID.

From the Linux protocol directory as UID 1000, run `node test/browser-live-observe.mjs <image-id> fomo --forward`. It creates a fresh execution directory, starts the trusted publisher outside the browser, confirms a competing publisher exits 75, runs the actual worker, verifies relay signatures/images and retains the agent-specific profile. `--fail-startup` injects a missing browser executable; acceptance requires failed/startup, two reports and zero images. `x --forward` exercises X independently; HTTP 403 currently fails observation and is not a passing X integration. Each command's exit status matters.

The observer is an operator-triggered diagnostic, not yet the decision-driven social queue. It creates no accounts, submits no posts and signs no financial transaction. A finished browser command removes its container/proxy/network, while preserving the private profile for future authorized onboarding. The relay stays available for website playback. Do not publish private profiles, delivery journals or the lab SSH files.


## Continuous model producer and database tunnel

The local native model/prover producer now shares the accepted Linux PostgreSQL scheduler with the social consumer. Start `ssh.ps1 -Operation database-tunnel -Source '54330:54329'` in a separate process. This operation accepts only that fixed mapping and listens on host loopback. From the protocol directory, `scripts/run-local-queued-model.ps1 -Agent <address> -Watch` captures the private acceptance database configuration through pinned SSH, maps the port and passes credentials only through the child process environment. It does not print or copy the database URL to public files. Do not start duplicate workers for an already-running agent/operator.

`test/model-social-pipeline.mjs <agent-address>` verifies the accepted fresh model launch, canonical payment, automatically generated social jobs, actual sandboxed browser outcomes, signed delivery and receipt publication evidence. Lyra's ARTEMIS acceptance passed five checks; separate persistence acceptance passed eighteen scenarios. Native inference and the Linux VM still share one PC. No independent host or authenticated social publication is claimed.
