import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { createXOAuth, createPkcePair, X_AUTHORIZE_URL, X_SCOPES, XOAuthError } from '../runtime/social/x-oauth.mjs';
import { createXApi, XApiError } from '../runtime/social/x-api.mjs';
import { SafeFetchHttpError } from '../sdk/safe-fetch.mjs';

const passed = [];

// -- PKCE ---------------------------------------------------------------------------------
const pkce = createPkcePair();
assert.match(pkce.verifier, /^[A-Za-z0-9_-]{43}$/);
assert.match(pkce.challenge, /^[A-Za-z0-9_-]{43}$/);
const expectedChallenge = crypto.createHash('sha256').update(pkce.verifier).digest('base64url');
assert.equal(pkce.challenge, expectedChallenge);
assert.notEqual(createPkcePair().verifier, createPkcePair().verifier);
passed.push('PKCE pair uses S256 and is fresh on every call');

// -- authorizeUrl ---------------------------------------------------------------------------
const oauth = createXOAuth({ clientId: 'client-123', clientSecret: 'shh-secret', redirectUri: 'https://operator.example/callback' });
const authorize = new URL(oauth.authorizeUrl({ state: 'state-value-12345', codeChallenge: pkce.challenge }));
assert.equal(authorize.origin + authorize.pathname, X_AUTHORIZE_URL);
assert.equal(authorize.searchParams.get('response_type'), 'code');
assert.equal(authorize.searchParams.get('client_id'), 'client-123');
assert.equal(authorize.searchParams.get('redirect_uri'), 'https://operator.example/callback');
assert.equal(authorize.searchParams.get('scope'), X_SCOPES);
assert.equal(authorize.searchParams.get('code_challenge'), pkce.challenge);
assert.equal(authorize.searchParams.get('code_challenge_method'), 'S256');
passed.push('authorizeUrl carries PKCE S256, the exact configured redirect and the required scopes');

// -- token exchange / refresh with a stub transport --------------------------------------
function jsonTransport(handler) {
  return async (url, options) => {
    const body = await handler(url, options);
    return { bytes: Buffer.from(JSON.stringify(body)), contentType: 'application/json', url };
  };
}
let lastRequest;
const exchange = createXOAuth({ clientId: 'client-abc', clientSecret: 'secret-xyz', redirectUri: 'https://operator.example/callback',
  transport: jsonTransport((url, options) => {
    lastRequest = { url, options, params: Object.fromEntries(new URLSearchParams(options.body)) };
    return { access_token: 'access-token-1', token_type: 'bearer', expires_in: 7200, refresh_token: 'refresh-token-1', scope: X_SCOPES };
  }) });
const token = await exchange.exchangeCode({ code: 'auth-code', codeVerifier: pkce.verifier });
assert.equal(token.access_token, 'access-token-1');
assert.equal(lastRequest.params.grant_type, 'authorization_code');
assert.equal(lastRequest.params.code, 'auth-code');
assert.equal(lastRequest.params.code_verifier, pkce.verifier);
assert.equal(lastRequest.params.client_id, 'client-abc');
assert.equal(lastRequest.options.headers.Authorization, `Basic ${Buffer.from('client-abc:secret-xyz').toString('base64')}`);
assert.equal(lastRequest.options.headers['Content-Type'], 'application/x-www-form-urlencoded');
passed.push('exchangeCode POSTs the authorization grant with PKCE verifier and confidential-client Basic auth');

const refreshed = await exchange.refresh({ refreshToken: 'refresh-token-1' });
assert.equal(refreshed.access_token, 'access-token-1');
assert.equal(lastRequest.params.grant_type, 'refresh_token');
assert.equal(lastRequest.params.refresh_token, 'refresh-token-1');
passed.push('refresh POSTs the refresh grant');

for (const status of [400, 401, 429, 500]) {
  const failing = createXOAuth({ clientId: 'c', clientSecret: 's', redirectUri: 'https://operator.example/callback',
    transport: async () => { throw new SafeFetchHttpError(status); } });
  await assert.rejects(failing.exchangeCode({ code: 'x', codeVerifier: pkce.verifier }), XOAuthError);
}
passed.push('Token-endpoint HTTP failures surface as a typed XOAuthError, never an unhandled rejection');

assert.throws(() => createXOAuth({ clientSecret: 's', redirectUri: 'https://operator.example/callback' }), /client id/);
assert.throws(() => createXOAuth({ clientId: 'c', redirectUri: 'https://operator.example/callback' }), /client secret/);
passed.push('X OAuth requires both a client id and a confidential-client secret');

// -- x-api.mjs createPost ------------------------------------------------------------------
let postCalls = 0;
const api = createXApi({ transport: jsonTransport((url, options) => {
  postCalls++;
  return { data: { id: '1234567890123456789', text: JSON.parse(options.body).text } };
}) });
const posted = await api.createPost({ text: 'A bounded public thesis.', accessToken: 'a'.repeat(40), profileUrl: 'https://x.com/nova_halo' });
assert.equal(posted.id, '1234567890123456789');
assert.equal(posted.url, 'https://x.com/nova_halo/status/1234567890123456789');
assert.equal(postCalls, 1);
passed.push('createPost publishes through POST /2/tweets and builds the permalink from the verified profile, not API text');

await assert.rejects(api.createPost({ text: 'x'.repeat(281), accessToken: 'a'.repeat(40), profileUrl: 'https://x.com/nova_halo' }), /1-280/);
await assert.rejects(api.createPost({ text: '', accessToken: 'a'.repeat(40), profileUrl: 'https://x.com/nova_halo' }), /1-280/);
assert.equal(postCalls, 1);
passed.push('Text length is enforced before any network call: 281 characters and empty text are both rejected');

await assert.rejects(api.createPost({ text: 'ok', accessToken: 'short', profileUrl: 'https://x.com/nova_halo' }), /access token/);
await assert.rejects(api.createPost({ text: 'ok', accessToken: 'a'.repeat(40), profileUrl: 'https://x.com/nova_halo?tracking=1' }), /Invalid X profile/);
await assert.rejects(api.createPost({ text: 'ok', accessToken: 'a'.repeat(40), profileUrl: 'https://fomo.family/nova_halo' }), /Invalid X profile/);
passed.push('Invalid access tokens and non-canonical X profile URLs are rejected before posting');

const errorCases = [[401, 'credentials-expired'], [429, 'rate-limited'], [403, 'site-unavailable'], [500, 'request-rejected']];
for (const [status, code] of errorCases) {
  const failingApi = createXApi({ transport: async () => { throw new SafeFetchHttpError(status, status === 429 ? '120' : undefined); } });
  await assert.rejects(failingApi.createPost({ text: 'ok', accessToken: 'a'.repeat(40), profileUrl: 'https://x.com/nova_halo' }),
    error => { assert.ok(error instanceof XApiError); assert.equal(error.code, code); if (status === 429) assert.equal(error.retryAfterSeconds, 120); return true; });
}
passed.push('X API 401/429/403/other map to credentials-expired/rate-limited/site-unavailable/request-rejected, with Retry-After surfaced');

const transportDownApi = createXApi({ transport: async () => { throw new Error('ECONNRESET'); } });
await assert.rejects(transportDownApi.createPost({ text: 'ok', accessToken: 'a'.repeat(40), profileUrl: 'https://x.com/nova_halo' }),
  error => error instanceof XApiError && error.code === 'transport-unavailable');
passed.push('A non-HTTP transport failure is reported as transport-unavailable, distinct from a platform rejection');

// -- idempotency: the outbox/prepared_hash mechanism (services/persistence/store.mjs) -----
// This is the actual "same publication id never posts twice" guarantee: prepared publication
// bytes are pinned to a delivery the first time they are checkpointed and can never change on
// a retry, which is what stops a crash-and-restart from posting a *different* thesis for the
// same job id. It needs real PostgreSQL 17, per this environment's setup notes.
if (!process.env.HALO_TEST_DATABASE_URL) {
  console.log('SKIP idempotency (outbox/prepared_hash mechanism): set HALO_TEST_DATABASE_URL to a local PostgreSQL 17 server to run this section.');
} else {
  const { randomBytes } = await import('node:crypto');
  const { openDatabase, migrate } = await import('../services/persistence/database.mjs');
  const { createJobStore } = await import('../services/persistence/store.mjs');
  const config = { url: process.env.HALO_TEST_DATABASE_URL, local: true };
  const deployment = { chainId: 31337, environment: 'local', rpcUrl: 'http://127.0.0.1:8545', registry: `0x${'11'.repeat(20)}`,
    decisionVerifier: `0x${'22'.repeat(20)}`, rootHalo: `0x${'33'.repeat(20)}`, operatingToken: `0x${'44'.repeat(20)}`, coreReleaseSha256: 'a'.repeat(64) };
  const databaseName = `halo_xoauth_test_${randomBytes(6).toString('hex')}`;
  const adminUrl = new URL(config.url); adminUrl.pathname = '/postgres';
  const admin = openDatabase({ ...config, url: adminUrl.toString() });
  try { await admin.pool.query(`CREATE DATABASE "${databaseName}"`); } finally { await admin.close(); }
  const url = new URL(config.url); url.pathname = `/${databaseName}`;
  const database = openDatabase({ ...config, url: url.toString() });
  try {
    await migrate(database);
    const store = await createJobStore({ database, deployment });
    const agent = `0x${'55'.repeat(20)}`;
    await store.enqueue({ agent, nonce: 0n, payload: { version: 'halo.agent-cycle.v1', nonce: '0' } });
    await store.enqueueEvent({ topic: 'social-post', dedupeKey: 'x-oauth-idempotency-fixture', streamKey: 'x-oauth-idempotency-fixture', ordinal: 0,
      payload: { agent, platform: 'x', nonce: '0' } });
    const first = await store.claimDelivery('social-post', 'idempotency-worker-a');
    const prepared = { id: 'fixture-publication-id', platform: 'x', text: 'Original committed thesis.' };
    const checkpoint = await store.checkpointDelivery(first, { prepared });
    assert.deepEqual(checkpoint.prepared, prepared);
    await assert.rejects(store.checkpointDelivery(first, { prepared: { ...prepared, text: 'A different thesis after a crash.' } }), /cannot change/);
    const again = await store.checkpointDelivery(first, { prepared });
    assert.deepEqual(again.prepared, prepared);
    passed.push('Once a publication is prepared and checkpointed, a retry can never commit a different thesis for the same job id');
    await store.checkpointDelivery(first, { result: { status: 'api-started', externalMutationPossible: true } });
    await database.pool.query("UPDATE halo_outbox SET lease_until=clock_timestamp()-interval '1 second' WHERE id=$1", [first.id]);
    const second = await store.claimDelivery('social-post', 'idempotency-worker-b');
    const resumed = await store.checkpointDelivery(second);
    assert.equal(resumed.result.status, 'api-started');
    assert.equal(resumed.result.externalMutationPossible, true);
    assert.deepEqual(resumed.prepared, prepared);
    passed.push('A replacement worker recovers the exact prepared thesis and the possible-prior-submission flag, never re-derives a new one');
  } finally { await database.close(); }
}

console.log(`PASS ${passed.length} X OAuth/API scenarios`);
