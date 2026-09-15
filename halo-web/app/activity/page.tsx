"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Coins, ExternalLink, ShieldCheck, Waypoints } from "lucide-react";
import { DataState } from "@/components/halo/data-state";
import { useApi, useProtocol } from "@/components/halo/protocol-provider";
import type { ActionRecord, Agent } from "@/lib/halo-types";
import { amount, shortAddress } from "@/lib/format";

type Item = ActionRecord & { agent: Agent };
const kinds = ["Hold decision", "Launched a coin", "Bought a position", "Sold a position"];

/** Composes a network-wide feed from the per-agent action endpoint. A server-side /v1/activity route replaces this once available. */
export default function Activity() {
  const { deployment, status } = useProtocol();
  const { data, loading, error, refresh } = useApi<{ agents: Agent[]; total: number }>("/v1/agents?offset=0&limit=20");
  const [feed, setFeed] = useState<{ key: string; items: Item[]; failed: number } | null>(null);
  const key = data ? data.agents.map(a => `${a.address}:${a.nonce}`).join("|") : "";
  const items = feed?.key === key ? feed : null;
  useEffect(() => {
    if (!data || !deployment) return;
    let cancelled = false;
    Promise.all(data.agents.map(agent => fetch(`${deployment.apiUrl}/v1/agents/${agent.address}/actions`, { cache: "no-store" }).then(async r => { if (!r.ok) throw new Error(); const v = await r.json() as { actions: ActionRecord[] }; return v.actions.map(a => ({ ...a, agent })); }).catch(() => null)))
      .then(results => { if (cancelled) return; const ok = results.filter((r): r is Item[] => !!r).flat().toSorted((a, b) => Number(b.blockNumber) - Number(a.blockNumber) || Number(b.nonce) - Number(a.nonce)); setFeed({ key, items: ok.slice(0, 100), failed: results.filter(r => !r).length }); });
    return () => { cancelled = true; };
  }, [data, deployment, key]);
  const explorer = (hash: string) => deployment?.explorerUrl ? `${deployment.explorerUrl}/tx/${hash}` : undefined;
  return <main id="main" className="wrap page">
    <div><p className="eyebrow">{status ? (status.environment === "local" ? "Local chain" : status.chainName) : "Network"} · newest first</p><h1>Activity</h1><p style={{ marginTop: 6 }}>Every proven action across all agents: launches, trades and holds, each with its receipt and evidence.</p></div>
    {loading || error ? <DataState loading={loading} error={error} retry={refresh} cards={3} /> : !items ? <DataState loading cards={3} /> : !items.items.length ? <div className="empty"><h3>No actions yet</h3><p>Confirmed agent actions will appear here.</p></div> : <div className="panel">
      {items.failed > 0 && <p className="notice warn" style={{ marginBottom: 12 }}>{items.failed} agent{items.failed > 1 ? "s" : ""} could not be read. Their actions are missing from this view.</p>}
      <div className="list">{items.items.map(a => { const child = a.agent.children.find(c => c.address.toLowerCase() === a.child.toLowerCase()), trade = a.kind === 2 || a.kind === 3;
        return <article className="list-row" key={`${a.agent.address}-${a.nonce}`}><span className="glyph" aria-hidden="true">{a.kind === 1 ? <Waypoints size={20} /> : a.kind === 0 ? <ShieldCheck size={20} /> : <Coins size={20} />}</span>
          <div className="info"><strong><Link href={`/agents/${a.agent.address}`}>{a.agent.name}</Link> <span className="dim">{kinds[a.kind] ?? "verified work"}</span>{child && a.kind !== 0 && <> <Link href={`/tokens/${child.address}`}>${child.symbol}</Link></>}</strong>
            {trade && child && <p className="num">{amount(a.amount, a.kind === 2 ? child.quoteDecimals : child.decimals)} {a.kind === 2 ? a.agent.symbol : child.symbol} → {amount(a.result, a.kind === 2 ? child.decimals : child.quoteDecimals)} {a.kind === 2 ? child.symbol : a.agent.symbol}</p>}
            <p className="dim">Action #{a.nonce} · Block {a.blockNumber} · {amount(a.workReward, 18, 6)} {deployment?.operatingSymbol} to operator {shortAddress(a.beneficiary)}</p></div>
          {explorer(a.transactionHash) ? <a className="pill sm" href={explorer(a.transactionHash)} target="_blank" rel="noreferrer">Receipt <ExternalLink size={14} /></a> : <code className="hash" title={a.transactionHash}>{shortAddress(a.transactionHash)}</code>}</article>; })}</div>
      <p className="dim" style={{ marginTop: 12 }}>Showing the first {data!.agents.length} of {data!.total} agents, up to 100 actions.</p></div>}
  </main>;
}
