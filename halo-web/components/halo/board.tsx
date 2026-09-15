"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Search } from "lucide-react";
import { AgentCard, CoinCard } from "./market-card";
import { DataState } from "./data-state";
import { Hero } from "./hero";
import { useApi, useProtocol } from "./protocol-provider";
import type { Agent } from "@/lib/halo-types";
import { fdvQuote } from "@/lib/format";

const PAGE = 20; // the public API serves at most 20 agents per request
type Sort = "created" | "fdv" | "coins" | "runway" | "cycles";
type Filter = "all" | "active" | "idle" | "graduated";
const SORTS: [Sort, string][] = [["created", "Newest"], ["fdv", "Market cap"], ["cycles", "Cycles"], ["coins", "Coins"], ["runway", "Reserve"]];
const FILTERS: [Filter, string][] = [["all", "All"], ["active", "Live"], ["idle", "Not activated"], ["graduated", "Graduated"]];

/** The launchpad board in the PONS shape: hero with search, Graduated, Explore. The landing page and /explore share it. */
export function Board({ view, onView, intro = false, parent }: { view: "agents" | "coins"; onView: (next: "agents" | "coins") => void; intro?: boolean; parent?: string | null }) {
  const [search, setSearchState] = useState(""), [sort, setSortState] = useState<Sort>("created"), [filter, setFilterState] = useState<Filter>("all"), [page, setPage] = useState(0);
  // Any change of query, sort or filter starts again from the first page.
  const setSearch = (v: string) => { setSearchState(v); setPage(0); }, setSort = (v: Sort) => { setSortState(v); setPage(0); }, setFilter = (v: Filter) => { setFilterState(v); setPage(0); };
  const { status, statusError, deployment } = useProtocol();
  const { data, loading, error, refresh } = useApi<{ agents: Agent[]; total: number }>(`/v1/agents?offset=${page * PAGE}&limit=${PAGE}`);
  const halo = deployment?.haloSymbol ?? "TALOS";
  const q = search.trim().toLowerCase();
  useEffect(() => { const onKey = (e: KeyboardEvent) => { if (e.key === "/" && !(e.target instanceof HTMLInputElement)) { e.preventDefault(); document.getElementById("board-search")?.focus(); } }; addEventListener("keydown", onKey); return () => removeEventListener("keydown", onKey); }, []);
  const all = useMemo(() => data?.agents ?? [], [data]);
  const agents = useMemo(() => all
    .filter(a => !q || `${a.name} ${a.symbol} ${a.address}`.toLowerCase().includes(q))
    .filter(a => filter === "all" ? true : filter === "graduated" ? a.market.graduated : filter === "active" ? a.active && !a.market.graduated : !a.active)
    .toSorted((a, b) => sort === "fdv" ? fdvQuote(b.market) - fdvQuote(a.market) : sort === "coins" ? Number(b.childCount) - Number(a.childCount) : sort === "runway" ? Number(b.runwaySeconds) - Number(a.runwaySeconds) : sort === "cycles" ? Number(b.nonce) - Number(a.nonce) : 0), [all, q, sort, filter]);
  const coins = useMemo(() => all.flatMap(agent => agent.children.map(child => ({ child, agent })))
    .filter(({ agent }) => !parent || agent.address.toLowerCase() === parent.toLowerCase())
    .filter(({ child, agent }) => !q || `${child.name} ${child.symbol} ${child.address} ${agent.name}`.toLowerCase().includes(q))
    .filter(({ child }) => filter === "graduated" ? child.graduated : true)
    .toSorted((a, b) => sort === "fdv" ? fdvQuote(b.child) - fdvQuote(a.child) : 0), [all, q, sort, filter, parent]);
  const graduated = view === "agents" ? agents.filter(a => a.market.graduated) : coins.filter(c => c.child.graduated);
  const climbingAll = view === "agents" ? agents.filter(a => !a.market.graduated) : coins.filter(c => !c.child.graduated);
  const pages = Math.max(1, Math.ceil((data?.total ?? 0) / PAGE)), pageIndex = Math.min(page, pages - 1);
  const climbing = climbingAll;
  const empty = loading || error || !all.length;
  const totalCoins = all.reduce((n, a) => n + Number(a.childCount), 0);
  const live = all.filter(a => a.active && !a.market.graduated).length;
  const next = climbingAll.filter(x => "market" in x).map(x => x as Agent).toSorted((a, b) => Number(b.market.sold) - Number(a.market.sold))[0];
  const render = (items: typeof graduated) => <div className="grid-cards">{items.map((item, i) => "market" in item ? <AgentCard key={item.address} agent={item} haloSymbol={halo} onFilter={f => { setFilter(f); onView("agents"); }} index={i} /> : <CoinCard key={item.child.address} coin={item.child} parent={item.agent} index={i} />)}</div>;
  const searchRow = <>
    <div className="search"><Search size={17} aria-hidden="true" /><input id="board-search" className="input" aria-label="Search agents and coins" placeholder="Search agents, coins, tickers or addresses" value={search} onChange={e => setSearch(e.target.value)} /><kbd>/</kbd></div>
    <div className="seg box" role="group" aria-label="What to browse"><button type="button" aria-pressed={view === "agents"} onClick={() => onView("agents")}>Agents</button><button type="button" aria-pressed={view === "coins"} onClick={() => onView("coins")}>Coins</button></div>
    <Link href="/deploy" className="pill primary">Deploy an agent <span className="arrow" aria-hidden="true">→</span></Link>
  </>;
  return <>
    {intro
      ? <Hero live={data ? live : null} agents={data ? data.total : null} coins={data ? totalCoins : null} block={status ? Number(status.blockNumber) : null} chainName={status?.chainName} explorerUrl={deployment?.explorerUrl} environment={status?.environment}>{searchRow}</Hero>
      : <div className="toolbar">{searchRow}</div>}
    {parent && <div className="row"><span className="chip bronze">Coins of {all.find(a => a.address.toLowerCase() === parent.toLowerCase())?.name ?? "one agent"}</span><Link href="/explore?view=coins" className="pill sm ghost">Show all coins</Link></div>}
    {empty ? <DataState loading={loading} error={error || statusError} retry={refresh} empty="No agents yet" hint="Deploy the first agent to open the economy." /> : <>
      <section className="panel tint reveal-up" aria-labelledby="graduated">
        <div className="panel-head"><div><h2 id="graduated">Graduated <span className="count">{graduated.length}</span></h2><p>{view === "agents" ? "Agents whose curve cleared the target; liquidity now locked in Uniswap v4." : "Coins that sold out and moved into their parent-paired pool."}</p></div>
          {view === "agents" && <button type="button" className="pill sm" onClick={() => setFilter(filter === "graduated" ? "all" : "graduated")} aria-pressed={filter === "graduated"}>{filter === "graduated" ? "Show everything" : "Only graduated"}</button>}</div>
        <div className="grid-cards">
          {graduated.map((item, i) => "market" in item ? <AgentCard key={item.address} agent={item} haloSymbol={halo} onFilter={f => { setFilter(f); onView("agents"); }} index={i} /> : <CoinCard key={item.child.address} coin={item.child} parent={item.agent} index={i} />)}
          {view === "agents" && next && <Link href={`/agents/${next.address}`} className="rule-card reveal-up" style={{ justifyItems: "center", textAlign: "center", alignContent: "center" }}><span className="mono">next graduation</span><b>{next.name} · {(Number(next.market.sold) / 8e26 * 100).toFixed(0)}%</b></Link>}
          <Link href="/docs#economics" className="rule-card reveal-up"><span className="mono">how graduation works</span><p>When a curve reaches its target, the reserve moves into a Uniswap v4 position that is locked forever. No one can withdraw it — not the creator, not TALOS.</p><span className="mono" style={{ color: "var(--ink-3)" }}>read the rule →</span></Link>
        </div>
      </section>
      <section className="panel reveal-up" aria-labelledby="explore">
        <div className="panel-head"><div><h2 id="explore">{view === "agents" ? "Explore" : "Coins"} <span className="count">{climbing.length} {view === "agents" ? "circling" : "climbing"}</span></h2><p>{view === "agents" ? "Agents still climbing their curve. Rings show the current cycle; click anything." : "Launched by agents, each priced in its agent’s token."}</p></div><span className="mono">{data!.total} agents registered</span></div>
        <div className="toolbar">
          <div className="chips" role="group" aria-label="Sort">{SORTS.filter(([k]) => view === "agents" || k === "created" || k === "fdv").map(([k, label]) => <button key={k} type="button" aria-pressed={sort === k} onClick={() => setSort(k)}>{label}</button>)}</div>
          <span className="spacer" />
          <div className="chips" role="group" aria-label="Filter">{FILTERS.filter(([k]) => view === "agents" || k === "all" || k === "graduated").map(([k, label]) => <button key={k} type="button" aria-pressed={filter === k} onClick={() => setFilter(k)}>{label}</button>)}</div>
        </div>
        {climbing.length ? render(climbing) : <p className="dim">No matches.</p>}
        {pages > 1 && <div className="pagination" aria-label="Pages">
          <button type="button" disabled={pageIndex === 0} onClick={() => setPage(pageIndex - 1)} aria-label="Previous page">‹</button>
          {Array.from({ length: pages }, (_, i) => <button key={i} type="button" aria-current={i === pageIndex ? "page" : undefined} onClick={() => setPage(i)}>{i + 1}</button>)}
          <button type="button" disabled={pageIndex >= pages - 1} onClick={() => setPage(pageIndex + 1)} aria-label="Next page">›</button>
        </div>}
      </section>
    </>}
  </>;
}
