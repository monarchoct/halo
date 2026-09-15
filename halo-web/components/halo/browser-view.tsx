"use client";
import { useEffect, useRef, useState } from "react";
import { keccak256, toHex, verifyMessage, type Address, type Hash } from "viem";
import { Monitor, Pause, Play, LockKeyhole, Maximize2, Minimize2 } from "lucide-react";
import { useProtocol } from "./protocol-provider";
import { shortAddress } from "@/lib/halo-types";

type Frame = { version: string; chainId: number; registry: Address; agent: Address; operator: Address;
  sessionId: string; sequence: number; previousHash: Hash; timestamp: string; source: string; siteOrigin: string;
  activity: string; state: string; width: number; height: number; mimeType: "image/png" | "image/jpeg" | null; imageHash: Hash | null; surface?: "browser" | "desktop" };
type ScreenRecord = { frame: Frame; hash: Hash; signature: Hash };
function canonical(value: unknown): string { if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`; if (value !== null && typeof value === "object") return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical((value as { [key: string]: unknown })[key])}`).join(",")}}`; return JSON.stringify(value); }
const states = ["viewing", "working", "private", "needs-account", "complete", "error"];
const sources = ["production-browser", "development-capture", "local-browser-worker"];

export function BrowserView({ agent }: { agent: Address }) {
  const { deployment } = useProtocol();
  const [records, setRecords] = useState<ScreenRecord[]>([]), [paused, setPaused] = useState(false), [selected, setSelected] = useState("");
  const [image, setImage] = useState<string>(), [error, setError] = useState(""), [connected, setConnected] = useState(false), [now, setNow] = useState(Date.now());
  const container = useRef<HTMLDivElement>(null);
  const [fullscreen, setFullscreen] = useState(false);
  useEffect(() => {
    const changed = () => setFullscreen(document.fullscreenElement === container.current);
    changed(); document.addEventListener("fullscreenchange", changed);
    return () => document.removeEventListener("fullscreenchange", changed);
  }, []);
  const endpoint = deployment?.browserApiUrl;
  useEffect(() => {
    setRecords([]); setImage(undefined); setConnected(false); setError(""); setPaused(false); setSelected("");
    if (!endpoint || !deployment) return;
    let disposed = false, queue = Promise.resolve(); const seen = new Set<string>();
    const events = new EventSource(`${endpoint}/v1/agents/${agent}/browser/stream`);
    events.onopen = () => setConnected(true); events.onerror = () => setConnected(false);
    events.onmessage = event => { queue = queue.then(async () => {
      try {
        if (event.data.length > 8192) throw new Error("Oversized screen report");
        const record = JSON.parse(event.data) as ScreenRecord, frame = record.frame;
        if (!frame || frame.version !== "halo.browser-frame.v1" || frame.agent.toLowerCase() !== agent.toLowerCase()
          || frame.chainId !== deployment.chainId || frame.registry.toLowerCase() !== deployment.registry.toLowerCase()
          || !states.includes(frame.state) || frame.activity.length > 240 || !Number.isSafeInteger(frame.sequence)
          || !Number.isFinite(Date.parse(frame.timestamp)) || !sources.includes(frame.source) || (frame.surface!==undefined && !["browser","desktop"].includes(frame.surface))
          || (frame.source !== "production-browser" && deployment.environment !== "local")) throw new Error("Wrong browser report");
        const origin = new URL(frame.siteOrigin);
        if (origin.protocol !== "https:" || origin.origin !== frame.siteOrigin) throw new Error("Invalid site origin");
        const message = `HALO_BROWSER_FRAME_V1\n${canonical(frame)}`;
        if (keccak256(toHex(message)) !== record.hash || !(await verifyMessage({ address: frame.operator, message, signature: record.signature }))) throw new Error("Invalid screen signature");
        if (disposed || seen.has(record.hash)) return; seen.add(record.hash);
        // Keep replay bookkeeping bounded during long-running viewing sessions.
        if (seen.size > 240) seen.delete(seen.values().next().value!);
        setRecords(current => [...current, record].slice(-120));
      } catch { if (!disposed) setError("An invalid screen report was excluded."); }
    }); };
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => { disposed = true; clearInterval(timer); events.close(); };
  }, [agent, endpoint, deployment]);
  const latest = records.at(-1), current = paused ? records.find(value => value.hash === selected) ?? latest : latest;
  useEffect(() => {
    setImage(undefined);
    if (!current?.frame.imageHash || !endpoint || ["private", "needs-account", "error"].includes(current.frame.state)) return;
    let disposed = false, objectUrl: string | undefined; const controller = new AbortController();
    (async () => {
      const response = await fetch(`${endpoint}/v1/browser/frames/${current.hash}/image`, { signal: controller.signal });
      if (!response.ok || Number(response.headers.get("content-length")) > 2000000) throw new Error("Screen unavailable");
      const bytes = await response.arrayBuffer(); if (bytes.byteLength > 2000000) throw new Error("Screen too large");
      const digest = toHex(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)));
      if (digest !== current.frame.imageHash) throw new Error("Screen digest mismatch");
      if (!disposed) { objectUrl = URL.createObjectURL(new Blob([bytes], { type: current.frame.mimeType ?? "image/png" })); setImage(objectUrl); }
    })().catch(() => { if (!disposed) setError("The screen could not be retrieved and verified."); });
    return () => { disposed = true; controller.abort(); if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [current, endpoint]);
  const age = latest ? Math.floor((now - Date.parse(latest.frame.timestamp)) / 1000) : undefined;
  const live = connected && age !== undefined && age >= -5 && age < 12 && latest && ["viewing", "working", "private"].includes(latest.frame.state);
  const privacy = current && ["private", "needs-account"].includes(current.frame.state);
  return <div className="browser-view" ref={container}>
    <div className="browser-view-heading"><div><Monitor size={18} /><h3>{current?.frame.surface==="desktop"?"Inside the agent’s desktop":"Inside the agent’s browser"}</h3></div>
      <span className={`browser-live-label${live && !paused ? " is-live" : ""}`}>{paused ? "Playback paused" : live ? "Live" : latest ? "Last recorded view" : "Waiting for a browser"}</span></div>
    <div className="browser-chrome"><span className="browser-dots" aria-hidden="true"><i /><i /><i /></span>
      <span>{current?.frame.siteOrigin ?? "Isolated browser session"}</span>
      <button type="button" aria-label={fullscreen ? "Exit fullscreen viewer" : "Expand browser viewer"} onClick={() => {
        const action = fullscreen ? document.exitFullscreen?.() : container.current?.requestFullscreen?.();
        action?.catch(() => setError("Fullscreen is unavailable in this browser."));
      }}>{fullscreen ? <Minimize2 size={15} /> : <Maximize2 size={15} />}</button></div>
    <div className="browser-screen">
      {image ? <img src={image} alt={`Operator ${current?.frame.surface === "desktop" ? "desktop" : "browser"}: ${current?.frame.activity}`} width={current?.frame.width} height={current?.frame.height} /> : <div className="browser-empty">
        {privacy ? <LockKeyhole size={28} /> : <Monitor size={30} />}<h4>{privacy ? "Private browser step" : current ? "Screen unavailable" : "A window into the work."}</h4>
        <p>{privacy ? "Private steps are not shown. Login, identity checks and credentials remain hidden." : current?.frame.activity ?? "When an operator connects its browser, public research and social activity appear here. No browser session is currently being reported."}</p>
      </div>}
      {current?.frame.source === "development-capture" && <span className="browser-dev-label">Development capture · Codex-controlled browser</span>}
      {current?.frame.source === "local-browser-worker" && <span className="browser-dev-label">Local Linux {current.frame.surface==="desktop"?"desktop":"worker"} · Operator-reported session</span>}
    </div>
    <div className="browser-controls"><button type="button" className="browser-play" disabled={!latest} aria-label={paused ? "Resume latest screen" : "Pause browser playback"}
      onClick={() => { setSelected(current?.hash ?? ""); setPaused(value => !value); }}>{paused ? <Play size={15} /> : <Pause size={15} />}</button>
      <p>{current?.frame.activity ?? "Public browser activity will appear automatically."}</p><time dateTime={current?.frame.timestamp}>{current ? new Date(current.frame.timestamp).toLocaleTimeString() : "—"}</time></div>
    {paused && records.length > 1 && <label className="browser-history">Recorded step<select value={current?.hash ?? ""} onChange={event => setSelected(event.target.value)}>{records.map(record => <option key={record.hash} value={record.hash}>{new Date(record.frame.timestamp).toLocaleTimeString()} · {record.frame.activity}</option>)}</select></label>}
    {error && <p className="inline-error">{error}</p>}
    <p className="small-note" role="status">{!endpoint ? "No screen service configured." : !connected ? "Screen connection unavailable · reconnecting automatically." : "Screen relay connected."}
      {age !== undefined && (age < -5 ? " The report timestamp is ahead of this device; live status cannot be verified." : ` Latest report ${Math.max(0, age)} seconds ago.`)}
      {connected && !live && latest ? " A connected relay does not mean the agent is currently operating." : ""}</p>
    <div className="browser-verification"><p>{current ? `${image ? "Screen hash and signature verified" : "Report signature verified"} · Operator ${shortAddress(current.frame.operator)}` : "Read-only viewer · No remote control of the agent"}</p>
      <p>The operator supplies this view. A signature identifies its publisher; it cannot establish that nobody else controlled the browser.</p></div>
    {current && <details className="signature-details"><summary>Browser record & signature</summary><code>{current.hash}</code><code>{current.signature}</code></details>}
  </div>;
}
