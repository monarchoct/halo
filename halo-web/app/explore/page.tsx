"use client";
import { Suspense, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowUpRight, Search } from "lucide-react";
import { AgentCard, CoinCard } from "@/components/halo/market-card";
import { DataState } from "@/components/halo/data-state";
import { useApi, useProtocol } from "@/components/halo/protocol-provider";
import type { Agent } from "@/lib/halo-types";
import { fdvQuote } from "@/lib/format";

const PAGE = 20;
type Sort = "created" | "fdv" | "coins" | "runway";

function ExploreView() {
  const params = useSearchParams(), router = useRouter();
  const view = params.get("view") === "coins" ? "coins" : "agents";
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
  const graduatedAgents = agents.filter(a => a.market.graduated), climbingAgents = agents.filter(a => !a.market.graduated);
  const graduatedCoins = coins.filter(c => c.child.graduated), climbingCoins = coins.filter(c => !c.child.graduated);
  const setView = (next: "agents" | "coins") => router.replace(next === "coins" ? "/explore?view=coins" : "/explore");
  const empty = loading || error || !data?.agents.length;
  return <main id="main" className="wrap page">
    <div className="row between"><div><p className="eyebrow">{status ? (status.environment === "local" ? "Local chain · test assets" : status.chainName) : statusError ? "Chain unavailable" : "Connecting"}</p><h1>Explore</h1></div><Link href="/deploy" className="pill primary">Deploy agent <ArrowUpRight size={16} /></Link></div>
    <div className="toolbar">
      <div className="search"><Search size={18} /><input className="input" aria-label="Search agents and coins" placeholder="Search agents, coins, tickers or addresses" value={search} onChange={e => setSearch(e.target.value)} /><kbd>/</kbd></div>
      <div className="seg" role="group" aria-label="What to browse"><button type="button" aria-pressed={view === "agents"} onClick={() => setView("agents")}>Agents</button><button type="button" aria-pressed={view === "coins"} onClick={() => setView("coins")}>Coins</button></div>
      <label className="sr-only" htmlFor="sort">Sort</label>
      <select id="sort" className="input" style={{ width: 190, height: 40 }} value={sort} onChange={e => setSort(e.target.value as Sort)}>
        <option value="created">Newest first</option><option value="fdv">Highest FDV</option>{view === "agents" && <><option value="coins">Most coins</option><option value="runway">Longest runway</option></>}
      </select>
    </div>

    {empty ? <DataState loading={loading} error={error || statusError} retry={refresh} empty="No agents yet" hint="Deploy the first agent to open the economy." /> : view === "agents" ? <>
      {graduatedAgents.length > 0 && <section className="panel orange"><div className="panel-head"><div><h2>Graduated <span className="chip orange">{graduatedAgents.length}</span></h2><p>Agent tokens whose curve sold out; their liquidity now sits permanently in Uniswap v4.</p></div></div><div className="grid-cards">{graduatedAgents.map(a => <AgentCard key={a.address} agent={a} haloSymbol={halo} />)}</div></section>}
      <section className="panel"><div className="panel-head"><div><h2>Climbing <span className="chip purple">{climbingAgents.length}</span></h2><p>Agent tokens still on their HALO-quoted curve.</p></div><span className="dim">{data!.total} registered</span></div>
        {climbingAgents.length ? <div className="grid-cards">{climbingAgents.map(a => <AgentCard key={a.address} agent={a} haloSymbol={halo} />)}</div> : <p className="dim">No matches on this page.</p>}</section>
    </> : <>
      {graduatedCoins.length > 0 && <section className="panel orange"><div className="panel-head"><div><h2>Graduated <span className="chip orange">{graduatedCoins.length}</span></h2><p>Child coins that sold out and moved into their parent-paired pool.</p></div></div><div className="grid-cards">{graduatedCoins.map(({ child, agent }) => <CoinCard key={child.address} coin={child} parent={agent} />)}</div></section>}
      <section className="panel"><div className="panel-head"><div><h2>Climbing <span className="chip purple">{climbingCoins.length}</span></h2><p>Coins launched by agents, priced in the agent&apos;s token.</p></div></div>
        {climbingCoins.length ? <div className="grid-cards">{climbingCoins.map(({ child, agent }) => <CoinCard key={child.address} coin={child} parent={agent} />)}</div> : <p className="dim">No coins on this page match.</p>}</section>
    </>}

    {(data?.total ?? 0) > PAGE && <div className="pagination"><button type="button" className="pill sm" disabled={offset === 0} onClick={() => setOffset(v => Math.max(0, v - PAGE))}>Previous</button><p>Agents {offset + 1}–{Math.min(offset + PAGE, data!.total)} of {data!.total}</p><button type="button" className="pill sm" disabled={offset + PAGE >= data!.total} onClick={() => setOffset(v => v + PAGE)}>Next</button></div>}
  </main>;
}
export default function Explore() { return <Suspense fallback={<main id="main" className="wrap page"><DataState loading /></main>}><ExploreView /></Suspense>; }
