import { randomBytes, createHash } from 'node:crypto';
import { z } from 'zod';
import { safeFetch, SafeFetchHttpError } from '../../sdk/safe-fetch.mjs';

export const X_AUTHORIZE_URL = 'https://x.com/i/oauth2/authorize';
export const X_TOKEN_URL = 'https://api.x.com/2/oauth2/token';
export const X_SCOPES = 'tweet.read tweet.write users.read offline.access';

export class XOAuthError extends Error {
  constructor(code, { httpStatus } = {}) { super(`X OAuth: ${code}`); this.name = 'XOAuthError'; this.code = code; this.httpStatus = httpStatus; }
}

const base64url = buffer => buffer.toString('base64url');
/** PKCE (S256) per RFC 7636. The verifier never leaves the operator's process; only its
 * challenge is sent to X during the authorize step. */
export function createPkcePair() {
  const verifier = base64url(randomBytes(32));
  const challenge = base64url(createHash('sha256').update(verifier).digest());
  return { verifier, challenge };
}

const tokenResponseSchema = z.object({
  access_token: z.string().min(1).max(4096), token_type: z.string().min(1).max(40),
  expires_in: z.number().int().positive().max(31536000), refresh_token: z.string().min(1).max(4096).optional(),
  scope: z.string().min(1).max(400).optional(),
}).passthrough();

/** Confidential-client PKCE. clientSecret is required: HTTP Basic auth plus PKCE, matching
 * X's OAuth 2.0 user-context flow for a server-side (non-public) client. */
export function createXOAuth({ clientId, clientSecret, redirectUri, transport = safeFetch }) {
  if (typeof clientId !== 'string' || !clientId) throw new Error('X OAuth client id is required');
  if (typeof clientSecret !== 'string' || !clientSecret) throw new Error('X OAuth client secret is required');
  redirectUri = new URL(redirectUri).href;
  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

  function authorizeUrl({ state, codeChallenge }) {
    z.string().min(8).max(256).parse(state); z.string().min(32).max(128).parse(codeChallenge);
    const url = new URL(X_AUTHORIZE_URL);
    url.search = new URLSearchParams({ response_type: 'code', client_id: clientId, redirect_uri: redirectUri,
      scope: X_SCOPES, state, code_challenge: codeChallenge, code_challenge_method: 'S256' }).toString();
    return url.href;
  }

  async function tokenRequest(body, { signal } = {}) {
    signal?.throwIfAborted();
    try {
      const response = await transport(X_TOKEN_URL, { method: 'POST',
        headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(body).toString(), maxBytes: 65536, timeoutMs: 10000 });
      return tokenResponseSchema.parse(JSON.parse(response.bytes));
    } catch (error) {
      if (signal?.aborted) throw error;
      const status = error instanceof SafeFetchHttpError ? error.statusCode : undefined;
      throw new XOAuthError(status === 401 || status === 400 ? 'grant-rejected' : status === 429 ? 'rate-limited' : status ? 'request-rejected' : 'transport-unavailable', { httpStatus: status });
    }
  }

  return {
    authorizeUrl,
    async exchangeCode({ code, codeVerifier }, options) {
      z.string().min(1).max(2048).parse(code); z.string().min(43).max(128).parse(codeVerifier);
      return tokenRequest({ grant_type: 'authorization_code', code, redirect_uri: redirectUri, code_verifier: codeVerifier, client_id: clientId }, options);
    },
    async refresh({ refreshToken }, options) {
      z.string().min(1).max(4096).parse(refreshToken);
      return tokenRequest({ grant_type: 'refresh_token', refresh_token: refreshToken, client_id: clientId }, options);
    },
  };
}
