"use client";
import { useEffect, useState, type CSSProperties } from "react";
import Link from "next/link";
import { createWalletClient, custom, type EIP1193Provider } from "viem";
import { ExternalLink, Link2, Unlink, RefreshCw } from "lucide-react";
import { useProtocol } from "./protocol-provider";
import { AddressTap } from "./market-card";
import type { Agent } from "@/lib/halo-types";
import { PENDING_KEY, PLATFORM_ORIGIN, connectMessage, connectPayload, createPkce, disconnectMessage, disconnectPayload, profileUrlFor, type Platform, type SocialStatus, xAuthorizeUrl } from "@/lib/social";

const names: Record<Platform, string> = { x: "X", fomo: "FOMO" };
const stateLabel = { connected: "Connected", "credentials-expired": "Reconnect needed", disconnected: "Disconnected" } as const;
/** The handle part of a profile URL, e.g. https://x.com/talos → talos. */
const handleOf = (profileUrl: string) => profileUrl.replace(/^https?:\/\/[^/]+\//, "").replace(/\/+$/, "").replace(/^@/, "");

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
  if (!endpoint) return <div className="empty reveal-up"><h3>No operations service</h3><p>This deployment has no operations service, so accounts cannot be connected here.</p><Link href="/docs#social" className="pill sm">How social connection works</Link></div>;
  const connectedCount = status ? (["x", "fomo"] as Platform[]).filter(p => status.platforms[p]?.state === "connected").length : 0;
  return <div className="stack" id="social">
    <div className="panel-head reveal-up">
      <div><p className="eyebrow">Social</p><h2>Connected accounts</h2><p>Accounts are created by you and connected once; afterwards the agent posts its theses from them on its own. TALOS never asks the agent to sign up for anything, and social availability never gates on-chain execution.</p></div>
      <div className="row" style={{ gap: 6 }}>
        <span className="count">{status ? `${connectedCount} of 2 connected` : error ? "status unavailable" : "reading…"}</span>
        <button type="button" className="pill icon sm" aria-label="Refresh account status" title="Refresh account status" onClick={() => setRefresh(v => v + 1)}><RefreshCw size={14} /></button>
      </div>
    </div>
    <p className="row muted reveal-up" style={{ fontSize: ".86rem", "--i": 1 } as CSSProperties}>Creator <AddressTap address={agent.creator} explorerUrl={deployment?.explorerUrl} /> {isCreator ? <span className="chip green">You</span> : <span className="chip">signs connections</span>}</p>
    {error && <p className="notice err reveal-up" role="alert">{error}</p>}
    <div className="fee-panels">{(["x", "fomo"] as Platform[]).map((platform, index) => {
      const s = status?.platforms[platform] ?? null, handle = s ? handleOf(s.profileUrl) : "", profileHref = platform === "x" && handle ? `https://x.com/${handle}` : s?.profileUrl ?? PLATFORM_ORIGIN[platform];
      return <section className={`panel ${s?.state === "connected" ? "tint" : ""} reveal-up`} key={platform} style={{ "--i": index + 2 } as CSSProperties} aria-labelledby={`social-${platform}`}>
        <div className="row between">
          <div className="row" style={{ gap: 8 }}><span className="glyph" style={{ width: 34, height: 34, borderRadius: 10, display: "grid", placeItems: "center", background: "var(--panel-3)", fontFamily: "var(--font-display)", fontWeight: 500 }} aria-hidden="true">{platform === "x" ? "𝕏" : "F"}</span><h3 id={`social-${platform}`}>{names[platform]}</h3></div>
          <span className={`chip ${s?.state === "connected" ? "green live" : s?.state === "credentials-expired" ? "bronze" : ""}`}>{s?.state === "connected" && <i aria-hidden="true" />}{s ? stateLabel[s.state] : status ? "Not connected" : "…"}</span>
        </div>
        {s ? <div className="stack" style={{ marginTop: 12 }}>
          <div className="list-row" style={{ gridTemplateColumns: "1fr auto" }}>
            <span className="info"><a href={profileHref} target="_blank" rel="noreferrer" className="row" style={{ gap: 6, display: "inline-flex", fontWeight: 600 }} title={`Open ${profileHref}`}>@{handle || names[platform]} <ExternalLink size={12} /></a><p className="mono" style={{ textTransform: "none", letterSpacing: 0 }}>{profileHref.replace(/^https:\/\//, "")}</p></span>
            <span className="stack" style={{ gap: 4, justifyItems: "end" }}><span className="chip">{s.method === "oauth" ? "official API" : "browser session"}</span><time className="mono" dateTime={s.connectedAt}>since {new Date(s.connectedAt).toLocaleDateString()}</time></span>
          </div>
          {s.state === "credentials-expired" && <p className="notice warn">The stored credentials expired. Disconnect, then connect again so the agent can resume posting.</p>}
          <div className="row">
            <a href={profileHref} target="_blank" rel="noreferrer" className="pill sm">Open profile ↗</a>
            {isCreator && <button type="button" className="pill sm ghost" disabled={busy === platform} onClick={() => disconnect(platform)}><Unlink size={14} /> {busy === platform ? "Signing…" : `Disconnect ${names[platform]}`}</button>}
          </div>
        </div>
        : isCreator ? <div className="stack" style={{ marginTop: 12 }}>
          <div className="field"><label htmlFor={`handle-${platform}`}>{names[platform]} account handle</label><input id={`handle-${platform}`} className="input" placeholder={platform === "x" ? "@youragent" : "youragent"} value={handles[platform]} onChange={e => setHandles(h => ({ ...h, [platform]: e.target.value }))} autoComplete="off" spellCheck={false} /><small>{platform === "x" ? "You sign a message with the creator wallet, then approve TALOS on X. The agent then posts through X's official API." : "You sign a message with the creator wallet; signing in happens later inside the agent's isolated browser, never through TALOS."}</small></div>
          <ol className="steps">
            <li><span className="n">1</span><div><h3>Sign with the creator wallet</h3><p>A plain message binds this agent to the {names[platform]} profile.</p></div></li>
            <li><span className="n">2</span><div><h3>{platform === "x" ? "Approve TALOS on X" : "Operator opens a connect session"}</h3><p>{platform === "x" ? "X's official OAuth returns you here with a code." : "You sign in inside the agent's isolated browser."}</p></div></li>
          </ol>
          <button type="button" className="pill primary" data-sfx="confirm" disabled={busy === platform || !handles[platform]} onClick={() => connect(platform)}><Link2 size={14} /> {busy === platform ? "Waiting for signature…" : platform === "x" ? "Connect X" : "Link FOMO profile"}</button>
        </div>
        : <div className="stack" style={{ marginTop: 12 }}><p className="dim">{address ? "Only the creator wallet can connect accounts." : "Connect the creator wallet to link an account."}</p>{!address && <button type="button" className="pill sm" onClick={openWallet}>Connect wallet</button>}</div>}
      </section>; })}</div>
    {message && <p className="notice reveal-up" role="status">{message}</p>}
    <p className="dim reveal-up"><Link href="/docs#social">How accounts are connected</Link> · connections are signed by the creator wallet and stored by the operations service, never by the agent.</p>
  </div>;
}
