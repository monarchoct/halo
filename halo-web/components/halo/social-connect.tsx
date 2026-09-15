"use client";
import { useEffect, useState } from "react";
import { createWalletClient, custom, type EIP1193Provider } from "viem";
import { ExternalLink, Link2, Unlink } from "lucide-react";
import { useProtocol } from "./protocol-provider";
import type { Agent } from "@/lib/halo-types";
import { PENDING_KEY, connectMessage, connectPayload, createPkce, disconnectMessage, disconnectPayload, profileUrlFor, type Platform, type SocialStatus, xAuthorizeUrl } from "@/lib/social";

const names: Record<Platform, string> = { x: "X", fomo: "FOMO" };
const stateLabel = { connected: "Connected", "credentials-expired": "Reconnect needed", disconnected: "Disconnected" } as const;

/** Creator-side account connection. The agent never signs up for anything: the creator connects an account once, then the agent posts from it. */
export function SocialConnect({ agent }: { agent: Agent }) {
  const { deployment, address, openWallet } = useProtocol();
  const endpoint = deployment?.operationsApiUrl, key = `${endpoint}:${agent.address}`;
  const [snapshot, setSnapshot] = useState<{ key: string; data?: SocialStatus; error?: string }>({ key: "" });
  const [handles, setHandles] = useState<Record<Platform, string>>({ x: "", fomo: "" }), [busy, setBusy] = useState<Platform | null>(null), [message, setMessage] = useState(""), [refresh, setRefresh] = useState(0);
  const status = snapshot.key === key ? snapshot.data : undefined, error = snapshot.key === key ? snapshot.error : "";
  const isCreator = !!address && address.toLowerCase() === agent.creator.toLowerCase();
  useEffect(() => {
    if (!endpoint) return;
    const abort = new AbortController();
    fetch(`${endpoint}/v1/agents/${agent.address}/social`, { signal: abort.signal, cache: "no-store", credentials: "omit" }).then(async r => { if (!r.ok) throw new Error("Account status is unavailable right now."); const v = await r.json() as SocialStatus; if (v.agent !== agent.address.toLowerCase()) throw new Error("The service answered for another agent."); setSnapshot({ key, data: v }); })
      .catch(e => { if (e.name !== "AbortError") setSnapshot({ key, error: e.message }); });
    return () => abort.abort();
  }, [endpoint, agent.address, key, refresh]);
  async function sign(text: string) {
    const provider = (window as Window & { ethereum?: EIP1193Provider }).ethereum;
    if (!address || !provider) { openWallet(); throw new Error("Connect the creator wallet first."); }
    return createWalletClient({ account: address, transport: custom(provider) }).signMessage({ message: text });
  }
  async function connect(platform: Platform) {
    if (!deployment || !endpoint) return;
    setBusy(platform); setMessage("");
    try {
      const profileUrl = profileUrlFor(platform, handles[platform]);
      const payload = connectPayload({ chainId: deployment.chainId, registry: deployment.registry, agent: agent.address, platform, profileUrl });
      const signature = await sign(connectMessage(payload));
      const request = { version: "halo.social-connect.v1", ...payload, signature };
      if (platform === "x") {
        if (!deployment.social?.xClientId || !deployment.social.xRedirectUri) throw new Error("The operator has not configured X sign-in for this deployment yet.");
        const { verifier, challenge } = await createPkce(); const state = payload.nonce;
        sessionStorage.setItem(PENDING_KEY, JSON.stringify({ request, verifier, state, agent: agent.address, endpoint }));
        window.location.assign(xAuthorizeUrl({ clientId: deployment.social.xClientId, redirectUri: deployment.social.xRedirectUri, challenge, state })); return;
      }
      const response = await fetch(`${endpoint}/v1/agents/${agent.address}/social/connect`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ request }) });
      const body = await response.json() as { error?: string };
      if (!response.ok) throw new Error(body.error || "The connection was not accepted.");
      setMessage("FOMO profile linked. An operator now needs to open a connect session so you can sign in inside the agent's isolated browser."); setRefresh(v => v + 1);
    } catch (e) { setMessage((e as Error).message); } finally { setBusy(null); }
  }
  async function disconnect(platform: Platform) {
    if (!deployment || !endpoint) return;
    setBusy(platform); setMessage("");
    try {
      const payload = disconnectPayload({ chainId: deployment.chainId, registry: deployment.registry, agent: agent.address, platform });
      const signature = await sign(disconnectMessage(payload));
      const response = await fetch(`${endpoint}/v1/agents/${agent.address}/social/disconnect`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ request: { version: "halo.social-disconnect.v1", ...payload, signature } }) });
      if (!response.ok) throw new Error(((await response.json()) as { error?: string }).error || "Disconnect was not accepted.");
      setMessage(`${names[platform]} disconnected. The agent will stop posting there.`); setRefresh(v => v + 1);
    } catch (e) { setMessage((e as Error).message); } finally { setBusy(null); }
  }
  if (!endpoint) return <p className="dim">This deployment has no operations service, so accounts cannot be connected here.</p>;
  return <div className="stack">
    <p>Accounts are created by you and connected once; afterwards the agent posts its theses from them on its own. HALO never asks the agent to sign up for anything, and social availability never gates on-chain execution.</p>
    {error && <p className="notice err" role="alert">{error}</p>}
    <div className="fee-panels">{(["x", "fomo"] as Platform[]).map(platform => { const s = status?.platforms[platform] ?? null; return <div className="panel" key={platform}>
      <div className="row between"><h3>{names[platform]}</h3><span className={`chip ${s?.state === "connected" ? "green" : s?.state === "credentials-expired" ? "orange" : ""}`}>{s ? stateLabel[s.state] : status ? "Not connected" : "…"}</span></div>
      {s ? <><p className="dim" style={{ marginTop: 6 }}><a href={s.profileUrl} target="_blank" rel="noreferrer" className="row" style={{ gap: 4, display: "inline-flex" }}>{s.profileUrl.replace(/^https:\/\//, "")} <ExternalLink size={12} /></a> · {s.method === "oauth" ? "official API" : "browser session"} · since {new Date(s.connectedAt).toLocaleDateString()}</p>
        {isCreator && <button type="button" className="pill sm" style={{ marginTop: 10 }} disabled={busy === platform} onClick={() => disconnect(platform)}><Unlink size={14} /> Disconnect</button>}</>
        : isCreator ? <div className="stack" style={{ marginTop: 8 }}><div className="field"><label htmlFor={`handle-${platform}`}>{names[platform]} account handle</label><input id={`handle-${platform}`} className="input" placeholder={platform === "x" ? "@youragent" : "youragent"} value={handles[platform]} onChange={e => setHandles(h => ({ ...h, [platform]: e.target.value }))} /><small>{platform === "x" ? "You sign a message with the creator wallet, then approve HALO on X. The agent then posts through X's official API." : "You sign a message with the creator wallet; signing in happens later inside the agent's isolated browser, never through HALO."}</small></div>
          <button type="button" className="pill primary" disabled={busy === platform || !handles[platform]} onClick={() => connect(platform)}><Link2 size={14} /> {platform === "x" ? "Connect X" : "Link FOMO profile"}</button></div>
        : <p className="dim" style={{ marginTop: 6 }}>{address ? "Only the creator wallet can connect accounts." : "Connect the creator wallet to link an account."}</p>}
    </div>; })}</div>
    {message && <p className="notice" role="status">{message}</p>}
  </div>;
}
