import { z } from 'zod';
import { safeFetch } from '../../sdk/safe-fetch.mjs';

// The Akash Console API's exact deployment/lease endpoint shapes are not confirmed against a live
// account from this environment (no Akash account or network access here). Every request path and
// response schema below is a best-effort adapter over the public documentation and is marked
// VERIFY: exercise it against a real Console account before relying on it for production leases.
// See https://akash.network/docs/api-documentation/ and deploy/akash/README.md.

const deploymentIdSchema = z.string().min(1).max(64).regex(/^[0-9a-zA-Z_-]+$/);
const stateSchema = z.enum(['active', 'closed', 'pending']);
// .passthrough(): only the fields this adapter relies on are validated; unrecognized Console
// response fields are preserved rather than rejected, since the full response shape is unverified.
const deploymentSchema = z.object({ id: deploymentIdSchema, state: stateSchema }).passthrough();
const leaseSchema = z.object({ deploymentId: deploymentIdSchema, provider: z.string().min(1) }).passthrough();

const MAX_RESPONSE_BYTES = 65536;

/** A small, VERIFY-marked adapter over the Akash Console API. `transport` defaults to the repo's safeFetch (HTTPS-only, no redirects, byte-bounded). */
export function createConsoleClient(input) {
  const { baseUrl, apiKey, transport = safeFetch } = z.object({ baseUrl: z.string().url(), apiKey: z.string().min(1) })
    .passthrough().parse(input);
  const origin = new URL(baseUrl).origin;

  async function request(method, pathname, body) {
    const url = new URL(pathname, `${origin}/`);
    if (url.origin !== origin) throw new Error('Console API requests must target the configured origin only');
    const payload = body === undefined ? undefined : Buffer.from(JSON.stringify(body));
    const response = await transport(url.href, { method, body: payload, maxBytes: MAX_RESPONSE_BYTES,
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json',
        ...(payload ? { 'Content-Length': String(payload.length) } : {}) } });
    return response.bytes.length ? JSON.parse(response.bytes.toString('utf8')) : undefined;
  }

  return {
    // VERIFY: POST /v1/deployments — request/response shape unconfirmed.
    async createDeployment({ sdl }) {
      if (typeof sdl !== 'string' || !sdl.trim()) throw new Error('An SDL document is required');
      return deploymentSchema.parse(await request('POST', '/v1/deployments', { sdl }));
    },
    // VERIFY: GET /v1/deployments — assumed to return either an array or {deployments: [...]}.
    async listDeployments() {
      const body = await request('GET', '/v1/deployments');
      return z.array(deploymentSchema).parse(Array.isArray(body) ? body : (body?.deployments ?? []));
    },
    // VERIFY: POST /v1/deployments/{id}/close — assumed idempotent; no response body required.
    async closeDeployment(id) {
      await request('POST', `/v1/deployments/${deploymentIdSchema.parse(id)}/close`);
    },
    // VERIFY: GET /v1/deployments/{id}/lease — assumed one active lease per deployment.
    async getLease(id) {
      return leaseSchema.parse(await request('GET', `/v1/deployments/${deploymentIdSchema.parse(id)}/lease`));
    },
  };
}
