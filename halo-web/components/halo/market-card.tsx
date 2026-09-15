import Link from "next/link";
import Image from "next/image";
import type { Agent, Market } from "@/lib/halo-types";
import { artOffset, compact, curveProgress, days, fdvQuote, shortAddress } from "@/lib/format";

/** Engraved portrait crop for agents; a typographic glyph for coins that have no art of their own. */
export function Art({ seed, symbol, kind = "agent", className = "" }: { seed: string; symbol: string; kind?: "agent" | "coin"; className?: string }) {
  if (kind === "coin") return <div className={`card-art ${className}`} aria-hidden="true"><span className="glyph">{symbol.slice(0, 2)}<small>${symbol}</small></span></div>;
  return <div className={`card-art ${className}`}><Image src="/art/hero-sunset.webp" alt="" fill sizes="(max-width: 760px) 50vw, 220px" style={{ objectFit: "cover", objectPosition: artOffset(seed) }} unoptimized /></div>;
}

export function AgentCard({ agent, haloSymbol = "HALO" }: { agent: Agent; haloSymbol?: string }) {
  const m = agent.market;
  return <Link href={`/agents/${agent.address}`} className="card" aria-label={`${agent.name}, agent`}>
    <Art seed={agent.address} symbol={agent.symbol} />
    <div className="card-badges"><span className="chip purple">Agent</span>{agent.active ? <span className="chip green">Active</span> : <span className="chip">Not activated</span>}{m.graduated && <span className="chip orange">Graduated</span>}</div>
    <div className="card-body">
      <div className="card-title"><strong className="ellipsis">{agent.name}</strong><span>${agent.symbol} / ${haloSymbol}</span></div>
      <div className="card-stat"><span>FDV</span><strong className="num">{compact(fdvQuote(m))} {haloSymbol}</strong></div>
      {!m.graduated && <div className="progress" aria-label={`${curveProgress(m.sold).toFixed(1)}% of curve sold`}><i style={{ width: `${curveProgress(m.sold)}%` }} /></div>}
      <div className="card-meta"><span>{shortAddress(agent.address)}</span><span>{agent.childCount} coins · {days(agent.runwaySeconds)}d</span></div>
    </div>
  </Link>;
}

export function CoinCard({ coin, parent }: { coin: Market; parent: { name: string; symbol: string; address: string } }) {
  return <Link href={`/tokens/${coin.address}`} className="card" aria-label={`${coin.name}, coin by ${parent.name}`}>
    <Art seed={coin.address} symbol={coin.symbol} kind="coin" />
    <div className="card-badges"><span className="chip">Child</span>{coin.graduated ? <span className="chip orange">Graduated</span> : <span className="chip purple">{curveProgress(coin.sold).toFixed(0)}% curve</span>}</div>
    <div className="card-body">
      <div className="card-title"><strong className="ellipsis">{coin.name}</strong><span>${coin.symbol} / ${coin.quoteSymbol}</span></div>
      <div className="card-stat"><span>FDV</span><strong className="num">{compact(fdvQuote(coin))} {coin.quoteSymbol}</strong></div>
      {!coin.graduated && <div className="progress" aria-label={`${curveProgress(coin.sold).toFixed(1)}% of curve sold`}><i style={{ width: `${curveProgress(coin.sold)}%` }} /></div>}
      <div className="card-meta"><span>{shortAddress(coin.address)}</span><span>by {parent.name}</span></div>
    </div>
  </Link>;
}
