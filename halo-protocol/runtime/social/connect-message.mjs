import { z } from 'zod';
import { recoverMessageAddress } from 'viem';
import { canonicalJson } from '../../sdk/manifest.mjs';
import { assertSupportedDeployment } from '../../sdk/networks.mjs';
import { SOCIAL_PLATFORMS } from '../browser/social-driver.mjs';

/** Signed proof that the agent's on-chain creator -- never the agent itself -- authorized
 * a social connection. Domain-separated by a fixed text prefix so this signature can never
 * be replayed against an unrelated HALO or third-party signing flow. */
export const CONNECT_PREFIX = 'HALO_SOCIAL_CONNECT_V1\n';
export const DISCONNECT_PREFIX = 'HALO_SOCIAL_DISCONNECT_V1\n';

const address = z.string().regex(/^0x[0-9a-fA-F]{40}$/).transform(v => v.toLowerCase());
const nonce = z.string().regex(/^[a-f0-9]{16,64}$/);
const signature = z.string().regex(/^0x[0-9a-fA-F]{130}$/);
const platform = z.enum(['x', 'fomo']);

export const connectPayloadSchema = z.object({
  chainId: z.number().int().positive(), registry: address, agent: address, platform,
  profileUrl: z.string().max(300), issuedAt: z.string().datetime(), nonce,
}).strict();
export const connectRequestSchema = connectPayloadSchema.extend({
  version: z.literal('halo.social-connect.v1'), signature,
}).strict();

export const disconnectPayloadSchema = z.object({
  chainId: z.number().int().positive(), registry: address, agent: address, platform,
  issuedAt: z.string().datetime(), nonce,
}).strict();
export const disconnectRequestSchema = disconnectPayloadSchema.extend({
  version: z.literal('halo.social-disconnect.v1'), signature,
}).strict();

export function buildConnectMessage({ chainId, registry, agent, platform: platformValue, profileUrl, issuedAt, nonce: nonceValue }) {
  const payload = connectPayloadSchema.parse({ chainId, registry, agent, platform: platformValue, profileUrl, issuedAt, nonce: nonceValue });
  return `${CONNECT_PREFIX}${canonicalJson(payload)}`;
}
export function buildDisconnectMessage({ chainId, registry, agent, platform: platformValue, issuedAt, nonce: nonceValue }) {
  const payload = disconnectPayloadSchema.parse({ chainId, registry, agent, platform: platformValue, issuedAt, nonce: nonceValue });
  return `${DISCONNECT_PREFIX}${canonicalJson(payload)}`;
}

function canonicalProfileUrl(value, platformValue) {
  const site = SOCIAL_PLATFORMS[platformValue];
  let url;
  try { url = new URL(value); } catch { throw new Error('Social profile URL is malformed'); }
  const pathOk = platformValue === 'x' ? /^\/[A-Za-z0-9_]{1,15}$/.test(url.pathname) : url.pathname !== '/' && url.pathname.length <= 200;
  if (url.origin !== site.origin || url.username || url.password || url.search || url.hash || url.href !== value || !pathOk)
    throw new Error('Social profile URL must be a canonical public profile on its platform');
  return url.href;
}

function withinWindow(issuedAt, windowMs = 10 * 60 * 1000) {
  const issuedMs = Date.parse(issuedAt);
  return Number.isFinite(issuedMs) && Math.abs(Date.now() - issuedMs) <= windowMs;
}

async function verifyCreatorSignature({ client, artifacts, deployment, agent, message, signature: sig }) {
  const [chainId, creator, isAgent, signer] = await Promise.all([
    client.getChainId(),
    client.readContract({ address: agent, abi: artifacts.AgentVault.abi, functionName: 'creator' }),
    client.readContract({ address: deployment.registry, abi: artifacts.AgentRegistry.abi, functionName: 'isAgent', args: [agent] }),
    recoverMessageAddress({ message, signature: sig }),
  ]);
  if (chainId !== deployment.chainId) throw new Error('Connect verification RPC differs from its deployment');
  if (!isAgent) throw new Error('Address is not a registered HALO agent');
  if (signer.toLowerCase() !== creator.toLowerCase()) throw new Error('Request was not signed by the agent creator');
  return signer.toLowerCase();
}

/** Rejects unless the request targets this exact deployment, was issued within the last ten
 * minutes, carries a canonical public profile URL, and is signed by the agent's immutable
 * on-chain creator (never the agent's own operating key). */
export async function verifyConnectRequest({ client, artifacts, deployment, request }) {
  assertSupportedDeployment(deployment);
  const parsed = connectRequestSchema.parse(request);
  if (parsed.chainId !== deployment.chainId || parsed.registry !== deployment.registry.toLowerCase())
    throw new Error('Connect request belongs to another deployment');
  if (!withinWindow(parsed.issuedAt)) throw new Error('Connect request timestamp has expired');
  const profileUrl = canonicalProfileUrl(parsed.profileUrl, parsed.platform);
  const message = buildConnectMessage(parsed);
  const connectedBy = await verifyCreatorSignature({ client, artifacts, deployment, agent: parsed.agent, message, signature: parsed.signature });
  return { agent: parsed.agent, platform: parsed.platform, profileUrl, connectedBy, message, signature: parsed.signature, issuedAt: parsed.issuedAt };
}

export async function verifyDisconnectRequest({ client, artifacts, deployment, request }) {
  assertSupportedDeployment(deployment);
  const parsed = disconnectRequestSchema.parse(request);
  if (parsed.chainId !== deployment.chainId || parsed.registry !== deployment.registry.toLowerCase())
    throw new Error('Disconnect request belongs to another deployment');
  if (!withinWindow(parsed.issuedAt)) throw new Error('Disconnect request timestamp has expired');
  const message = buildDisconnectMessage(parsed);
  const connectedBy = await verifyCreatorSignature({ client, artifacts, deployment, agent: parsed.agent, message, signature: parsed.signature });
  return { agent: parsed.agent, platform: parsed.platform, connectedBy, message, signature: parsed.signature, issuedAt: parsed.issuedAt };
}
