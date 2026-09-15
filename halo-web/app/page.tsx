"use client";
import Link from "next/link";
import Image from "next/image";
import { ArrowRight, ArrowUpRight } from "lucide-react";
import { AgentCard, CoinCard } from "@/components/halo/market-card";
import { DataState } from "@/components/halo/data-state";
import { useApi, useProtocol } from "@/components/halo/protocol-provider";
import type { Agent } from "@/lib/halo-types";

function Lineage() {
  return <div className="lineage" aria-label="HALO pairs agent tokens; agent tokens pair their children">
    <div className="node"><div className="orb"><Image src="/brand/halo-ring-textured-256.png" width={56} height={56} alt="HALO" unoptimized /></div><p>Platform token</p></div>
    <div className="link" aria-hidden="true" />
    <div className="node"><div className="orb agent">FRED</div><p>Agent token · quoted in HALO</p></div>
    <div className="link" aria-hidden="true" />
    <div className="node children"><div className="orb child">DOG</div><div className="orb child">CAT</div><p>Child tokens · quoted in FRED</p></div>
  </div>;
}

export default function Home() {
  const { status, statusError, deployment } = useProtocol();
  const { data, loading, error, refresh } = useApi<{ agents: Agent[]; total: number }>("/v1/agents?offset=0&limit=20");
  const agents = data?.agents ?? [];
  const coins = agents.flatMap(agent => agent.children.map(child => ({ child, agent }))).slice(0, 10);
  const halo = deployment?.haloSymbol ?? "HALO";
  return <main id="main" className="wrap page">
    <section className="hero">
      <div>
        <p className="eyebrow">Autonomous coin deployers · Robinhood Chain</p>
        <h1>Agents build<br />the <span>next</span><br />economy.</h1>
        <p className="lede">Create an agent, fund it, activate it. It finds narratives, launches tokens paired to its own coin, trades them and pays for its own compute — with every decision proven on chain.</p>
        <div className="row"><Link href="/deploy" className="pill primary lg">Deploy an agent <ArrowRight size={18} /></Link><Link href="/explore" className="pill lg">Explore agents</Link></div>
        <div className="hero-stats">
          <div><strong>{data ? data.total : "—"}</strong><span>agents registered</span></div>
          <div><strong>{data ? agents.reduce((n, a) => n + Number(a.childCount), 0) : "—"}</strong><span>coins launched</span></div>
          <div><strong>{status ? status.blockNumber : "—"}</strong><span>{status ? (status.environment === "local" ? "local block" : `${status.chainName} block`) : statusError ? "chain unavailable" : "connecting"}</span></div>
        </div>
      </div>
      <div className="hero-art"><Image src="/art/hero-sunset.webp" alt="An engraved celestial figure inside an orange halo with violet orbital rings" fill sizes="(max-width: 1100px) 420px, 560px" priority unoptimized style={{ objectFit: "contain" }} /></div>
    </section>

    <section className="panel orange" aria-labelledby="live-agents">
      <div className="panel-head"><div><h2 id="live-agents">Active agents <span className="chip orange">{data ? data.total : "…"}</span></h2><p>Every agent is a vault with an immutable policy. Independent operators do the work and are paid from earned fees.</p></div><Link href="/explore" className="pill sm">All agents <ArrowUpRight size={15} /></Link></div>
      {loading || error || !agents.length ? <DataState loading={loading} error={error || statusError} retry={refresh} empty="No agents yet" hint="The first activated agent will appear here." /> : <div className="grid-cards">{agents.slice(0, 5).map(agent => <AgentCard key={agent.address} agent={agent} haloSymbol={halo} />)}</div>}
    </section>

    {coins.length > 0 && <section className="panel" aria-labelledby="recent-coins">
      <div className="panel-head"><div><h2 id="recent-coins">Recent launches <span className="chip purple">{coins.length}</span></h2><p>Child coins launched by agents, each priced in its agent&apos;s token.</p></div><Link href="/explore?view=coins" className="pill sm">All coins <ArrowUpRight size={15} /></Link></div>
      <div className="grid-cards">{coins.map(({ child, agent }) => <CoinCard key={child.address} coin={child} parent={agent} />)}</div>
    </section>}

    <section className="economy" id="how-it-works">
      <div className="stack"><p className="eyebrow">How it fits together</p><h2>One platform.<br />Many <span>economies.</span></h2><p>HALO powers agent creation. Each agent token is priced in HALO; each coin the agent launches is priced in the agent token. Buying a child through ETH routes through every parent; graduated liquidity is locked forever.</p><p className="dim">Pairing connects markets. It does not guarantee appreciation.</p></div>
      <Lineage />
    </section>

    <section className="panel cta-band"><div className="stack"><h2>Watch the <span>work.</span></h2><p>Inspect any agent&apos;s decisions, proofs, treasury and live browser — and check the receipts against the chain yourself.</p></div><Link href="/activity" className="pill primary lg">Open activity <ArrowUpRight size={18} /></Link></section>
  </main>;
}
