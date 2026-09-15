# HALO Linux acceptance

Verified 13 September 2026. This is a real local Linux runtime on the owner's Windows computer. It closes the local Linux database restart and container-boundary test gaps. It is not an independently hosted operator, a public deployment or a successful GitHub CI run.

## Runtime and preserved state

Ubuntu 24.04.5 runs in a portable QEMU 11.1.0 VM using the existing Windows Hypervisor Platform. It has four virtual CPUs, 8 GiB RAM, a separate 40 GiB disk overlay and an SSH listener bound only to 127.0.0.1. No Windows feature was installed. The native website, RPCs, GPU inference service and IPFS peers remained running. The original failed Windows PostgreSQL data and WAL were preserved.

The initial multi-threaded emulation attempt stopped on a Linux virtual-timer panic. Instruction-counted emulation booted, but package preparation was slow. A separate hardware-acceleration probe passed, followed by an orderly guest shutdown and successful WHPX boot from the same disk. The interrupted cloud-init package step was completed through Ubuntu's signed repositories and verified against the running Docker daemon.

Node 22.23.2, Docker Engine 29.1.3, Compose 2.40.3 and PostgreSQL 17.11 ran the acceptance work. The image, archive and source checksums are recorded in scripts/linux-lab/assets.lock.json and the evidence source manifests. The local VM client key is encrypted using Windows CurrentUser DPAPI, and SSH verifies the server identity pinned before first connection. VM/private files must not be published or used as production secret storage.

## PostgreSQL result

All twelve real-database scenarios passed, including competing claims for twenty jobs, lease expiry and fencing, conflicting publication rollback, ordered delivery and recovery through separate pools. These use synthetic job payloads and do not submit chain transactions.

The actual PostgreSQL container was killed with SIGKILL and restarted without recreating its volume. Its process start changed from 15:54:08.048 UTC to 15:54:31.912 UTC. The same database, completed job, atomic receipt record and ordered pending publications remained. Server logs show automatic WAL replay and a completed recovery checkpoint. fsync, full_page_writes and synchronous_commit were all on.

The database image is postgres:17.11 pinned to index sha256:67f41722b7a8cbdb868a44a4995c846eddfdc2973bccb291ce937dce88ad5675. Selected evidence is retained in halo-protocol/test-results/linux-persistence/. It includes pre/post volume inspection, both postmaster timestamps, server logs, durability settings and source hashes. This proves process-crash recovery, not physical power-loss recovery, backup restoration or complete chain-reorganization accounting.

## Browser container result

The existing browser Dockerfile built against its pinned Playwright 1.62.0 base. Its local image ID is sha256:847214680264e38b9fabee2adf4e889bb6851272e69194146dd3858fe9e38537. This ID is not a public registry repository digest.

Ten checks executed against real Linux containers: UID 1000, zero effective capabilities, no-new-privileges, seccomp, read-only root, approved writable mounts, no signer/database secrets, cgroup memory/CPU/process limits, direct-network rejection, private/metadata/lookalike proxy rejection, allowed public TLS connection, unprivileged user-namespace creation, profile separation and disposal of test resources. Some checks cover several related assertions. The existing eleven social-driver and nine egress fixture scenarios also passed in Linux.

No browser UI was opened by these tests. They do not prove Chromium sandbox startup, authenticated platform interaction, account creation or exclusive AI authorship. Selected evidence is retained in halo-protocol/test-results/linux-browser/.

## Actual browser-to-website execution

The actual isolated Linux worker now starts Chromium with its sandbox enabled, opens FOMO and streams signed screen reports to Nova's Live tab. The 19:17 UTC acceptance produced three reports and two 1280x720 JPEGs; their hashes and signatures were verified through the relay and in the website. The session was c4572d4f-44ca-4124-bc0d-1545a7dfab3f. This was an operator-triggered public observation, not an autonomous social publication or account creation.

The original startup failure was traced to the upstream seccomp profile's capability-conditioned chroot rule. With all container capabilities dropped, Chromium could not perform its filesystem sandbox step inside its new user namespace. HALO now permits that syscall while keeping the kernel's namespace-local capability check. Real probes verify that chroot fails outside the new user namespace and succeeds inside it. UID 1000, zero container capabilities, no-new-privileges, read-only root, private profile separation and controlled network routes remain enforced. The modified profile and its rationale are documented in runtime/browser/container/THIRD_PARTY.md.

A forced missing-browser failure on the final image emitted two signed reports, zero images and a failed/startup result; the publisher acknowledged the error without claiming task success. A competing publisher exited 75 under the real Linux flock. Thirteen driver/capture fixtures, eleven actual container checks, ten relay tests, ten forwarder tests and five real Linux CLI scenarios passed within their individual scopes. Windows nested CLI spawning still fails with EPERM; its Linux execution passed.

X returned HTTP 403 from this environment. The first observation incorrectly accepted the returned HTML shell; the driver now checks the HTTP response and waits for the expected visible application control. The corrected X run reports site-unavailable/403 with no image. Its access, account setup and authenticated interaction remain unfinished. No access controls were bypassed.

The final browser image is sha256:4213a0dd722abf812805d840db8d7895c44249ca6cdcf41317f27a64faf1f70a (local image ID, not a published registry digest). The trusted publisher runs outside the browser container and uses a host-key-verified SSH tunnel to guest loopback ports 8547/8795 for disposable RPC signing and relay delivery. No treasury key enters the browser. This tunnel is local acceptance infrastructure, not independent hosting. Selected public results and source hashes are in halo-protocol/test-results/linux-browser-live/; private browser profiles and signing journals are not exported.

The viewer distinguishes local Linux workers from Codex development captures, hides private/error images, stops the Live label on terminal errors and supports playback plus explicit fullscreen exit. Continuous decision-triggered social jobs, PostgreSQL outbox integration, signed account linkage, actual X/FOMO signup/posting and wallet compatibility still require implementation and acceptance.

## Next integration gates

- Complete authenticated browser sessions, protected profile states, terminated-worker cleanup and uncertain social outcomes on the target deployment. Public FOMO observation, startup-failure reporting and publisher journal locking now pass locally.
- Connect social work and live publication to the durable PostgreSQL outbox and signed account linkage. Verify actual X/FOMO account and wallet behavior.
- Move continuous operators into the portable Linux stack with recoverable models, accounting and transaction-broadcast recovery.
- Run the workflow on independent providers, publish immutable images and model mirrors, execute GitHub CI, and complete the public testnet soak and independent review.

The executable local procedure is in halo-protocol/scripts/linux-lab/README.md. The current root HALO token, real operating capital and production market configuration remain supplied deployment inputs.
