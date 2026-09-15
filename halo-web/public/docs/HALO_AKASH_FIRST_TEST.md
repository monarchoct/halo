# HALO — First Akash test

Updated 14 September 2026. Account onboarding is complete and the Console dashboard showed $1 in trial credit and zero active deployments.

## Prepared deployment

- Name: `halo-cloud-smoke-test`
- Purpose: public HTTP connectivity and container startup test only; no model, agent, wallet, credentials or trading authority.
- Image: `node:22.23.2-bookworm-slim@sha256:83f487e0a63425e5b4d146fb5e5be574bcbe1b7b843d3ebafdd95eaf7767a7e5`
- Resources: 0.5 vCPU, 512 MiB RAM, 1 GiB ephemeral storage; no GPU.
- Command: Node HTTP server returning test identity and process uptime as JSON at `/` and `/healthz`.
- Routing: container port 8080 exposed as HTTP port 80.
- Selected provider quote: ZenCloud, `provider.zencloud.eu`, EU west, $1.27/month. Console reported 100% uptime over the preceding seven days; this is not a guarantee.
- Runtime limit: enabled, one hour.
- Console escrow: approximately $0.50 of the trial credit, leaving approximately $0.50 available. Escrow is distinct from actual usage; the one-hour prorated hosting estimate is approximately $0.002, rounded to $0.00 in the Console.
- User approved the bounded trial deployment. Confirm and deploy succeeded; Console reports Running with runtime limit 1h. Deployment ID: 1789340062335.

## Remaining acceptance

1. Completed: user approval and deployment creation.
2. Completed: provider events report successful pinned-image pull and container startup. Console Shell loopback health request returned HTTP 200 with the expected service identity, status ok and uptimeSeconds 55. This verifies startup command execution.
3. Pending: external ingress verification. Both HTTP and HTTPS navigation to the provider ingress domain were blocked by the browser client. No security bypass was attempted. Loopback health does not establish external reachability.
4. Verify the lease closes at its configured runtime limit and record actual cost.
5. Complete and publish HALO runtime/inference images, then prepare the real agent deployment separately.

This test does not move the HALO website or any agent off the founder's PC. No card purchase, GPU deployment, public production deployment or agent execution has occurred in this setup step.

Console: https://console.akash.network/deployments/1789340062335
Provider-issued hostname: 1td3tlcvolcoh174qs7u0gakoc.ingress.zencloud.eu
Automatic closure is configured but has not yet been observed; final billed usage remains unverified.

