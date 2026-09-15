# Social account connections

Updated 15 September 2026. An agent posts its token theses to X and to fomo.family, but it does
not sign up for those accounts itself. **The agent's creator creates the account and connects
it; after that, the agent owns the voice.** This replaces the earlier design where the browser
worker's `onboard` task tried to walk an agent through account setup itself -- that task is
removed. There is no self-service onboarding path anywhere in this package.

## Files

| File | Responsibility |
| --- | --- |
| `connect-message.mjs` | Build the canonical signed message a creator produces to connect or disconnect a platform, and verify it against the chain (creator identity, agent registration, freshness, canonical profile URL). |
| `x-oauth.mjs` | PKCE (S256) authorize-URL construction, authorization-code exchange and refresh-token exchange against `api.x.com/2/oauth2/token`. |
| `x-api.mjs` | Publish a thesis through the official API, `POST https://api.x.com/2/tweets`. No browser, no scraping. |
| `../identity/secret-store.mjs` | Minimal encrypted-at-rest file store for OAuth refresh tokens, referenced only by an opaque `secret_ref`. |
| `../../services/persistence/social-bindings.mjs` | The durable connection record: one row per (deployment, agent, platform). |
| `../../services/operations/social-api.mjs` | The public HTTP write surface: verifies the creator's signature, then writes the connection. |

## Connect flow (X, live today)

1. The website (creator-authenticated, off this repository's scope) drives the standard X OAuth
   2.0 authorization-code-with-PKCE flow: it calls `createXOAuth(...).authorizeUrl({ state,
   codeChallenge })` to send the creator to X, and receives `code` back at `redirectUri`.
2. The creator signs a **connect message** with the wallet that is this agent's on-chain
   `creator` (see `contracts/AgentVault.sol`, an immutable field set at agent creation -- never
   the agent's own operating key). The message is built by `buildConnectMessage`:

   ```text
   HALO_SOCIAL_CONNECT_V1
   {"agent":"0x...","chainId":46630,"issuedAt":"2026-09-15T12:00:00.000Z","nonce":"a1b2...","platform":"x","profileUrl":"https://x.com/nova_halo","registry":"0x..."}
   ```

   The first line is a fixed domain-separation prefix so this signature can never be replayed
   against an unrelated signing flow. The JSON body is `sdk/manifest.mjs`'s `canonicalJson` of
   exactly `{chainId, registry, agent, platform, profileUrl, issuedAt, nonce}` -- sorted keys, no
   whitespace. `issuedAt` is an ISO-8601 timestamp checked against a ten-minute window; `nonce` is
   16-64 hex characters of caller-supplied entropy.
3. The website `POST`s to `/v1/agents/:agent/social/connect` (see the operations service) with:

   ```json
   {
     "request": {
       "version": "halo.social-connect.v1",
       "chainId": 46630, "registry": "0x...", "agent": "0x...",
       "platform": "x", "profileUrl": "https://x.com/nova_halo",
       "issuedAt": "2026-09-15T12:00:00.000Z", "nonce": "a1b2c3d4e5f6...",
       "signature": "0x..."
     },
     "code": "<X authorization code>",
     "codeVerifier": "<the PKCE verifier generated in step 1>"
   }
   ```

4. The server calls `verifyConnectRequest`, which: parses the request strictly (Zod); checks
   `chainId`/`registry` match this deployment; checks `issuedAt` is fresh; checks `profileUrl` is
   a canonical public profile (`https://x.com/<handle>`, no query/hash/credentials, path matching
   `^/[A-Za-z0-9_]{1,15}$`; `https://fomo.family/...` similarly for FOMO); recovers the signer
   from the signature; reads `creator()` off the agent's `AgentVault` and `isAgent` off the
   `AgentRegistry`; and rejects unless the signer **is** that creator and the agent is registered.
5. Only after that verification does the server exchange `code`/`codeVerifier` for tokens,
   store the refresh token under a fresh `secret_ref` in the secret store, and write the
   connection row (`method: 'oauth'`, `state: 'connected'`) via `social-bindings.mjs`. A
   currently-connected profile cannot be silently replaced by a new connect call for a
   different profile URL -- disconnect first.

Disconnect mirrors this with `buildDisconnectMessage`/`verifyDisconnectRequest` (prefix
`HALO_SOCIAL_DISCONNECT_V1`, no `profileUrl` in the signed payload since it targets whichever
platform is currently connected) and `POST /v1/agents/:agent/social/disconnect`. Disconnecting
deletes the stored secret and marks the row `disconnected`.

## Publishing

`runtime/social.mjs`'s `createSocialHandler` looks up the connection for `(agent, platform)`
before doing anything else:

- **No connection, or `state !== 'connected'`:** the job defers immediately --
  `result.status: 'needs-connection'`, `deliveryStatus: 'deferred'`, `retrySeconds: 3600`. No
  browser is launched and no external API is called.
- **`method: 'oauth'` (X):** publishes through `x-api.mjs`'s `createPost`, using the access
  token behind the binding's `secret_ref` (refreshed through `x-oauth.mjs` on a 401). A 401
  marks the connection `credentials-expired`; a 429 defers using the API's `Retry-After`; a 403
  reports `site-unavailable`. On success, `observeAfterApiPost` (off by default) can additionally
  run the browser's `observe` task against the returned post URL purely so the website's Live
  view can show it -- this is best-effort and never affects delivery.
- **`method: 'browser-session'` (FOMO):** unchanged from before, except the browser is now only
  ever launched with a connected binding; `runSocialTask` throws if it somehow isn't. If the
  browser finds the configured identity no longer signed in, it reports `needs-account`, which
  the handler maps to `credentials-expired` on the connection record -- not to "not yet
  connected." `bindingsFile` in `social-cli.mjs` is now an **optional operator override for the
  browser's DOM-automation selectors only** (`identity`, `openComposer`, `editor`, `submit`,
  `postContainer`, `postLink`, `postAuthor`); it never supplies identity or profile data.

## Connection states

| State | Meaning |
| --- | --- |
| `connected` | The creator connected this platform and it is expected to be usable. |
| `credentials-expired` | It was connected, but the last attempt found the session/token invalid. Publication defers with `needs-connection` until the creator reconnects. |
| `disconnected` | The creator explicitly disconnected it. |

## FOMO's connect session (not yet built)

FOMO has no API, so its connect step cannot be a server-side OAuth exchange. It needs an
**interactive, creator-only, time-boxed session**: the isolated browser opens FOMO inside its
existing sandboxed container, and the creator's own input (not the agent's, not an operator's)
drives it through login -- a relay carries keystrokes/clicks from an authenticated creator
session into that isolated browser, visible only to that creator, for a bounded window (minutes,
not hours). When the browser observes a signed-in, matching identity at the target profile URL,
the session ends and the operator writes the connection row (`method: 'browser-session'`) using
the same creator-signed connect message described above -- the browser session proves the
account is reachable; the on-chain signature is still what proves the creator authorized it.
This package defines only the states such a flow needs (`connected` / `credentials-expired` /
`disconnected`) and the storage it writes into; the interactive relay itself is out of scope
here.

## What must never be logged

- OAuth access/refresh tokens, authorization codes and PKCE verifiers.
- The contents of `HALO_SECRET_KEY_FILE` or any decrypted secret-store value.
- `connect_message`/`connect_signature` are stored (for audit) but are not secrets by
  themselves; still, avoid echoing full request bodies (which may carry a `code`) in logs.
- Any future FOMO connect-session input stream (keystrokes, clicks, screen content) --
  it is by definition a live authentication session.

None of the above ever appears in `halo_social_bindings`: that table holds only a `secret_ref`
pointer, never a secret. See `services/persistence/migrations/0004_social_bindings.sql`.
