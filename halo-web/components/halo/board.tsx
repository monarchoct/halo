"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { ArrowUpRight, Search } from "lucide-react";
import { AgentCard, CoinCard } from "./market-card";
import { DataState } from "./data-state";
import { useApi, useProtocol } from "./protocol-provider";
import type { Agent } from "@/lib/halo-types";
import { fdvQuote } from "@/lib/format";

const PAGE = 20;
type Sort = "created" | "fdv" | "coins" | "runway";

/** The launchpad board: search row, Agents/Coins, Graduated and Climbing sections. The landing page and /explore share it. */
export function Board({ view, onView, intro = false }: { view: "agents" | "coins"; onView: (next: "agents" | "coins") => void; intro?: boolean }) {
  const [search, setSearch] = useState(""), [sort, setSort] = useState<Sort>("created"), [offset, setOffset] = useState(0);
  const { status, statusError, deployment } = useProtocol();
  const { data, loading, error, refresh } = useApi<{ agents: Agent[]; total: number }>(`/v1/agents?offset=${offset}&limit=${PAGE}`);
  const halo = deployment?.haloSymbol ?? "HALO";
  const q = search.trim().toLowerCase();
  const agents = useMemo(() => (data?.agents ?? []).filter(a => !q || `${a.name} ${a.symbol} ${a.address}`.toLowerCase().includes(q))
    .toSorted((a, b) => sort === "fdv" ? fdvQuote(b.market) - fdvQuote(a.market) : sort === "coins" ? Number(b.childCount) - Number(a.childCount) : sort === "runway" ? Number(b.runwaySeconds) - Number(a.runwaySeconds) : 0), [data, q, sort]);
  const coins = useMemo(() => (data?.agents ?? []).flatMap(agent => agent.children.map(child => ({ child, agent })))
    .filter(({ child, agent }) => !q || `${child.name} ${child.symbol} ${child.address} ${agent.name}`.toLowerCase().includes(q))
    .toSorted((a, b) => sort === "fdv" ? fdvQuote(b.child) - fdvQuote(a.child) : 0), [data, q, sort]);
  const graduated = view === "agents" ? agents.filter(a => a.market.graduated) : coins.filter(c => c.child.graduated);
  const climbing = view === "agents" ? agents.filter(a => !a.market.graduated) : coins.filter(c => !c.child.graduated);
  const empty = loading || error || !data?.agents.length;
  const totalCoins = (data?.agents ?? []).reduce((n, a) => n + Number(a.childCount), 0);
  const render = (items: typeof graduated) => <div className="grid-cards">{items.map(item => "market" in item ? <AgentCard key={item.address} agent={item} haloSymbol={halo} /> : <CoinCard key={item.child.address} coin={item.child} parent={item.agent} />)}</div>;
  return <>
    {intro && <section className="board-intro">
      <div><p className="eyebrow">{status ? (status.environment === "local" ? "Local chain · test assets" : status.chainName) : statusError ? "Chain unavailable" : "Connecting"}</p><h1>Agents that build <span>their own economy.</span></h1>
        <p className="lede">Create an agent, fund it, activate it. It launches coins paired to its own token, trades them, and pays for its own compute — every decision proven on chain.</p>
        <div className="hero-stats" style={{ marginTop: 14 }}><div><strong>{data ? data.total : "—"}</strong><span>agents</span></div><div><strong>{data ? totalCoins : "—"}</strong><span>coins launched</span></div><div><strong>{status ? status.blockNumber : "—"}</strong><span>latest block</span></div></div></div>
      <div className="row"><Link href="/deploy" className="pill primary lg">Create an agent</Link><Link href="/docs" className="pill lg">How it works <ArrowUpRight size={16} /></Link></div>
    </section>}
    <div className="toolbar">
      <div className="search"><Search size={18} /><input className="input" aria-label="Search agents and coins" placeholder="Search agents, coins, tickers or addresses" value={search} onChange={e => setSearch(e.target.value)} /><kbd>/</kbd></div>
      <div className="seg" role="group" aria-label="What to browse"><button type="button" aria-pressed={view === "agents"} onClick={() => onView("agents")}>Agents</button><button type="button" aria-pressed={view === "coins"} onClick={() => onView("coins")}>Coins</button></div>
      <label className="sr-only" htmlFor="sort">Sort</label>
      <select id="sort" className="input" style={{ width: 190, height: 44 }} value={sort} onChange={e => setSort(e.target.value as Sort)}>
        <option value="created">Newest first</option><option value="fdv">Highest FDV</option>{view === "agents" && <><option value="coins">Most coins</option><option value="runway">Longest runway</option></>}
      </select>
      <Link href="/deploy" className="pill">Create <ArrowUpRight size={15} /></Link>
    </div>
    {empty ? <DataState loading={loading} error={error || statusError} retry={refresh} empty="No agents yet" hint="Create the first agent to open the economy." /> : <>
      {graduated.length > 0 && <section className="panel orange"><div className="panel-head"><div><h2>Graduated <span className="chip orange">{graduated.length}</span></h2><p>{view === "agents" ? "Agent tokens whose curve sold out; their liquidity now sits permanently in Uniswap v4." : "Coins that sold out and moved into their parent-paired pool."}</p></div></div>{render(graduated)}</section>}
      <section className="panel"><div className="panel-head"><div><h2>{view === "agents" ? "Climbing" : "Coins"} <span className="chip purple">{climbing.length}</span></h2><p>{view === "agents" ? "Agent tokens still on their HALO-quoted curve." : "Launched by agents, each priced in its agent’s token."}</p></div><span className="dim">{data!.total} agents registered</span></div>
        {climbing.length ? render(climbing) : <p className="dim">No matches on this page.</p>}</section>
      {(data?.total ?? 0) > PAGE && <div className="pagination"><button type="button" className="pill sm" disabled={offset === 0} onClick={() => setOffset(v => Math.max(0, v - PAGE))}>Previous</button><p>Agents {offset + 1}–{Math.min(offset + PAGE, data!.total)} of {data!.total}</p><button type="button" className="pill sm" disabled={offset + PAGE >= data!.total} onClick={() => setOffset(v => v + PAGE)}>Next</button></div>}
    </>}
  </>;
}

export function Lineage() {
  return <div className="lineage" aria-label="HALO pairs agent tokens; agent tokens pair their children">
    <div className="node"><div className="orb"><Image src="/brand/halo-ring-textured-256.png" width={56} height={56} alt="HALO" unoptimized /></div><p>Platform token</p></div>
    <div className="link" aria-hidden="true" />
    <div className="node"><div className="orb agent">FRED</div><p>Agent token · quoted in HALO</p></div>
    <div className="link" aria-hidden="true" />
    <div className="node children"><div className="orb child">DOG</div><div className="orb child">CAT</div><p>Child tokens · quoted in FRED</p></div>
  </div>;
}
