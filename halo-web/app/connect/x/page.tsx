"use client";
import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { PENDING_KEY } from "@/lib/social";

type Pending = { request: Record<string, unknown>; verifier: string; state: string; agent: string; endpoint: string };
/** X redirects here after the creator approves HALO. The signed connect request and the PKCE verifier were saved before the redirect. */
function Callback() {
  const params = useSearchParams();
  const [result, setResult] = useState<{ ok: boolean; text: string; agent?: string } | null>(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const code = params.get("code"), state = params.get("state"), denied = params.get("error");
        const pending = JSON.parse(sessionStorage.getItem(PENDING_KEY) || "null") as Pending | null;
        if (!pending) throw new Error("No connection is pending in this browser. Start again from the agent's Social tab.");
        if (denied) throw new Error(`X did not authorize HALO (${denied}). Nothing was connected.`);
        if (!code || state !== pending.state) throw new Error("The sign-in response did not match the pending request.");
        const response = await fetch(`${pending.endpoint}/v1/agents/${pending.agent}/social/connect`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ request: pending.request, code, codeVerifier: pending.verifier }) });
        const body = await response.json() as { error?: string; profileUrl?: string };
        if (!response.ok) throw new Error(body.error || "The connection was not accepted.");
        sessionStorage.removeItem(PENDING_KEY);
        if (!cancelled) setResult({ ok: true, text: `Connected ${body.profileUrl ?? "the X account"}. The agent will post its theses there from now on.`, agent: pending.agent });
      } catch (e) { if (!cancelled) setResult({ ok: false, text: (e as Error).message }); }
    })();
    return () => { cancelled = true; };
  }, [params]);
  return <main id="main" className="wrap page"><div><p className="eyebrow">Connecting X</p><h1>{result ? (result.ok ? "Connected" : "Not connected") : "One moment"}</h1></div>
    <p className={`notice ${result ? (result.ok ? "ok" : "err") : ""}`} role="status">{result?.text ?? "Completing the connection with the operations service…"}</p>
    {result?.agent && <Link href={`/agents/${result.agent}`} className="pill primary" style={{ width: "fit-content" }}>Back to the agent</Link>}
    {result && !result.ok && <Link href="/explore" className="pill" style={{ width: "fit-content" }}>Explore agents</Link>}
  </main>;
}
export default function ConnectX() { return <Suspense fallback={<main id="main" className="wrap page"><p className="dim">One moment…</p></main>}><Callback /></Suspense>; }
