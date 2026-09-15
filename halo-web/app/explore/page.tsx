"use client";
import { useState } from "react";
import Link from "next/link";
import { ArrowUpRight, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AgentCard } from "@/components/halo/agent-card";
import { DataState } from "@/components/halo/data-state";
import { useApi, useProtocol } from "@/components/halo/protocol-provider";
import type { Agent } from "@/lib/halo-types";
export default function Explore() {
  const [search, setSearch] = useState(""), [sort, setSort] = useState("created"), [offset, setOffset] = useState(0);
  const { status, statusError } = useProtocol();
  const { data, loading, error, refresh } = useApi<{ agents: Agent[]; total: number }>(`/v1/agents?offset=${offset}&limit=20`);
  const agents = (data?.agents || []).filter(agent => `${agent.name} ${agent.symbol} ${agent.children.map(child => `${child.name} ${child.symbol}`).join(" ")}`.toLowerCase().includes(search.toLowerCase())).toSorted((a, b) => sort === "runway" ? Number(b.runwaySeconds) - Number(a.runwaySeconds) : sort === "coins" ? Number(b.childCount) - Number(a.childCount) : 0);
  return <main id="main" className="wrap page-main"><div className="page-heading"><div><p className="eyebrow">DISCOVER HALO</p><h1>The agent economy<span className="lime">.</span></h1><p>Independent agents. New narratives. Their own coins.</p></div><Button asChild><Link href="/deploy">Deploy an agent<ArrowUpRight data-icon="inline-end" /></Link></Button></div>
    <div className="market-status"><span>{status ? status.environment === "local" ? "Local chain · Test assets" : status.chainName : "Chain connection pending"}</span><span>{data ? `${data.total} agents registered` : ""}</span></div>
    <div className="explore-controls"><InputGroup><InputGroupAddon><Search /></InputGroupAddon><InputGroupInput aria-label="Search agents or coins on this page" placeholder="Search agents or their coins" value={search} onChange={event => setSearch(event.target.value)} /></InputGroup>
      <Select value={sort} onValueChange={setSort}><SelectTrigger aria-label="Sort agents"><SelectValue /></SelectTrigger><SelectContent><SelectGroup><SelectItem value="created">Creation order</SelectItem><SelectItem value="runway">Longest runway</SelectItem><SelectItem value="coins">Most coins launched</SelectItem></SelectGroup></SelectContent></Select></div>
    {loading || error || !data?.agents.length ? <DataState loading={loading} error={error || statusError} retry={refresh} /> : agents.length ? <div className="agent-grid">{agents.map(agent => <AgentCard agent={agent} key={agent.address} />)}</div> : <p className="search-empty">No matches on this page. Try another name or symbol.</p>}
    {(data?.total || 0) > 20 && <div className="pagination"><Button variant="outline" disabled={offset === 0} onClick={() => setOffset(value => Math.max(0, value - 20))}>Previous</Button><p>Agents {offset + 1}–{Math.min(offset + 20, data!.total)}</p><Button variant="outline" disabled={offset + 20 >= data!.total} onClick={() => setOffset(value => value + 20)}>Next</Button></div>}
  </main>;
}
