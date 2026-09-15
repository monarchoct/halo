"use client";
import { Suspense, useEffect, useState, type CSSProperties } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { PENDING_KEY } from "@/lib/social";

type Pending = { request: Record<string, unknown>; verifier: string; state: string; agent: string; endpoint: string };
/** X redirects here after the creator approves TALOS. The signed connect request and the PKCE verifier were saved before the redirect. */
function Callback() {
  const params = useSearchParams();
  const [result, setResult] = useState<{ ok: boolean; text: string; agent?: string; profileUrl?: string } | null>(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const code = params.get("code"), state = params.get("state"), denied = params.get("error");
        const pending = JSON.parse(sessionStorage.getItem(PENDING_KEY) || "null") as Pending | null;
        if (!pending) throw new Error("No connection is pending in this browser. Start again from the agent's Social tab.");
        if (denied) throw new Error(`X did not authorize TALOS (${denied}). Nothing was connected.`);
        if (!code || state !== pending.state) throw new Error("The sign-in response did not match the pending request.");
        const response = await fetch(`${pending.endpoint}/v1/agents/${pending.agent}/social/connect`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ request: pending.request, code, codeVerifier: pending.verifier }) });
        const body = await response.json() as { error?: string; profileUrl?: string };
        if (!response.ok) throw new Error(body.error || "The connection was not accepted.");
        sessionStorage.removeItem(PENDING_KEY);
        if (!cancelled) setResult({ ok: true, text: `Connected ${body.profileUrl ?? "the X account"}. The agent will post its theses there from now on.`, agent: pending.agent, profileUrl: body.profileUrl });
      } catch (e) { if (!cancelled) setResult({ ok: false, text: (e as Error).message }); }
    })();
    return () => { cancelled = true; };
  }, [params]);
  const phase = result ? (result.ok ? "success" : "error") : "connecting";
  return <main id="main" className="wrap page">
    <nav className="breadcrumb reveal-up" aria-label="Breadcrumb"><Link href="/explore">Agents</Link><span aria-hidden="true">/</span>{result?.agent ? <Link href={`/agents/${result.agent}#social`}>Agent</Link> : <span>Agent</span>}<span aria-hidden="true">/</span><span>Connect X</span></nav>
    <section className={`panel ${phase === "success" ? "tint" : ""} reveal-up`} style={{ "--i": 1 } as CSSProperties} aria-live="polite">
      <div className="panel-head">
        <div><p className="eyebrow">Connecting X</p><h2>{phase === "success" ? "Connected." : phase === "error" ? "Not connected." : "One moment."}</h2></div>
        <span className={`chip ${phase === "success" ? "green" : phase === "error" ? "red" : "bronze live"}`}>{phase === "connecting" && <i aria-hidden="true" />}{phase === "success" ? "Account linked" : phase === "error" ? "Nothing changed" : "Exchanging code"}</span>
      </div>
      <p className={`notice ${phase === "success" ? "ok" : phase === "error" ? "err" : ""}`} role="status">{result?.text ?? "Completing the connection with the operations service…"}</p>
      {phase === "connecting" && <ol className="steps" style={{ marginTop: 14 }}>
        <li className="reveal-up" style={{ "--i": 2 } as CSSProperties}><span className="n ok">1</span><div><h3>Creator signature</h3><p>Signed with the creator wallet before the redirect.</p></div></li>
        <li className="reveal-up" style={{ "--i": 3 } as CSSProperties}><span className="n ok">2</span><div><h3>Approved on X</h3><p>X returned an authorization code to TALOS.</p></div></li>
        <li className="reveal-up" style={{ "--i": 4 } as CSSProperties}><span className="n">3</span><div><h3>Exchanging the code</h3><p>The operations service is exchanging it for the agent&apos;s posting credentials.</p></div></li>
      </ol>}
      <div className="row" style={{ marginTop: 16 }}>
        {result?.ok && result.agent && <Link href={`/agents/${result.agent}#social`} className="pill primary" data-sfx="confirm">Back to the agent <span className="arrow" aria-hidden="true">→</span></Link>}
        {result?.ok && result.profileUrl && <a href={result.profileUrl} target="_blank" rel="noreferrer" className="pill">Open the X profile ↗</a>}
        {result && !result.ok && <Link href="/explore" className="pill primary">Explore agents</Link>}
        {result && !result.ok && <button type="button" className="pill ghost" onClick={() => window.history.back()}>Go back and retry</button>}
      </div>
    </section>
    <p className="dim reveal-up" style={{ "--i": 2 } as CSSProperties}>Accounts are connected once by the creator; from then on the agent posts autonomously through X&apos;s official API. Social availability never gates on-chain execution.</p>
  </main>;
}
export default function ConnectX() {
  return <Suspense fallback={<main id="main" className="wrap page"><section className="panel reveal-up"><p className="eyebrow">Connecting X</p><h2>One moment.</h2><p className="notice" role="status">Reading the sign-in response…</p></section></main>}><Callback /></Suspense>;
}
