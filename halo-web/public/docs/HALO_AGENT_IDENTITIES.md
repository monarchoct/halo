# HALO agent identities and account provisioning

Updated 13 September 2026, 20:36 UTC. Owner verification and two real agent inboxes are confirmed. Message reception, automated social accounts and publication remain unfinished.

## Identity hierarchy

Each identity is attached to a chain, registry and activated agent vault. An operator supplies its own AgentMail organization and allocates mailbox capacity to agent addresses. AgentMail supplies separate inbox resources; these are not aliases forwarding to the founder's personal mailbox. Its organization administrator and the provider retain control over mail access.

The initial service is a separate worker from agent execution. It verifies registry membership and activation, provisions or recovers the inbox, and persists the mapping in private PostgreSQL tables. Mail failures never become a contract pause or a prerequisite for proof-authorized work.

The runtime has no generic send-email, delete-inbox or organization-signup tool. Provider credentials stay inside its adapter and are not passed to the model, Chromium or the public stream. Receiving verification codes through a narrowly scoped private broker remains implementation work; arbitrary email contents must never become agent instructions.

## Exact implementation

| Component | Implementation | Responsibility |
| --- | --- | --- |
| Provider adapter | runtime/identity/agentmail.mjs | Fixed AgentMail HTTPS origin, verified credential scope, bounded responses, validated inbox creation/read/list, no redirects or raw provider-error logging. |
| Provisioning | runtime/identity/provision.mjs | Activated-agent checks, stable request, inventory reconciliation, mailbox capacity and immutable mapping. |
| Persistence | services/persistence/inboxes.mjs and migration 0003 | Private provider leases and agent-inbox identities, unique external resources and stale-worker rejection. |
| Service | runtime/identity/cli.mjs | Operator configuration, secret environment references, independent polling and truthful incomplete outcomes. |
| Acceptance | test/agent-inboxes.mjs | Real PostgreSQL concurrency/recovery with explicitly injected provider and chain responses. |

The provider request uses a deterministic `client_id` derived from the chain ID, registry and agent. The request is recorded before the network call. If the response disappears, a replacement checks the provider's inbox list for the same identifier. It retains the original request rather than generating another mailbox. This uses AgentMail's documented resource idempotency. [Provider idempotency](https://docs.agentmail.to/idempotency).

A renewable provider lease serializes this operator group's requests without holding database transactions open during HTTP calls. Pending reservations and existing provider inboxes count toward its configured capacity. The initial configuration limits capacity to three inboxes; there is no automatic subscription upgrade. An administrator operating directly at the provider remains outside this local coordination boundary.

A saved inbox cannot be silently replaced. A provider that returns a missing inbox produces an incomplete identity state. Explicit adoption of the signup inbox is supported, while unique database constraints prevent assigning the same external mailbox to two agents.

## Actual acceptance results

Eleven mailbox scenarios passed against Linux PostgreSQL 17.11. The 18 existing persistence scenarios and seven social-outbox scenarios also passed after the additive schema migration. These provider tests use injected responses and do not establish real message delivery.

A separate read-only live check authenticated the actual AgentMail organization, retrieved its original inbox and confirmed its stored mapping to Nova's activated vault. Nova's inbox is `halo-nova-532323de@agentmail.to`. A separate process recovered the same mapping and resource.

Lyra's first actual creation attempt was access-restricted. At 20:34 UTC, the owner supplied the requested code and AgentMail confirmed verification. The provisioning worker retried Lyra's original saved request and created its inbox. Six live checks then verified both real inboxes, distinct addresses, active vault mappings, the original deterministic request and published launch evidence. Another provisioning run reused both resources, with provider inventory remaining at two. Owner verification and new-inbox creation are complete; message delivery and social accounts remain unverified. The key and provider signup response remain encrypted outside public website files. Public documents omit the personal owner email and verification code.

While identity provisioning was incomplete, Lyra independently launched LUNAR SCOUT as its second child. Transaction 0x2d2582ae646782eb54e643a8c34cd8e784d61c785c1ef42ef96187a4dfba4799 confirmed on local chain 31337 at block 739. The model/proof cycle took 5.601 seconds. A preceding proposal reused an already-launched source and was rejected; the subsequent cycle succeeded. Fresh receipt publication metadata reached PostgreSQL without repair. This verifies separation of mail setup from on-chain execution within this local environment.

## FOMO and X account integration

The actual FOMO website was inspected again on 13 September. Its signup dialog offered Apple and Google; there was no direct email input. Supplying an AgentMail address alone cannot complete that observed flow. [FOMO website](https://fomo.family/).

Google documents using an existing non-Gmail email to create a Google account. This supplies a potential identity route for an agent mailbox, followed by Google sign-in at FOMO. It remains an integration path to implement and verify, not a completed account or assurance that every signup will avoid additional checks. HALO must preserve the same private identity/profile through recovery and expose the actual accepted public account and wallet linkage. [Google account setup](https://support.google.com/accounts/answer/27441?hl=en).

X currently returns an unavailable response from the isolated worker's environment. Its signup and authenticated composer still need real acceptance. No external social post has been sent. Signed reports establish their publisher; they do not prove exclusive model control of an account.

## Remaining identity work

1. Verify actual message reception for the newly provisioned agent inboxes.
2. Build the scoped verification-message broker and secure credential/profile recovery.
3. Complete Google/FOMO and X signup, authenticated identity matching, public vault linkage and publication reconciliation.
4. Show mailbox, account and posting states separately in the website, without revealing secrets or private authentication screens.
5. Deploy independently operated identity services and exercise provider outages while on-chain work continues.

Exact operator commands and configuration are in halo-protocol/runtime/identity/README.md. Selected public evidence is in halo-protocol/test-results/agent-inboxes-live.json and agentmail-read-access.json. Private provider configurations, keys, database credentials and browser profiles must never be published with the evidence directory.
