# HALO email identity research

Reviewed 13 September 2026. The owner supplied and authorized their personal email for signup. AgentMail accepted signup at 19:55 UTC and created the initial inbox, halo-nova-532323de@agentmail.to. Owner email verification succeeded at 20:34 UTC, followed by creation of Lyra's separate inbox. This is a shared provider organization, not independent ownership of each inbox.

## Account and inbox distinction

AgentMail has an organization/provider account containing multiple independently addressable inboxes. A separate inbox such as nova@agentmail.to is not a forwarding alias for the owner's email. Its inbox ID identifies its own messages and threads. The provider organization still has administrative authority over its resources. Separate addresses do not establish independent ownership.

AgentMail's signup API accepts an owner email and a preferred initial inbox username. It sends an email OTP; its documented request has no telephone-number field. Verification unlocks the provider account. Repeating signup rotates the API key, so retries must not be treated as harmless reads. Per-agent inbox creation supports a stable client_id to recover the same inbox after a retry. Custom domains require verification. Sources: [agent onboarding](https://docs.agentmail.to/agent-onboarding), [signup API](https://docs.agentmail.to/api-reference/agent/sign-up), [inbox model](https://docs.agentmail.to/inboxes), [create inbox](https://docs.agentmail.to/api-reference/inboxes/create).

## Candidate assessment

| Provider | Verified capability | HALO assessment |
| --- | --- | --- |
| AgentMail | Programmatic signup with owner email OTP, persistent per-agent inbox resources, scoped inbox keys, verified custom domains. Free tier lists three inboxes. | Preferred candidate for integration. Shared organization ownership is an explicit dependency, not decentralized identity. |
| Mail.tm | Free temporary inbox REST API; account creation uses address/password without an API key. | Suitable for disposable development mail. It is not selected for durable social-account recovery. |

Sources: [AgentMail pricing](https://www.agentmail.to/pricing), [Mail.tm API](https://docs.mail.tm/), [Mail.tm account creation](https://docs.mail.tm/api/accounts). Phone-free inbox provisioning does not establish that X or FOMO will accept the address or omit their own identity challenges.

## Integration boundary

The implemented adapter provisions or recovers an inbox with a stable agent identity, has no send/delete method and keeps provider keys outside the browser, model and public logs. No unrestricted email-sending capability is needed for social signup. Receiving a message must not turn its content into instructions or authorize opening arbitrary links.

A single HALO-owned organization would allow its administrator to affect all hosted mailboxes and therefore social-account recovery. The product needs creator/operator-owned provider accounts or bring-your-own mailbox credentials, plus secure recovery between authorized hosts. This does not remove the email provider's own authority. Email or social outages must remain separate from immutable on-chain vault execution.

The signup API returned an organization ID, initial inbox ID and restricted API key. Credentials and the provider response are encrypted with Windows DPAPI for the current user outside the website source and public documents. The first PowerShell transport failed; an unauthenticated diagnostic identified TLS authentication failure. Node's verified HTTPS transport succeeded without disabling certificate checks. The one Node signup request returned HTTP 200; there is no automatic mutation retry.

The provider accepted the supplied owner code and confirmed verification. Authenticated access, Nova inbox adoption and subsequent Lyra inbox creation passed. A repeated provisioning run reused the same two resources; a separate read-only check verified their metadata and private database mappings. This does not establish message reception, X/FOMO acceptance or autonomous social signup. The user's personal address, verification code and API key are intentionally omitted from public documentation.

## Implemented identity service

The independent runtime worker and private PostgreSQL identity store pass eleven mailbox scenarios. Six live checks now verify owner-verification evidence, both actual inbox resources, activated-vault mappings and continued launch evidence. FOMO's observed signup offers Google and Apple only, so email provisioning alone cannot complete that account. See [agent identities](HALO_AGENT_IDENTITIES.md) for implementation, evidence and the remaining message-reception and OAuth/account work.
