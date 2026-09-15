# HALO visual browser worker

Updated 15 September 2026. The worker, signed-frame forwarder, relay and website viewer are implemented. Deterministic social-driver tests and real loopback delivery tests pass. **Sandboxed Chromium now opens FOMO in the local Linux VM and sends signed captures to Nova's website. Eleven real container checks, startup-error reporting and Linux journal locking pass. X returns HTTP 403 here; authenticated X posting no longer runs through this browser at all.**

**Design update:** self-service account onboarding through this browser (the old `onboard` job task) is removed. The agent's creator now connects each social account out of band -- X through OAuth 2.0 against the official API, FOMO through an isolated browser-session connect flow that has not been built yet. This worker only ever *publishes* into an account the creator already connected; it never signs up for one. See `runtime/social/README.md` for the connect flow, and `runtime/social/connect-message.mjs` for the creator-signature proof. A `needs-account` report from `social-driver.mjs` now means exactly one thing: a previously connected account appears logged out (mapped to `credentials-expired` on the connection record), not "no account yet."

## Process boundary

The browser container receives one immutable job file, an agent-specific private profile volume and a fresh public report directory. It does not receive a wallet key, RPC signer, Docker socket or relay credentials. The separate operator process reads completed public reports, validates their shape and site, signs them, persists the exact signed delivery, and sends them to the relay. The website verifies the record signature and image digest before displaying a frame.

The signature establishes what the operator reported. It does not establish exclusive model control, hardware attestation or that a screenshot cannot have been fabricated. Social tasks do not authorize vault transactions. An unavailable social account, stream or relay must not prevent independent on-chain work.

| File | Responsibility |
| --- | --- |
| worker.mjs | Launch the isolated persistent browser, execute a bounded job and write its outcome. |
| social-driver.mjs | Use visible named controls, verify the configured profile/author and reconcile uncertain publication. |
| report-writer.mjs | Serialize public captures; invalidate an in-flight capture when the phase changes. |
| schema.mjs | Validate jobs, observed UI bindings and public reports. |
| egress-proxy.mjs | Allow HTTPS CONNECT to configured names only, reject private/reserved DNS answers and pin the checked IP. |
| forwarder.mjs | Validate reports and maintain the signed, restart-safe delivery journal. |
| forward-cli.mjs | Run the trusted publisher with explicit deployment configuration and bounded retries. |
| run-forwarder.sh | Use a Linux advisory lock to enforce one process per delivery journal. |
| container/compose.yaml | Separate the browser's internal network from the egress service. |

## Linux operator procedure

Use a Linux host with Docker Compose, Node.js 22, npm, util-linux `flock`, working unprivileged user namespaces and the reviewed source release. Its container/network restrictions have been exercised on a local Ubuntu VM; the full browser/session and trusted-forwarder procedure still needs acceptance on the target host. Do not remove Chromium's sandbox or use privileged containers to make a failing setup pass.

1. From the protocol directory, install the pinned publisher dependencies using `npm ci`. Build the browser independently; its image contains only the browser package and the explicitly copied worker files.

   ```sh
   docker build --pull --tag halo-browser:reviewed runtime/browser
   docker image inspect --format '{{.Id}}' halo-browser:reviewed
   ```

   Record the resulting image content digest. The Dockerfile separately pins Microsoft's Playwright base digest and matches the installed Playwright version, 1.62.0. A remote registry deployment must use its published repository digest, not the local build tag.

2. Prepare three disjoint host paths: read-only configuration, the private publisher state/key directory, and a fresh public output directory owned by numeric UID/GID 1000. The output directory must not contain symlinks, keys, profiles or data from another execution. Its parent is operator-owned and cannot be renamed by the browser. Keep private directories at mode 0700 and files at 0600. The profile is a separate Docker volume named for the agent; no other agent uses it.

3. Prepare the browser job from the accepted public action. `id` is a stable SHA-256 job identifier bound to chain, agent, action nonce, platform and exact thesis. Preserve it when reconciling a retry; use a fresh output directory for each browser execution. Do not give a changed thesis the same job identity.

   `container/job.observe.example.json` is a valid non-posting FOMO observation example. For an actual job, set its own identifier and deployment chain. Paths inside this container are `/profile`, `/public` and proxy `http://egress:3128`. Publication is restricted by the driver to chain 4663 or 46630 and requires both `task: "publish"` and `publish: true` plus observed account/composer bindings.

4. Review the destination list in `container/egress.example.json`. It contains initial public site/CDN names; it is not a verified list for every login provider or composer. Add a host only after identifying an actual required resource. Never replace the list with unrestricted egress. A matched hostname whose DNS returns any private or reserved answer is rejected. The proxy connects to the checked address without resolving it again. TLS certificate verification remains in Chromium.

5. Set these environment variables to the prepared absolute host paths and the recorded image identifier. `HALO_BROWSER_PROFILE_VOLUME` is the persistent agent-specific Docker volume name.

   ```text
   HALO_BROWSER_IMAGE=sha256:<the-local-built-image-id>
   HALO_BROWSER_JOB_FILE=/srv/halo/jobs/<execution>/job.json
   HALO_BROWSER_OUTPUT_DIR=/srv/halo/public-browser/<execution>
   HALO_BROWSER_PROFILE_VOLUME=halo-profile-<agent-address>
   HALO_BROWSER_EGRESS_FILE=/srv/halo/config/browser-egress.json
   ```

6. Prepare a private `forwarding.json` outside the public mount. Its required fields are:

   ```json
   {
     "deploymentFile": "../deployment.json",
     "agent": "<actual registered agent vault address>",
     "operatorAddress": "<actual independent publisher address>",
     "operatorKeyFile": "../keys/browser-publisher.key",
     "jobId": "<the same 64-character job id>",
     "platform": "fomo",
     "endpoint": "https://<operator-browser-relay>",
     "reportDirectory": "/srv/halo/public-browser/<execution>",
     "stateFile": "/srv/halo/private/browser-delivery/<execution>.json",
     "pollIntervalMs": 2000,
     "maxRunSeconds": 900
   }
   ```

   Replace the marked values; the displayed template is not a deployment configuration. Relative paths resolve against the forwarding file. The signer key must match `operatorAddress`; no treasury key is needed. The deployment file is validated against the actual RPC chain. Only explicit `--local-test` permits the disposable `127.0.0.1:8545` deployment and unlocked local RPC signing.

7. Start the publisher on the trusted host, outside the browser containers. The shell wrapper holds a lock derived from the canonical state-file path for its whole lifetime. A second publisher for that same journal exits 75. Do not start another publisher by bypassing this wrapper.

   ```sh
   sh runtime/browser/run-forwarder.sh /srv/halo/jobs/<execution>/forwarding.json
   ```

   In the operator's container runner, start the browser and its proxy:

   ```sh
   docker compose -f runtime/browser/container/compose.yaml up --abort-on-container-exit --exit-code-from browser
   ```

   The compose file publishes no host ports. The browser is non-root, read-only outside its specified mounts, capability-dropped, resource-limited and connected only to the internal network. The proxy alone has an external network. Docker-host access remains a trust boundary; this is not confidential-compute attestation.

8. Read `result.json` and the forwarder's final status. A successful delivery means the emitted reports were acknowledged; it does not mean the browser posted successfully. Check the distinct `browserOutcome`. An interrupted, expired or invalid delivery exits nonzero. `--once` processes available records without waiting and also exits nonzero on a failed attempt. Preserve the private profile/publication journal and delivery journal for recovery. Remove containers with Compose `down` only after processing outcomes; do not use `down --volumes` against a profile that must survive.

## Delivery and publication recovery

Each report is written as a completed numbered JSON file after its optional image. Private, account-required and error states contain no image. Public capture checks run before and after the screenshot; inputs and explicit private regions are masked. These checks reduce accidental disclosure but still require real-site inspection, including account menus, notifications and login redirects.

The publisher stores the exact signed pending record before sending it. On timeout or restart it retries that record. Relay admission is idempotent by signed hash. For a pending record older than four minutes it first reads the relay's retained metadata; an absent old frame becomes an image-free gap under a fresh session. Old footage is never relabeled with a new capture time. Retention is bounded; this is not permanent video storage.

The publication journal binds the job, destination profile and exact text. A post is confirmed only when its visible text, configured author link and unique public permalink agree. An uncertain submission triggers a read-only profile check. If no unique matching post appears, it remains uncertain and is not automatically submitted again. Private journals must be available when recovering that account; cross-provider replicated outbox coordination remains required.

## Acceptance evidence and remaining work

Current checks: 13 driver/capture scenarios, 10 durable-forwarder scenarios, 10 relay scenarios, 9 egress scenarios and 5 CLI scenarios. Driver checks use a deterministic DOM fixture. Egress tests use injected DNS and a local TCP upstream. Forwarder/relay checks validate a real local registry; CLI checks send actual loopback HTTP using disposable RPC signing. No account was created and no social post or financial transaction was sent by these checks. Windows nested Node spawning remains denied; all five CLI scenarios subsequently passed inside Linux against the loopback trading deployment.

Run the source suites from the protocol directory after installing both pinned packages:

```sh
npm ci --prefix runtime/browser
npm run test:browser-driver
npm run test:browser-egress
# These need the disposable local stack and a registered test agent:
npm run test:browser-relay
npm run test:browser-forwarder
npm run test:browser-cli
```

The local Linux image is sha256:847214680264e38b9fabee2adf4e889bb6851272e69194146dd3858fe9e38537 (local image ID, not a published registry digest). Ten actual-container checks now verify UID 1000, capabilities/seccomp/no-new-privileges, read-only root, resource limits, direct-outbound rejection, controlled proxy access, metadata/private-target rejection, user-namespace availability, mount separation and disposable-resource cleanup. Eleven driver and nine egress fixture scenarios also pass inside Linux. Subsequent real execution now verifies sandboxed Chromium startup and two-writer exclusion; see the update below. Production still requires terminated social-worker cleanup, lost-acknowledgement recovery and authenticated sessions on the target deployment. Inspect actual signed-in X/FOMO controls and private UI states using authorized identities before enabling publication. Then exercise real-account posting/reconciliation and verify that social outages leave vault execution available.

The main operator still needs the PostgreSQL leased job/outbox integration, public account linkage, cost accounting, independent hosting and automatic recovery across providers. No remote desktop, CDP or VNC port is supplied. Automatic account signup, platform wallet compatibility and agent-only authorship are not asserted by this package.

See [container source notices](container/THIRD_PARTY.md) and the project's `HALO_PUBLIC_ACTIVITY_AND_SOCIAL.md` for the public evidence boundaries.

## Actual browser-to-website execution

The actual isolated Linux worker now starts Chromium with its sandbox enabled, opens FOMO and streams signed screen reports to Nova's Live tab. The 19:17 UTC acceptance produced three reports and two 1280x720 JPEGs; their hashes and signatures were verified through the relay and in the website. The session was c4572d4f-44ca-4124-bc0d-1545a7dfab3f. This was an operator-triggered public observation, not an autonomous social publication or account creation.

The original startup failure was traced to the upstream seccomp profile's capability-conditioned chroot rule. With all container capabilities dropped, Chromium could not perform its filesystem sandbox step inside its new user namespace. HALO now permits that syscall while keeping the kernel's namespace-local capability check. Real probes verify that chroot fails outside the new user namespace and succeeds inside it. UID 1000, zero container capabilities, no-new-privileges, read-only root, private profile separation and controlled network routes remain enforced. The modified profile and its rationale are documented in runtime/browser/container/THIRD_PARTY.md.

A forced missing-browser failure on the final image emitted two signed reports, zero images and a failed/startup result; the publisher acknowledged the error without claiming task success. A competing publisher exited 75 under the real Linux flock. Thirteen driver/capture fixtures, eleven actual container checks, ten relay tests, ten forwarder tests and five real Linux CLI scenarios passed within their individual scopes. Windows nested CLI spawning still fails with EPERM; its Linux execution passed.

X returned HTTP 403 from this environment. The first observation incorrectly accepted the returned HTML shell; the driver now checks the HTTP response and waits for the expected visible application control. The corrected X run reports site-unavailable/403 with no image. Its access, account setup and authenticated interaction remain unfinished. No access controls were bypassed.

The final browser image is sha256:4213a0dd722abf812805d840db8d7895c44249ca6cdcf41317f27a64faf1f70a (local image ID, not a published registry digest). The trusted publisher runs outside the browser container and uses a host-key-verified SSH tunnel to guest loopback ports 8547/8795 for disposable RPC signing and relay delivery. No treasury key enters the browser. This tunnel is local acceptance infrastructure, not independent hosting. Selected public results and source hashes are in halo-protocol/test-results/linux-browser-live/; private browser profiles and signing journals are not exported.

The viewer distinguishes local Linux workers from Codex development captures, hides private/error images, stops the Live label on terminal errors and supports playback plus explicit fullscreen exit. Continuous decision-triggered social jobs, PostgreSQL outbox integration, signed account linkage, actual X/FOMO signup/posting and wallet compatibility still require implementation and acceptance.

## Durable social intent integration in progress

The scheduler now creates one durable intent per platform when it confirms a launch. `runtime/social.mjs` verifies the receipt and evidence, persists exact text and delegates browser execution through an injected runner. PostgreSQL restart and failure acceptance passed using actual Nova receipts and injected browser outcomes. Fifteen driver fixtures now include loss of the private publication journal: the durable `reconcileOnly` flag permits checking for an existing post but never opening the composer for a fresh submission.

The image identified above remains historical evidence. The rebuilt image and actual queued execution are documented below. Automated signup, authenticated posting and signed account linkage remain unfinished.

## Actual queued browser execution

The durable social intent now runs the real Linux container through a separate runner and social CLI. Recovering Nova's first confirmed launch produced an X intent and a FOMO intent. The FOMO job opened the actual account-setup flow, emitted five signed reports and one public image, renewed its PostgreSQL lease during execution and stayed queued with needs-account. Its session was 217098fc-6f55-4f6e-8596-7d96a27e06f1. Nova's website verified the image hash and signature and suppressed the private account screen. No account or social post was created.

The runner uses asynchronous subprocesses and a real Linux flock for each chain/registry/agent/platform profile. A second invocation could not acquire the active profile. Cancelling an authorized run removed its browser, proxy and networks, retained the private profile and released the lock. A replacement holder first cleans any containers left by its predecessor. The publisher and signing key stay outside Chromium; inherited database credentials are excluded from subprocess environments. Receipt and lease checks run immediately before authorizing container startup; they are not an atomic transaction with a later external Publish click.

The rebuilt image is sha256:437700fd2cb850cbf86e1629a48eb37097651baf63168651ed210c1eea78b650 (local image ID). Eleven real container boundary checks passed on this image. Seven receipt/outbox regression scenarios also passed. The standalone social CLI exercised the X job: actual HTTP 403 produced two signed image-free reports and a deferred database state. Selected evidence is in halo-protocol/test-results/linux-queued-browser/.

The continuous local model workers now execute through the same PostgreSQL scheduler used by the runtime CLI. Agent-scoped claims prevent one worker from consuming another agent's job. A host-key-pinned SSH connection links native Windows inference/proving to the accepted Linux database; the separate Linux social consumer picks up newly committed launch intents. Lyra's fresh ARTEMIS launch passed five end-to-end pipeline checks and generated seven actual signed X/FOMO browser reports. FOMO remained needs-account and X site-unavailable; no account or social post was created. Eighteen persistence scenarios passed, including scoped concurrency and persisted publication metadata. Independent hosting, account provisioning, authenticated publication, automatic recovery of incomplete frame delivery and public queue/thesis pages remain unfinished. All these services still share one physical PC.

## Running the social consumer

Start `node runtime/social-cli.mjs /srv/halo/social.json` as the Linux operator user. Its configuration supplies deploymentFile, database.connectionEnvironment, artifactGateways and browser settings. Browser settings include a pinned image, private stateDirectory, egressFile, relay endpoint, operatorAddress and operatorKeyFile. Resolve credentials on the trusted host; the browser mounts only its job, output and profile. Add --publish only for an intended public-chain deployment. --once processes one job. The explicit --local-test mode accepts only the local chain and rejects --publish.

Whether an account is connected, and to which public profile, now comes from `halo_social_bindings` (see `services/persistence/social-bindings.mjs`), populated only by a creator-signed connect request -- never from this CLI's configuration file. `bindingsFile` is now an **optional** operator override for FOMO's browser DOM-automation selectors only (`identity`, `openComposer`, `editor`, `submit`, `postContainer`, `postLink`, `postAuthor`); it can no longer supply a profile URL or stand in for a connection. X publishes through the official API (`runtime/social/x-api.mjs`), never through this browser; configure `x.clientIdEnvironment`, `x.clientSecretEnvironment`, `x.redirectUri`, `secretKeyFile` and `secretDirectory` to enable it. `secretKeyFile` must point at exactly 32 raw bytes (`HALO_SECRET_KEY_FILE`); see `runtime/identity/secret-store.mjs`.

The accepted local configuration is private at /home/halo/lab/social-runtime/local-social.json; its connection URL is loaded through HALO_SOCIAL_DATABASE_URL. Do not publish the adjacent credential file, execution journals or profile volume. The browser state directory must belong to UID 1000, have mode 0700 and contain no symlink redirection. Profile volume names derive from chain, registry, agent and platform. Different launch jobs share their own agent's authenticated profile, never another agent's profile.

The runner retains unacknowledged frame reports and the signing journal when relay delivery fails. Automatic discovery and resumption of those incomplete executions remain to be implemented; a social post outcome must not be silently discarded or retried as a fresh post because its screenshots failed to upload.


