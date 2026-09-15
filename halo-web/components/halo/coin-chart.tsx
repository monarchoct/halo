"use client";
import { useEffect, useId, useMemo, useState } from "react";
import type { Market } from "@/lib/halo-types";
import { useProtocol } from "./protocol-provider";
import { formatUnits } from "viem";

type Point = { time: number; price: number; volume: number; kind: string; venue: string; transactionHash: string; blockNumber: string; logIndex: number };
type History = { token: string; registry: string; chainId: number; observedAt: number; observedBlock: string; points: Point[]; disclosure: string };
const ranges = { "5M": 300000, "1H": 3600000, "6H": 21600000, "1D": 86400000, "ALL": Infinity };
const number = (n: number) => n === 0 ? "0" : Math.abs(n) < .0001 ? n.toExponential(3) : new Intl.NumberFormat("en", { maximumSignificantDigits: 5, notation: Math.abs(n) >= 100000 ? "compact" : "standard" }).format(n);
const date = (n: number) => new Date(n).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });

export function CoinChart({ token }: { token: Market }) {
  const { deployment, transaction } = useProtocol();
  const [history, setHistory] = useState<History | null>(null), [error, setError] = useState("");
  const [range, setRange] = useState<keyof typeof ranges>("ALL"), [metric, setMetric] = useState("price");
  const [hover, setHover] = useState<number | null>(null), [retry, setRetry] = useState(0);
  const gradient = useId().replace(/:/g, "");
  useEffect(() => {
    if (!deployment) return;
    const abort = new AbortController(); let running = false;
    setHistory(null); setError("");
    async function update() {
      if (running) return; running = true;
      try {
        const response = await fetch(`${deployment!.historyApiUrl || deployment!.apiUrl}/v1/tokens/${token.address}/history`, { signal: abort.signal, cache: "no-store" });
        if (!response.ok) throw new Error("Price history is temporarily unavailable. No estimated history is shown.");
        const data: History = await response.json();
        if (data.token.toLowerCase() !== token.address.toLowerCase() || data.chainId !== deployment!.chainId || data.registry.toLowerCase() !== deployment!.registry.toLowerCase()) throw new Error("History does not match this market.");
        if (!abort.signal.aborted) { setHistory(data); setError(""); }
      } catch (e) { if (!abort.signal.aborted) setError((e as Error).message); }
      finally { running = false; }
    }
    void update(); const interval = setInterval(update, 30000);
    return () => { abort.abort(); clearInterval(interval); };
  }, [deployment, token.address, retry, transaction?.hash, transaction?.state]);
  const points = useMemo(() => history?.points.filter(p => p.time >= history.observedAt - ranges[range]) || [], [history, range]);
  const factor = metric === "fdv" ? Number(formatUnits(BigInt(token.totalSupply), token.decimals)) : 1;
  const values = points.map(p => p.price * factor);
  const minimum = Math.min(...values), maximum = Math.max(...values);
  const pad = (maximum - minimum || maximum || 1) * .12;
  const low = Math.max(0, minimum - pad), high = maximum + pad;
  const t0 = points[0]?.time || 0, t1 = points.at(-1)?.time || t0;
  const x = (p: Point) => t0 === t1 ? 460 : 20 + (p.time - t0) / (t1 - t0) * 880;
  const y = (p: Point) => 285 - (p.price * factor - low) / (high - low) * 265;
  const line = points.map((p, i) => `${i ? "L" : "M"}${x(p)},${y(p)}`).join(" ");
  const selected = hover === null ? points.at(-1) : points[Math.min(hover, points.length - 1)];
  const volumeMax = Math.max(1e-30, ...points.map(p => p.volume));
  const trades = history?.points.filter(p => p.kind === "buy" || p.kind === "sell") || [];
  const volume24 = trades.filter(p => p.time >= (history?.observedAt || 0) - 86400000).reduce((sum, p) => sum + p.volume, 0);
  const ath = history?.points.length ? Math.max(...history.points.map(p => p.price)) : 0;
  return <section className="coin-market" aria-label={`${token.symbol} price history`}>
    <div className="coin-market-stats"><div><span>Latest price</span><strong>{history?.points.length ? number(history.points.at(-1)!.price) : "—"}<small>{token.quoteSymbol}</small></strong></div>
      <div><span>24h quote volume</span><strong>{history ? number(volume24) : "—"}<small>{token.quoteSymbol}</small></strong></div>
      <div><span>Recorded high</span><strong>{history ? number(ath) : "—"}<small>{token.quoteSymbol}</small></strong></div></div>
    <div className="coin-chart-toolbar"><div><p className="eyebrow">{metric === "price" ? "TOKEN PRICE" : "FULLY DILUTED VALUE"}</p><h2>{selected ? number(selected.price * factor) : "—"} <small>{token.quoteSymbol}</small></h2><p className="coin-chart-date">{selected ? date(selected.time) : history ? "No events in selected range" : "Waiting for chain history"}</p></div>
      <div className="coin-chart-controls"><div role="group" aria-label="Chart metric">{["price", "fdv"].map(m => <button key={m} aria-pressed={metric === m} onClick={() => { setMetric(m); setHover(null); }}>{m === "price" ? "Price" : "FDV"}</button>)}</div>
        <div role="group" aria-label="Chart time range">{Object.keys(ranges).map(r => <button key={r} aria-pressed={range === r} onClick={() => { setRange(r as keyof typeof ranges); setHover(null); }}>{r}</button>)}</div></div></div>
    {error && <p className="coin-chart-error" role="alert">{error} {history && "The chart below is the last successful snapshot."} <button onClick={() => setRetry(v => v + 1)}>Retry</button></p>}
    {!history ? <div className="coin-chart-empty">{error ? "History unavailable" : "Reading on-chain trades…"}</div> : !points.length ? <div className="coin-chart-empty">No recorded events in this time range. Choose ALL to see earlier activity.</div> : <>
      <svg className="coin-chart-svg" viewBox="0 0 1000 360" preserveAspectRatio="none" role="img" aria-label="Price chart. Use the slider below to inspect each event."
        onPointerMove={e => { const bounds = e.currentTarget.getBoundingClientRect(); const target = (e.clientX - bounds.left) / bounds.width * 1000; let index = 0; points.forEach((p, i) => { if (Math.abs(x(p) - target) < Math.abs(x(points[index]) - target)) index = i; }); setHover(index); }} onPointerLeave={() => setHover(null)}>
        <defs><linearGradient id={gradient} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#ff9100" stopOpacity=".4"/><stop offset="100%" stopColor="#7b2cbf" stopOpacity=".025"/></linearGradient></defs>
        {[0, .5, 1].map(r => <g key={r}><line x1="20" x2="905" y1={285 - 265 * r} y2={285 - 265 * r} stroke="#ffffff16" strokeDasharray="3 6"/><text x="920" y={290 - 265 * r}>{number(low + (high - low) * r)}</text></g>)}
        {points.length > 1 && <path d={`${line} L${x(points.at(-1)!)},285 L${x(points[0])},285 Z`} fill={`url(#${gradient})`}/>}
        <path d={line} fill="none" stroke="#ff9e00" strokeWidth="2.5" strokeLinejoin="round" vectorEffect="non-scaling-stroke"/>
        {points.map((p, i) => p.volume > 0 && <rect key={i} x={x(p) - 2} y={337 - p.volume / volumeMax * 35} width="4" height={p.volume / volumeMax * 35} fill={p.kind === "buy" ? "#ff9100" : "#9d4edd"} opacity=".6"/>)}
        {selected && <g><line x1={x(selected)} x2={x(selected)} y1="20" y2="337" stroke="#ffffff40"/><circle cx={x(selected)} cy={y(selected)} r="5" fill="#ff9e00" stroke="#240046" strokeWidth="2"/></g>}
        <text x="20" y="355">{date(t0)}</text><text x="900" y="355" textAnchor="end">{date(t1)}</text>
      </svg>
      <div className="coin-mobile-axis"><span>{number(minimum)} – {number(maximum)} {token.quoteSymbol}</span><span>{date(t0)} → {date(t1)}</span></div>
      <label className="coin-chart-scrubber">Inspect event <input type="range" aria-label="Inspect chart event" min="0" max={points.length - 1} value={hover ?? points.length - 1} onChange={e => setHover(Number(e.target.value))}/><span>{selected?.kind} · {selected?.venue} · {number(selected?.volume || 0)} {token.quoteSymbol} volume</span></label>
    </>}
    <p className="coin-chart-footnote">{history?.disclosure || "Only verified chain history is displayed."} {metric === "fdv" && "FDV = price × total supply; it is not circulating market cap."} {history && `Snapshot block ${history.observedBlock} · ${date(history.observedAt)}.`}</p>
    {history && <div className="coin-recent"><h3>Recent trades <small>{trades.length} recorded</small></h3>{!trades.length ? <p>No trades yet. The chart shows the launch price.</p> : <div className="coin-trades-scroll"><table><thead><tr><th>Side / venue</th><th>Quote volume</th><th>Time</th><th>Transaction</th></tr></thead><tbody>{trades.slice(-8).reverse().map(p => <tr key={`${p.transactionHash}-${p.logIndex}`}><td className={p.kind === "buy" ? "coin-buy" : "coin-sell"}>{p.kind.toUpperCase()} <small>{p.venue}</small></td><td>{number(p.volume)} {token.quoteSymbol}</td><td>{date(p.time)}</td><td>{deployment?.explorerUrl ? <a href={`${deployment.explorerUrl}/tx/${p.transactionHash}`} target="_blank" rel="noreferrer">{p.transactionHash.slice(0, 8)}…</a> : <code title={p.transactionHash}>{p.transactionHash.slice(0, 8)}…</code>}</td></tr>)}</tbody></table></div>}</div>}
  </section>;
}
