# First hosted HALO agent: release and deployment gates

The approved ZenCloud deployment 1789340062335 is a one-hour connectivity test.
Its local health check passed; browser access to its ingress domain was blocked.
It carries no agent state or wallet. Do not reuse it as the production worker.

## Build and registry ownership

Run `python scripts/prepare-cloud-release.py` from the protocol project. This
stages an allowlisted public build bundle in workspace `work/cloud-release`.
It includes neither credentials nor model weights. Transfer only the listed
files to a trusted Linux amd64 Docker builder, then run `sh build-candidates.sh`.
The script verifies the staged inputs, downloads the pinned upstream source,
builds candidate runtime/CPU/CUDA images and records image IDs. It does not push
images, provision resources or turn on trading. Existing build directories must
not be shared with untrusted jobs.

The local Linux builder is currently unreachable. A successful staging run is
not a successful Docker build. The CUDA target requires model and authentication
acceptance on an Ada GPU (compute capability 8.9) before a release is approved.
The full acceptance checklist remains in `../inference/README.md`.

The owner currently has no GitHub or Docker Hub account. Create a GitHub account
at https://github.com/signup and complete email/password/verification privately.
Then supply the username. Registry destination will be
`ghcr.io/OWNER/halo-runtime` and `ghcr.io/OWNER/halo-inference` after ownership is
confirmed. Do not type registry credentials into chat or public SDL files.
Account creation alone does not upload any project source.

Publication must use a reviewed source context, successful acceptance evidence,
and immutable registry digests. A source checksum or Docker image ID alone does
not establish model correctness, tenant isolation, or production readiness.

## First deployment topology

1. One authenticated GPU inference service with the pinned model and two bounded
   inference slots. Persistent model cache, startup checksum, HTTPS gateway and
   bounded requests are mandatory. The raw inference API must not be public.
2. One CPU worker in dry-run mode, no signing key or real trading funds. Its
   proposal/evidence output must identify its hosted origin truthfully.
3. Database and read API with authenticated connections and separate roles.
   Add encrypted backups outside the hosting provider and prove restore.
4. One isolated browser workspace, then its authenticated screen relay. The
   existing supervisor needs a Docker host; ordinary Akash containers do not
   automatically supply one. Adapt the supervisor before deploying that layer.
5. Connect read APIs and relay through HTTPS to the website. Do not expose
   private social sessions, model keys or operator keys to frontend code.

Before creating paid leases, review actual bids, escrow, duration, persistent
volume costs and a hard spending allowance. The one-hour smoke-test approval
does not authorize GPU costs or recurring production deployments.

## Acceptance before scaling

- Real structured model proposals pass HALO schema validation.
- Missing keys/models, invalid authentication and exhausted queues fail safely.
- Dry-run worker publishes retrievable evidence with no transaction authority.
- Browser isolation and screen privacy survive concurrent sessions.
- Cost ledger separates cloud, inference, gas, revenue and trading capital.
- Worker and database recover from provider loss without duplicate actions.
- Independent provider tests and measured load precede public onboarding.

None of these gates may be represented as complete from the connectivity test.
