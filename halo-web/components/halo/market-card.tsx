"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import type { Agent, Market } from "@/lib/halo-types";
import { compact, curveProgress, days, fdvQuote, shortAddress } from "@/lib/format";
import { CycleRing } from "./cycle-ring";
import { Sparkline } from "./sparkline";
import { useProtocol } from "./protocol-provider";
import { play } from "@/lib/sound";

const STATUES = 12;
/** Deterministic statue for an address until creators upload their own art. */
export const statueFor = (seed: string) => { let h = 0; for (const c of seed) h = (h * 31 + c.charCodeAt(0)) >>> 0; return `/art/statues/s${h % STATUES}.jpg`; };

export function Art({ seed, symbol, kind = "agent", className = "" }: { seed: string; symbol: string; kind?: "agent" | "coin"; className?: string }) {
  if (kind === "coin") return <div className={`card-art ${className}`} aria-hidden="true"><span className="glyph">{symbol.slice(0, 2)}<small>${symbol}</small></span></div>;
  return <div className={`card-art ${className}`}><img src={statueFor(seed)} alt="" loading="lazy" decoding="async" /></div>;
}

/** Copy on click, with a two-second confirmation; the explorer link sits beside it. */
export function AddressTap({ address, explorerUrl }: { address: string; explorerUrl?: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => { try { await navigator.clipboard.writeText(address); setCopied(true); play("confirm"); setTimeout(() => setCopied(false), 2000); } catch {} };
  return <span className="row" style={{ gap: 4 }}>
    <button type="button" className={`tap ${copied ? "copied" : ""}`} onClick={copy} title="Copy address" aria-label={`Copy address ${address}`}>{copied ? "copied" : shortAddress(address)}</button>
    {explorerUrl && <a className="tap" href={`${explorerUrl}/address/${address}`} target="_blank" rel="noreferrer" title="Open in explorer" aria-label="Open in explorer">↗</a>}
  </span>;
}

/** Last 24 curve points for a token, fetched only once the card is on screen. */
function useSpark(token: string | null) {
  const { deployment } = useProtocol();
  const [values, setValues] = useState<number[]>([]);
  useEffect(() => {
    if (!token || !deployment) return;
    const abort = new AbortController();
    fetch(`${deployment.historyApiUrl ?? deployment.apiUrl}/v1/tokens/${token}/history?bucket=1h`, { signal: abort.signal, cache: "no-store" })
      .then(r => r.ok ? r.json() : null)
      .then((data: unknown) => {
        if (!data || typeof data !== "object") return;
        const d = data as Record<string, unknown>;
        const rows = (d.candles ?? d.points ?? d.history ?? d.events ?? []) as Record<string, unknown>[];
        const nums = rows.map(row => Number(row.close ?? row.price ?? row.priceQuote ?? row.value)).filter(n => Number.isFinite(n));
        if (nums.length >= 2) setValues(nums.slice(-24));
      }).catch(() => {});
    return () => abort.abort();
  }, [token, deployment]);
  return values;
}

type Filter = "active" | "idle" | "graduated";

export function AgentCard({ agent, haloSymbol = "TALOS", onFilter, index = 0 }: { agent: Agent; haloSymbol?: string; onFilter?: (f: Filter) => void; index?: number }) {
  const { deployment } = useProtocol();
  const m = agent.market, pct = m.graduated ? 100 : curveProgress(m.sold), cycles = Number(agent.nonce);
  const spark = useSpark(agent.agentToken);
  const change = spark.length >= 2 ? (spark[spark.length - 1] / spark[0] - 1) * 100 : null;
  return <article className="card hover reveal-up" style={{ "--i": index % 6 } as React.CSSProperties}>
    <Link href={`/agents/${agent.address}`} aria-label={`${agent.name}, agent`}><Art seed={agent.address} symbol={agent.symbol} /></Link>
    <div className="card-badges">
      {m.graduated ? <button type="button" className="badge grad" onClick={() => onFilter?.("graduated")} title="Show graduated agents">Graduated</button>
        : agent.active ? <button type="button" className="badge" onClick={() => onFilter?.("active")} title="Show live agents"><span className="dot" aria-hidden="true" />Live</button>
        : <button type="button" className="badge" onClick={() => onFilter?.("idle")} title="Show agents that are not activated">Not activated</button>}
    </div>
    <Link href={`/agents/${agent.address}#runtime`} className="ring" title={`Cycle ${cycles} · ${pct.toFixed(0)}% of the curve`}><CycleRing pct={pct} live={agent.active && !m.graduated} /></Link>
    <div className="card-body">
      <div className="card-title">
        <div><Link href={`/agents/${agent.address}`} className="tap"><strong>{agent.name}</strong></Link><Link href={`/tokens/${agent.agentToken}`} className="ticker tap">${agent.symbol} / ${haloSymbol}</Link></div>
        <Link href={`/tokens/${agent.agentToken}`} className="mc tap" title="Open the market"><b className="num">{compact(fdvQuote(m))} {haloSymbol}</b><span>FDV</span></Link>
      </div>
      {!m.graduated && <Link href={`/tokens/${agent.agentToken}`} className="curve" aria-label={`${pct.toFixed(1)}% of the curve sold`}><span className="progress"><i style={{ "--w": `${pct}%` } as React.CSSProperties} /></span><span className="pct num">{pct.toFixed(0)}%</span></Link>}
      <div className="card-meta">
        <Link href={`/agents/${agent.address}#runtime`} className="cycle tap">{cycles ? `cycle ${cycles}` : "no cycle yet"} · {days(agent.runwaySeconds)}d reserve</Link>
        <span className="trend">{spark.length >= 2 && <Sparkline values={spark} />}{change !== null && <span className={`chg ${change >= 0 ? "up" : "down"} num`}>{change >= 0 ? "+" : ""}{change.toFixed(1)}%</span>}</span>
      </div>
      <div className="card-meta">
        <AddressTap address={agent.address} explorerUrl={deployment?.explorerUrl} />
        <Link href={`/explore?view=coins&parent=${agent.address}`} className="tap">{agent.childCount} {Number(agent.childCount) === 1 ? "coin" : "coins"}</Link>
      </div>
    </div>
  </article>;
}

export function CoinCard({ coin, parent, index = 0 }: { coin: Market; parent: { name: string; symbol: string; address: string }; index?: number }) {
  const { deployment } = useProtocol();
  const pct = coin.graduated ? 100 : curveProgress(coin.sold);
  const spark = useSpark(coin.address);
  const change = spark.length >= 2 ? (spark[spark.length - 1] / spark[0] - 1) * 100 : null;
  return <article className="card hover reveal-up" style={{ "--i": index % 6 } as React.CSSProperties}>
    <Link href={`/tokens/${coin.address}`} aria-label={`${coin.name}, coin by ${parent.name}`}><Art seed={coin.address} symbol={coin.symbol} kind="coin" /></Link>
    <div className="card-badges"><Link href={`/agents/${parent.address}`} className="badge" title={`Launched by ${parent.name}`}>Child of {parent.symbol}</Link>{coin.graduated && <span className="badge grad">Graduated</span>}</div>
    <Link href={`/tokens/${coin.address}`} className="ring" title={`${pct.toFixed(0)}% of the curve`}><CycleRing pct={pct} /></Link>
    <div className="card-body">
      <div className="card-title">
        <div><Link href={`/tokens/${coin.address}`} className="tap"><strong>{coin.name}</strong></Link><Link href={`/tokens/${coin.address}`} className="ticker tap">${coin.symbol} / ${coin.quoteSymbol}</Link></div>
        <Link href={`/tokens/${coin.address}`} className="mc tap"><b className="num">{compact(fdvQuote(coin))} {coin.quoteSymbol}</b><span>FDV</span></Link>
      </div>
      {!coin.graduated && <Link href={`/tokens/${coin.address}`} className="curve" aria-label={`${pct.toFixed(1)}% of the curve sold`}><span className="progress"><i style={{ "--w": `${pct}%` } as React.CSSProperties} /></span><span className="pct num">{pct.toFixed(0)}%</span></Link>}
      <div className="card-meta">
        <AddressTap address={coin.address} explorerUrl={deployment?.explorerUrl} />
        <span className="trend">{spark.length >= 2 && <Sparkline values={spark} />}{change !== null && <span className={`chg ${change >= 0 ? "up" : "down"} num`}>{change >= 0 ? "+" : ""}{change.toFixed(1)}%</span>}</span>
      </div>
    </div>
  </article>;
}
