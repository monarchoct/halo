"use client";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { formatUnits } from "viem";
import type { Market } from "@/lib/halo-types";
import { countUp } from "@/lib/reveal";
import { useProtocol } from "./protocol-provider";

type Point = { time: number; price: number; volume: number; kind: string; venue: string; transactionHash: string; blockNumber: string; logIndex: number };
type Candle = { time: number; open: number; high: number; low: number; close: number; volume: number; trades: number };
type History = { token: string; registry: string; chainId: number; observedAt: number; observedBlock: string; points: Point[]; candles?: Candle[]; bucketMs?: number; truncated?: boolean; disclosure: string };
const ranges = { "1H": 3600e3, "6H": 21600e3, "1D": 86400e3, "7D": 604800e3, "ALL": Infinity } as const;
const fmt = (n: number) => n === 0 ? "0" : Math.abs(n) < .0001 ? n.toExponential(3) : new Intl.NumberFormat("en", { maximumSignificantDigits: 5, notation: Math.abs(n) >= 1e5 ? "compact" : "standard" }).format(n);
const whole = (n: number) => Math.round(n).toLocaleString("en-US");
const when = (n: number) => new Date(n).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
// Plot geometry (viewBox units). Price occupies the top band, volume the bottom strip, axis labels below.
const W = 1000, H = 360, L = 16, R = 88, TOP = 18, PB = 250, VB = 322, VH = 46, AX = 350;

/** Animates a headline number towards `value` whenever it changes; the element keeps its rendered text without JS. */
function useCount(value: number | null, format: (n: number) => string, ms = 900) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => { if (ref.current && value !== null) return countUp(ref.current, value, ms, format); }, [value, format, ms]);
  return ref;
}

/** Single-series price line with a buy/sell volume strip, crosshair tooltip and keyboard scrubbing. Only verified chain history is drawn. */
export function CoinChart({ token }: { token: Market }) {
  const { deployment, transaction } = useProtocol();
  const [snapshot, setSnapshot] = useState<{ key: string; history?: History; error?: string }>({ key: "" });
  const [range, setRange] = useState<keyof typeof ranges>("ALL"), [metric, setMetric] = useState<"price" | "fdv">("price"), [hover, setHover] = useState<number | null>(null), [retry, setRetry] = useState(0);
  const gradient = useId().replace(/:/g, "");
  const key = `${deployment?.chainId}:${token.address}:${retry}`;
  const history = snapshot.key === key ? snapshot.history : undefined, error = snapshot.key === key ? snapshot.error : "";
  useEffect(() => {
    if (!deployment) return;
    const abort = new AbortController(); let running = false;
    async function update() {
      if (running) return; running = true;
      try {
        const response = await fetch(`${deployment!.historyApiUrl || deployment!.apiUrl}/v1/tokens/${token.address}/history`, { signal: abort.signal, cache: "no-store" });
        if (!response.ok) throw new Error("Price history is temporarily unavailable. No estimated history is shown.");
        const data: History = await response.json();
        if (data.token.toLowerCase() !== token.address.toLowerCase() || data.chainId !== deployment!.chainId || data.registry.toLowerCase() !== deployment!.registry.toLowerCase()) throw new Error("History does not match this market.");
        if (!abort.signal.aborted) setSnapshot({ key, history: data });
      } catch (e) { if (!abort.signal.aborted) setSnapshot(s => ({ key, history: s.key === key ? s.history : undefined, error: (e as Error).message })); }
      finally { running = false; }
    }
    void update(); const interval = setInterval(update, 30000);
    return () => { abort.abort(); clearInterval(interval); };
  }, [deployment, token.address, key, transaction?.hash, transaction?.state]);

  // Prefer server candles (close series) when present; fall back to raw points.
  const series = useMemo<Point[]>(() => {
    if (!history) return [];
    const cutoff = history.observedAt - ranges[range];
    const raw = history.points.filter(p => p.time >= cutoff);
    if (history.candles?.length && (raw.length > 600 || history.truncated)) return history.candles.filter(c => c.time >= cutoff).map(c => ({ time: c.time, price: c.close, volume: c.volume, kind: "bucket", venue: `${c.trades} trades`, transactionHash: "", blockNumber: "", logIndex: 0 }));
    return raw;
  }, [history, range]);
  const factor = metric === "fdv" ? Number(formatUnits(BigInt(token.totalSupply), token.decimals)) : 1;
  const values = series.map(p => p.price * factor);
  const min = Math.min(...values), max = Math.max(...values), pad = (max - min || max || 1) * .12, lo = Math.max(0, min - pad), hi = max + pad;
  const t0 = series[0]?.time ?? 0, t1 = series.at(-1)?.time ?? t0;
  const x = (p: Point) => t0 === t1 ? (W - R + L) / 2 : L + (p.time - t0) / (t1 - t0) * (W - L - R);
  const y = (p: Point) => PB - (p.price * factor - lo) / (hi - lo) * (PB - TOP);
  const line = series.map((p, i) => `${i ? "L" : "M"}${x(p).toFixed(1)},${y(p).toFixed(1)}`).join(" ");
  const idx = hover === null ? series.length - 1 : Math.min(hover, series.length - 1), sel = series[idx];
  const vmax = Math.max(1e-30, ...series.map(p => p.volume));
  const trades = history?.points.filter(p => p.kind === "buy" || p.kind === "sell") ?? [];
  const vol24 = trades.filter(p => p.time >= (history?.observedAt ?? 0) - 86400e3).reduce((s, p) => s + p.volume, 0);
  const ath = history?.points.length ? Math.max(...history.points.map(p => p.price)) : 0;
  const first = history?.points[0]?.price ?? 0, last = history?.points.at(-1)?.price ?? 0, change = first ? (last - first) / first * 100 : 0;
  const explorer = deployment?.explorerUrl;
  const priceRef = useCount(sel ? sel.price * factor : null, fmt, 450);
  const volRef = useCount(history ? vol24 : null, fmt), athRef = useCount(history ? ath : null, fmt), tradesRef = useCount(history ? trades.length : null, whole);
  const recent = trades.slice(-12).reverse();
  return <section className="chart" id="chart" aria-label={`${token.symbol} price history`}>
    <div className="chart-head reveal-up">
      <div><p className="eyebrow">{metric === "price" ? "Price" : "Fully diluted value"} · {token.quoteSymbol}</p>
        <div className="price num"><span ref={priceRef}>{sel ? fmt(sel.price * factor) : "—"}</span><small>{token.quoteSymbol}</small>{history && hover === null && <small className={change >= 0 ? "pos" : "neg"}>{change >= 0 ? "+" : ""}{change.toFixed(1)}% all time</small>}</div>
        <p className="date">{sel ? `${when(sel.time)} · ${sel.kind}${sel.venue ? ` · ${sel.venue}` : ""}` : history ? "No events in this range" : "Waiting for chain history"}</p></div>
      <div className="row"><div className="seg" role="group" aria-label="Metric">{(["price", "fdv"] as const).map(m => <button key={m} type="button" aria-pressed={metric === m} onClick={() => { setMetric(m); setHover(null); }}>{m === "price" ? "Price" : "FDV"}</button>)}</div>
        <div className="chips" role="group" aria-label="Time range">{(Object.keys(ranges) as (keyof typeof ranges)[]).map(r => <button key={r} type="button" data-sfx="click" aria-pressed={range === r} onClick={() => { setRange(r); setHover(null); }}>{r}</button>)}</div></div>
    </div>
    <div className="metrics">
      <button type="button" className="metric reveal-up" style={{ "--i": 0 } as React.CSSProperties} title="Show the last 24 hours" onClick={() => { setRange("1D"); setHover(null); }}><dt>24h volume</dt><dd className="num"><span ref={volRef}>{history ? fmt(vol24) : "—"}</span><small>{token.quoteSymbol}</small></dd></button>
      <button type="button" className="metric reveal-up" style={{ "--i": 1 } as React.CSSProperties} title="Show the full price history" onClick={() => { setRange("ALL"); setMetric("price"); setHover(null); }}><dt>Recorded high</dt><dd className="num"><span ref={athRef}>{history ? fmt(ath) : "—"}</span><small>{token.quoteSymbol}</small></dd></button>
      <a href="#trades" className="metric reveal-up" style={{ "--i": 2 } as React.CSSProperties} title="Jump to recent trades"><dt>Trades</dt><dd className="num"><span ref={tradesRef}>{history ? whole(trades.length) : "—"}</span><small>recorded</small></dd></a>
    </div>
    {error && <p className="notice err" role="alert">{error} {history && "The chart below is the last successful snapshot."} <button type="button" className="pill sm" onClick={() => setRetry(v => v + 1)}>Retry history</button></p>}
    {!history ? <div className="chart-empty">{error ? "History unavailable" : "Reading on-chain trades…"}</div> : !series.length ? <div className="chart-empty">No recorded events in this range. <button type="button" className="pill sm" onClick={() => { setRange("ALL"); setHover(null); }}>Show all time</button></div> : <>
      <svg className="chart-svg reveal-up" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label="Price chart. Use the slider below to inspect each event."
        onPointerMove={e => { const b = e.currentTarget.getBoundingClientRect(); const target = (e.clientX - b.left) / b.width * W; let best = 0; series.forEach((p, i) => { if (Math.abs(x(p) - target) < Math.abs(x(series[best]) - target)) best = i; }); setHover(best); }} onPointerLeave={() => setHover(null)}>
        <defs><linearGradient id={gradient} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="var(--accent)" stopOpacity=".28" /><stop offset="100%" stopColor="var(--accent)" stopOpacity="0" /></linearGradient></defs>
        {[0, .5, 1].map(r => <g key={r}><line x1={L} x2={W - R} y1={PB - (PB - TOP) * r} y2={PB - (PB - TOP) * r} stroke="var(--hair)" strokeDasharray="2 6" /><text x={W - R + 10} y={PB - (PB - TOP) * r + 4}>{fmt(lo + (hi - lo) * r)}</text></g>)}
        {series.length > 1 && <path d={`${line} L${x(series.at(-1)!).toFixed(1)},${PB} L${x(series[0]).toFixed(1)},${PB} Z`} fill={`url(#${gradient})`} />}
        <path key={`${range}:${metric}`} data-line d={line} fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
        {series.length === 1 && <circle cx={x(series[0])} cy={y(series[0])} r="5" fill="var(--accent)" />}
        {series.map((p, i) => p.volume > 0 && <rect key={i} x={x(p) - 2} y={VB + VH - Math.max(2, p.volume / vmax * VH)} width="4" height={Math.max(2, p.volume / vmax * VH)} rx="1" fill={p.kind === "sell" ? "var(--chart-sell)" : "var(--chart-buy)"} opacity={hover === null || hover === i ? .9 : .45} />)}
        {sel && <g><line x1={x(sel)} x2={x(sel)} y1={TOP} y2={VB + VH} stroke="var(--ink-3)" strokeDasharray="3 4" /><circle cx={x(sel)} cy={y(sel)} r="6" fill="var(--accent)" stroke="var(--panel)" strokeWidth="2" /></g>}
        <text x={L} y={AX}>{when(t0)}</text><text x={W - R} y={AX} textAnchor="end">{when(t1)}</text>
      </svg>
      <div className="row between chart-foot"><span className="row" style={{ gap: 6 }}><span className="chip green"><i /> buys</span> <span className="chip red"><i /> sells</span> volume in {token.quoteSymbol}</span>{history.bucketMs && series[0]?.kind === "bucket" && <span>Aggregated {history.bucketMs / 60000 >= 60 ? `${history.bucketMs / 3600000}h` : `${history.bucketMs / 60000}m`} candles</span>}</div>
      <label className="chart-scrub">Inspect<input type="range" aria-label="Inspect chart event" min="0" max={series.length - 1} value={hover ?? series.length - 1} onChange={e => setHover(Number(e.target.value))} /><span className="num">{sel && `${fmt(sel.volume)} ${token.quoteSymbol}`}</span></label>
    </>}
    <p className="chart-foot">{history?.disclosure || "Only verified chain history is displayed."} {metric === "fdv" && "FDV = price × total supply; it is not circulating market cap."} {history && (explorer ? <a href={`${explorer}/block/${history.observedBlock}`} target="_blank" rel="noreferrer" className="tap">Snapshot block {history.observedBlock} · {when(history.observedAt)}</a> : `Snapshot block ${history.observedBlock} · ${when(history.observedAt)}.`)}</p>
    {history && <div className="stack reveal-up" id="trades"><div className="panel-head"><h3>Recent trades <span className="count">{trades.length} recorded</span></h3>{trades.length > 12 && <span className="dim">Latest 12 of the recorded window</span>}</div>
      {!recent.length ? <p className="dim">No trades yet. The chart shows the launch price.</p> : <div className="list">{recent.map((p, i) => {
        const buy = p.kind === "buy", tone = buy ? "pos" : "neg";
        const body = <>
          <span className={`glyph ${tone}`} aria-hidden="true">{buy ? "↑" : "↓"}</span>
          <div className="info"><span><strong className={tone}>{buy ? "Buy" : "Sell"}</strong> <span className="dim">· {p.venue}</span></span><p className="mono">{when(p.time)}</p></div>
          <div className="info" style={{ textAlign: "right" }}><strong className="num">{fmt(p.volume)} {token.quoteSymbol}</strong><span className="hash">{p.transactionHash.slice(0, 10)}…{p.transactionHash.slice(-4)}</span></div>
        </>;
        const stagger = { "--i": i % 8 } as React.CSSProperties, rowKey = `${p.transactionHash}-${p.logIndex}`;
        return explorer ? <a key={rowKey} href={`${explorer}/tx/${p.transactionHash}`} target="_blank" rel="noreferrer" className="list-row reveal-up" style={stagger} title="Open the transaction in the explorer">{body}</a>
          : <div key={rowKey} className="list-row reveal-up" style={stagger} title={p.transactionHash}>{body}</div>;
      })}</div>}</div>}
  </section>;
}
