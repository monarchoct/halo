"use client";
import { useEffect, useRef, useState } from "react";
import { keccak256, toHex, verifyMessage, type Address, type Hash } from "viem";
import { Monitor, Pause, Play, LockKeyhole, Maximize2, Minimize2, Copy, Check } from "lucide-react";
import { useProtocol } from "./protocol-provider";
import { AddressTap } from "./market-card";
import { shortAddress, relativeTime } from "@/lib/format";
import { play } from "@/lib/sound";

type Frame = { version: string; chainId: number; registry: Address; agent: Address; operator: Address; sessionId: string; sequence: number; previousHash: Hash; timestamp: string; source: string; siteOrigin: string; activity: string; state: string; width: number; height: number; mimeType: "image/png" | "image/jpeg" | null; imageHash: Hash | null; surface?: "browser" | "desktop"; sandbox?: string };
type ScreenRecord = { frame: Frame; hash: Hash; signature: Hash };
function canonical(value: unknown): string { if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`; if (value !== null && typeof value === "object") return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical((value as { [key: string]: unknown })[key])}`).join(",")}}`; return JSON.stringify(value); }
const states = ["viewing", "working", "private", "needs-account", "complete", "error"], sources = ["production-browser", "development-capture", "local-browser-worker"];

/** Read-only viewer for operator-signed screen frames. Every frame's signature and image digest are verified here before display. */
export function BrowserView({ agent }: { agent: Address }) {
  const { deployment } = useProtocol();
  const endpoint = deployment?.browserApiUrl, key = `${endpoint}:${agent}`;
  const [stream, setStream] = useState<{ key: string; records: ScreenRecord[]; connected: boolean; error: string }>({ key: "", records: [], connected: false, error: "" });
  const view = stream.key === key ? stream : { key, records: [], connected: false, error: "" };
  const [paused, setPaused] = useState(false), [selected, setSelected] = useState(""), [image, setImage] = useState<{ hash: string; url: string } | null>(null), [now, setNow] = useState(0), [fullscreen, setFullscreen] = useState(false), [copied, setCopied] = useState(false);
  const container = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const changed = () => setFullscreen(document.fullscreenElement === container.current);
    document.addEventListener("fullscreenchange", changed);
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => { document.removeEventListener("fullscreenchange", changed); clearInterval(timer); };
  }, []);
  useEffect(() => {
    if (!endpoint || !deployment) return;
    let disposed = false, queue = Promise.resolve(); const seen = new Set<string>();
    const patch = (value: Partial<typeof stream>) => setStream(s => ({ ...(s.key === key ? s : { key, records: [], connected: false, error: "" }), ...value, key }));
    const events = new EventSource(`${endpoint}/v1/agents/${agent}/browser/stream`);
    events.onopen = () => patch({ connected: true }); events.onerror = () => patch({ connected: false });
    events.onmessage = event => { queue = queue.then(async () => {
      try {
        if (event.data.length > 8192) throw new Error("Oversized screen report");
        const record = JSON.parse(event.data) as ScreenRecord, frame = record.frame;
        if (!frame || frame.version !== "halo.browser-frame.v1" || frame.agent.toLowerCase() !== agent.toLowerCase() || frame.chainId !== deployment.chainId || frame.registry.toLowerCase() !== deployment.registry.toLowerCase()
          || !states.includes(frame.state) || frame.activity.length > 240 || !Number.isSafeInteger(frame.sequence) || !Number.isFinite(Date.parse(frame.timestamp)) || !sources.includes(frame.source)
          || (frame.surface !== undefined && !["browser", "desktop"].includes(frame.surface)) || (frame.source !== "production-browser" && deployment.environment !== "local")) throw new Error("Wrong browser report");
        const origin = new URL(frame.siteOrigin);
        if (origin.protocol !== "https:" || origin.origin !== frame.siteOrigin) throw new Error("Invalid site origin");
        const message = `HALO_BROWSER_FRAME_V1\n${canonical(frame)}`;
        if (keccak256(toHex(message)) !== record.hash || !(await verifyMessage({ address: frame.operator, message, signature: record.signature }))) throw new Error("Invalid screen signature");
        if (disposed || seen.has(record.hash)) return; seen.add(record.hash);
        if (seen.size > 240) seen.delete(seen.values().next().value!); // bounded replay bookkeeping for long sessions
        setStream(s => { const base = s.key === key ? s : { key, records: [], connected: true, error: "" }; return { ...base, records: [...base.records, record].slice(-120) }; });
      } catch { if (!disposed) patch({ error: "An invalid screen report was excluded." }); }
    }); };
    return () => { disposed = true; events.close(); };
  }, [agent, endpoint, deployment, key]);
  const latest = view.records.at(-1), current = paused ? view.records.find(v => v.hash === selected) ?? latest : latest;
  const privacy = !!current && ["private", "needs-account"].includes(current.frame.state);
  useEffect(() => {
    if (!current?.frame.imageHash || !endpoint || privacy) return;
    let disposed = false, objectUrl: string | undefined; const controller = new AbortController();
    (async () => {
      const response = await fetch(`${endpoint}/v1/browser/frames/${current.hash}/image`, { signal: controller.signal });
      if (!response.ok || Number(response.headers.get("content-length")) > 2000000) throw new Error("Screen unavailable");
      const bytes = await response.arrayBuffer(); if (bytes.byteLength > 2000000) throw new Error("Screen too large");
      if (toHex(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))) !== current.frame.imageHash) throw new Error("Screen digest mismatch");
      if (!disposed) { objectUrl = URL.createObjectURL(new Blob([bytes], { type: current.frame.mimeType ?? "image/png" })); setImage({ hash: current.hash, url: objectUrl }); }
    })().catch(() => { if (!disposed) setStream(s => ({ ...s, error: "The screen could not be retrieved and verified." })); });
    return () => { disposed = true; controller.abort(); if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [current, endpoint, privacy]);
  const shown = image && current && image.hash === current.hash ? image.url : undefined;
  const age = latest && now ? Math.floor((now - Date.parse(latest.frame.timestamp)) / 1000) : undefined;
  const live = view.connected && age !== undefined && age >= -5 && age < 12 && !!latest && ["viewing", "working", "private"].includes(latest.frame.state);
  const streamUrl = endpoint ? `${endpoint}/v1/agents/${agent}/browser/stream` : "";
  const urlLabel = current?.frame.siteOrigin ?? (endpoint ? "Isolated browser session" : "No screen service");
  const explorerUrl = deployment?.explorerUrl;
  const copyStream = async () => {
    if (!streamUrl) return;
    try { await navigator.clipboard.writeText(streamUrl); setCopied(true); play("confirm"); setTimeout(() => setCopied(false), 2000); } catch { setStream(s => ({ ...s, error: "The stream address could not be copied." })); }
  };
  const toggleFullscreen = () => { (fullscreen ? document.exitFullscreen?.() : container.current?.requestFullscreen?.())?.catch(() => setStream(s => ({ ...s, error: "Fullscreen is unavailable in this browser." }))); };
  const recordedTag = !live && latest && !paused ? `Last recorded view · ${now ? relativeTime(latest.frame.timestamp) : "—"}` : paused && current ? `Paused · ${now ? relativeTime(current.frame.timestamp) : "—"}` : "";
  return <div className="browser-view reveal-up" ref={container} id="live">
    <div className="row between">
      <div className="row" style={{ gap: 8 }}><Monitor size={18} /><h3>{current?.frame.surface === "desktop" ? "Inside the agent’s desktop" : "Inside the agent’s browser"}</h3></div>
      <div className="row" style={{ gap: 6 }}>
        <span className={`chip ${live && !paused ? "green live" : paused ? "bronze" : ""}`}>{live && !paused && <i aria-hidden="true" />}{paused ? "Playback paused" : live ? "Live" : latest ? "Last recorded view" : "Waiting for a browser"}</span>
        {current && <span className="chip" title="Frame sequence number">#{current.frame.sequence}</span>}
      </div>
    </div>
    <div>
      <div className="browser-chrome">
        <span className="dots" aria-hidden="true"><i /><i /><i /></span>
        <button type="button" className="url tap" onClick={copyStream} disabled={!streamUrl} title={streamUrl ? `Copy stream address ${streamUrl}` : "No screen service configured"} aria-label={copied ? "Stream address copied" : "Copy the stream address"}>
          {copied ? <span className="copied row" style={{ gap: 6, justifyContent: "center" }}><Check size={12} /> Stream address copied</span> : <span className="row" style={{ gap: 6, justifyContent: "center" }}><Copy size={12} /> {urlLabel}</span>}
        </button>
        <button type="button" className="pill sm" aria-label={fullscreen ? "Exit fullscreen viewer" : "Open the viewer fullscreen"} onClick={toggleFullscreen}>{fullscreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}{fullscreen ? "Exit" : "Fullscreen"}</button>
      </div>
      <div className="browser-screen">
        {/* Verified blob URLs cannot go through next/image. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {shown ? <img src={shown} alt={`Operator ${current?.frame.surface === "desktop" ? "desktop" : "browser"}: ${current?.frame.activity}`} width={current?.frame.width} height={current?.frame.height} /> : <div className="browser-empty reveal-up">{privacy ? <LockKeyhole size={28} /> : <Monitor size={30} />}<h4>{privacy ? "Private browser step" : current ? "Screen unavailable" : "A window into the work."}</h4><p>{privacy ? "Login, identity checks and credentials are never shown." : current?.frame.activity ?? "When an operator connects its browser, public research and social activity appear here."}</p></div>}
        <span className="row browser-tag" style={{ gap: 6, right: 10 }}>
          {recordedTag && <span className="chip dark">{recordedTag}</span>}
          {current?.frame.source === "development-capture" && <span className="chip">Development capture</span>}
          {current?.frame.source === "local-browser-worker" && <span className="chip">Local Linux {current.frame.surface === "desktop" ? "desktop" : "worker"}</span>}
          {current?.frame.sandbox === "container-only" && <span className="chip bronze" style={{ marginLeft: "auto" }}>Container isolation only</span>}
        </span>
      </div>
    </div>
    <div className="browser-controls">
      <button type="button" className="pill icon sm" disabled={!latest} aria-label={paused ? "Resume latest screen" : "Pause browser playback"} onClick={() => { setSelected(current?.hash ?? ""); setPaused(v => !v); }}>{paused ? <Play size={14} /> : <Pause size={14} />}</button>
      <p>{current?.frame.activity ?? "Public browser activity appears automatically."}</p>
      {current?.frame.siteOrigin && <a className="chip" href={current.frame.siteOrigin} target="_blank" rel="noreferrer" title="Open the site the agent is viewing">{new URL(current.frame.siteOrigin).host} ↗</a>}
      <time className="mono num" dateTime={current?.frame.timestamp}>{current ? new Date(current.frame.timestamp).toLocaleTimeString() : "—"}</time>
    </div>
    {paused && view.records.length > 1 && <label className="field"><span className="sr-only">Recorded step</span><select className="input" value={current?.hash ?? ""} onChange={e => setSelected(e.target.value)}>{view.records.map(r => <option key={r.hash} value={r.hash}>{new Date(r.frame.timestamp).toLocaleTimeString()} · {r.frame.activity}</option>)}</select></label>}
    {view.error && <p className="notice err" role="alert">{view.error}</p>}
    <p className="dim" role="status">{!endpoint ? "No screen service configured." : !view.connected ? "Screen relay unavailable · reconnecting automatically." : "Screen relay connected."}{age !== undefined && (age < -5 ? " Report timestamp is ahead of this device." : ` Latest report ${Math.max(0, age)}s ago.`)}{view.connected && !live && latest ? " A connected relay does not mean the agent is operating right now." : ""}</p>
    <p className="dim">{current ? <>{shown ? "Screen hash and signature verified" : "Report signature verified"} · Operator <AddressTap address={current.frame.operator} explorerUrl={explorerUrl} /> ({shortAddress(current.frame.operator)}).</> : "Read-only viewer · no remote control of the agent."} A signature identifies the publisher; it cannot prove nobody else controlled the browser.</p>
    {current && <details className="disclosure"><summary>Browser record &amp; signature</summary><div className="hash-block" style={{ marginTop: 8 }}><span className="mono">Record hash</span><code className="hash">{current.hash}</code><span className="mono">Operator signature</span><code className="hash">{current.signature}</code><span className="mono">Session</span><code className="hash">{current.frame.sessionId}</code></div></details>}
  </div>;
}
