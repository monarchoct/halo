import type { Address } from "viem";

/** Mirrors halo-protocol/runtime/social/connect-message.mjs. The creator signs exactly this text. */
export type Platform = "x" | "fomo";
export type SocialState = { state: "connected" | "credentials-expired" | "disconnected"; profileUrl: string; method: "oauth" | "browser-session"; connectedAt: string } | null;
export type SocialStatus = { version: "halo.public-social.v1"; chainId: number; registry: string; agent: string; platforms: { x: SocialState; fomo: SocialState } };
export const PLATFORM_ORIGIN: Record<Platform, string> = { x: "https://x.com", fomo: "https://fomo.family" };
const CONNECT_PREFIX = "HALO_SOCIAL_CONNECT_V1\n", DISCONNECT_PREFIX = "HALO_SOCIAL_DISCONNECT_V1\n";

function canonical(value: unknown): string { if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`; if (value !== null && typeof value === "object") return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(",")}}`; return JSON.stringify(value); }
const hex = (bytes: Uint8Array) => Array.from(bytes, b => b.toString(16).padStart(2, "0")).join("");
export const randomNonce = () => hex(crypto.getRandomValues(new Uint8Array(16)));

export function connectPayload({ chainId, registry, agent, platform, profileUrl }: { chainId: number; registry: Address; agent: Address; platform: Platform; profileUrl: string }) {
  return { chainId, registry: registry.toLowerCase(), agent: agent.toLowerCase(), platform, profileUrl, issuedAt: new Date().toISOString(), nonce: randomNonce() };
}
export const connectMessage = (payload: ReturnType<typeof connectPayload>) => `${CONNECT_PREFIX}${canonical(payload)}`;
export function disconnectPayload({ chainId, registry, agent, platform }: { chainId: number; registry: Address; agent: Address; platform: Platform }) {
  return { chainId, registry: registry.toLowerCase(), agent: agent.toLowerCase(), platform, issuedAt: new Date().toISOString(), nonce: randomNonce() };
}
export const disconnectMessage = (payload: ReturnType<typeof disconnectPayload>) => `${DISCONNECT_PREFIX}${canonical(payload)}`;

/** Canonical public profile URL the protocol accepts: origin-only host, single path segment, no query or hash. */
export function profileUrlFor(platform: Platform, handle: string) {
  const clean = handle.trim().replace(/^@/, "").replace(/^https?:\/\/[^/]+\//, "").replace(/\/+$/, "");
  if (!/^[A-Za-z0-9_.-]{1,64}$/.test(clean)) throw new Error("Enter just the account handle, without spaces or symbols.");
  return `${PLATFORM_ORIGIN[platform]}/${clean}`;
}

/** PKCE for X OAuth 2.0. The verifier stays in this browser only until the callback completes. */
export async function createPkce() {
  const verifier = hex(crypto.getRandomValues(new Uint8Array(32)));
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)));
  const challenge = btoa(String.fromCharCode(...digest)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return { verifier, challenge };
}
export function xAuthorizeUrl({ clientId, redirectUri, challenge, state }: { clientId: string; redirectUri: string; challenge: string; state: string }) {
  const url = new URL("https://x.com/i/oauth2/authorize");
  url.search = new URLSearchParams({ response_type: "code", client_id: clientId, redirect_uri: redirectUri, scope: "tweet.read tweet.write users.read offline.access", state, code_challenge: challenge, code_challenge_method: "S256" }).toString();
  return url.href;
}
export const PENDING_KEY = "halo:social-connect:pending";
