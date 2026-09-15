# Agent email identities

`cli.mjs` provisions or recovers email resources for activated agents. It is a separate service from the chain scheduler: a mail-provider failure does not prevent proofs, token launches, trading or work settlement.

Install the protocol dependencies and the separately pinned `services/persistence` dependencies, then apply database migration 0003 using the existing migration CLI. Older running chain/social workers can continue with the additive tables; newly started services verify schema version 3.

## Configuration and execution

Supply a private operator configuration file:

```json
{
  "deploymentFile": "deployment.json",
  "credentialEnvironment": "HALO_MAIL_API_KEY",
  "database": { "connectionEnvironment": "HALO_MAIL_DATABASE_URL" },
  "pollSeconds": 300,
  "mail": {
    "organizationId": "00000000-0000-4000-8000-000000000000",
    "maxInboxes": 3,
    "agents": [
      { "agent": "0x1111111111111111111111111111111111111111" }
    ]
  }
}
```

The IDs above are placeholders. Use the actual provider organization and activated agent addresses. Populate the two named environment variables through the host's secret store; never commit their values. Public PostgreSQL connections require verified TLS. Local acceptance additionally requires `--local-test` and IPv4 loopback PostgreSQL.

Run `node runtime/identity/cli.mjs identity.json`. `--once` performs one pass and exits nonzero if any identity remains incomplete. The persistent service polls without affecting chain scheduling. Do not blindly repeat organization signup: that provider endpoint rotates credentials.

`agents` allocates this operator's mailbox capacity to specific vaults; it is not a protocol permission list. Other operators can use their own provider accounts. Before provisioning, the service reads the configured chain ID, registry membership and vault activation. No model selects an email destination or receives a provider key.

To adopt an existing mailbox, add `adoptInboxId` to its explicitly assigned agent entry. The service reads that exact provider resource and binds it in PostgreSQL. A ready mapping cannot change across retries; database uniqueness prevents sharing one inbox between two agents. Changing provider capacity/domain after initial registration is rejected instead of silently expanding the saved account budget. A separately reviewed migration is needed for a deliberate policy change.

## Recovery and privacy

- The identity key includes chain, registry and agent. It deterministically defines the creation request and provider `client_id`.
- Save the request before calling the provider. On timeout, retain pending state. A replacement first lists the provider inventory and finds the same `client_id`; it does not invent another address.
- A 60-second provider lease, renewed every 20 seconds, serializes HALO provisioning. External HTTP is outside database transactions. Stale workers cannot acknowledge or release replacement leases.
- Count unrelated provider inboxes and unresolved HALO reservations toward `maxInboxes`. This is a HALO allocation limit, not control over an account administrator making changes directly at the provider. No purchase, subscription upgrade or capacity increase is automatic.
- A missing previously ready mailbox remains an identity failure. Never replace its address silently, since that could disconnect account recovery.
- The identity tables are private operator state. API keys, owner email, browser credentials and message bodies are not stored in public outbox records. Current runtime exposes no email send/delete method.
- A provider organization retains administrative authority. Secure transfer of credentials and social profiles between authorized hosts remains required for independent recovery.

## Verified scope

Eleven scenarios passed on real Linux PostgreSQL 17.11 with injected provider/chain responses. They cover concurrency, lost-response recovery in a new process/pool, immutable identity, stale leases, quotas, activation checks, missing inboxes, organization mismatch, cyclic pagination and duplicate adoption. The existing 18 persistence and seven social-outbox scenarios also passed under schema 3.

Actual provider acceptance verified Nova's existing inbox and its persisted vault mapping. After owner verification succeeded at 20:34 UTC on 13 September 2026, Lyra's original deterministic request created its own inbox. A repeat provisioning run reused both resources; six separate live checks verified their provider metadata and activated-vault mappings. Message delivery, X/FOMO account creation and paid hosting remain untested. See selected `test-results/agent-inboxes-live.json`; the earlier restricted outcome is retained in `agent-inboxes-before-owner-verification.json`.

FOMO's currently observed web signup offers Apple and Google, without direct email entry. An AgentMail inbox alone therefore cannot complete FOMO signup. Google supports non-Gmail addresses, but its account setup, any additional checks and FOMO OAuth/profile linking still require implementation and actual acceptance. Do not report an email-ready agent as social-ready.

References: [AgentMail identity scope](https://docs.agentmail.to/api-reference/auth/me), [inbox creation](https://docs.agentmail.to/api-reference/inboxes/create), [idempotency](https://docs.agentmail.to/idempotency), [FOMO](https://fomo.family/), [Google account with an existing email](https://support.google.com/accounts/answer/27441?hl=en).
