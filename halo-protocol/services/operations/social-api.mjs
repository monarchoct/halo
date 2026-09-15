import { z } from 'zod';
import { verifyConnectRequest, verifyDisconnectRequest } from '../../runtime/social/connect-message.mjs';
import { createSocialBindingStore } from '../persistence/social-bindings.mjs';
import { socialPlatforms } from './reader.mjs';

const address = z.string().regex(/^0x[0-9a-fA-F]{40}$/).transform(v => v.toLowerCase());
const connectBodySchema = z.object({ request: z.record(z.string(), z.unknown()), code: z.string().min(1).max(2048).optional(),
  codeVerifier: z.string().min(43).max(128).optional() }).strict();
const disconnectBodySchema = z.object({ request: z.record(z.string(), z.unknown()) }).strict();

/** Write surface for creator-authorized social connections. Unlike the read-only projection
 * in reader.mjs, this needs a full read/write database connection (not the restricted public
 * reader role) -- every write is still gated on a valid on-chain-creator signature, never on
 * a caller identity claim, so it is safe to expose over the same public HTTP service. */
export async function createSocialApi({ database, client, deployment, artifacts, secretStore, xOAuth }) {
  const store = await createSocialBindingStore({ database, deployment });
  return {
    async view(agentValue) {
      const agent = address.parse(agentValue);
      const rows = await store.list(agent);
      return { version: 'halo.public-social.v1', chainId: deployment.chainId, registry: deployment.registry.toLowerCase(), agent, platforms: socialPlatforms(rows) };
    },
    async connect(body) {
      const { request, code, codeVerifier } = connectBodySchema.parse(body);
      const verified = await verifyConnectRequest({ client, artifacts, deployment, request });
      let method = 'browser-session', secretRef;
      if (verified.platform === 'x') {
        method = 'oauth';
        if (!xOAuth || !secretStore) throw new Error('X OAuth is not configured on this operator');
        if (!code || !codeVerifier) throw new Error('X connection requires the completed OAuth authorization code and verifier');
        const token = await xOAuth.exchangeCode({ code, codeVerifier });
        secretRef = secretStore.newRef();
        await secretStore.put(secretRef, { accessToken: token.access_token, refreshToken: token.refresh_token });
      }
      const row = await store.connect({ agent: verified.agent, platform: verified.platform, profileUrl: verified.profileUrl, method,
        connectedBy: verified.connectedBy, connectMessage: verified.message, connectSignature: verified.signature, secretRef });
      return { state: row.state, profileUrl: row.profile_url, method: row.method, connectedAt: row.created_at?.toISOString?.() ?? row.created_at };
    },
    async disconnect(body) {
      const { request } = disconnectBodySchema.parse(body);
      const verified = await verifyDisconnectRequest({ client, artifacts, deployment, request });
      const existing = await store.find(verified.agent, verified.platform);
      const row = await store.disconnect(verified.agent, verified.platform);
      if (existing?.secret_ref && secretStore) await secretStore.delete(existing.secret_ref).catch(() => {});
      return { state: row.state };
    },
  };
}
