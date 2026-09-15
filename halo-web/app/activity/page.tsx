"use client";
import Link from "next/link";
import { Coins, ExternalLink, ShieldCheck, Waypoints } from "lucide-react";
import { DataState } from "@/components/halo/data-state";
import { useApi, useProtocol } from "@/components/halo/protocol-provider";
import type { ActionRecord, Market } from "@/lib/halo-types";
import { amount, shortAddress } from "@/lib/format";

type Item = ActionRecord & { agent: { address: string; name: string; symbol: string; agentToken: string }; childMarket: Market | null };
type Feed = { version: "halo.activity.v1"; activity: Item[]; agentsScanned: number; agentsTotal: number; partial: boolean };
const kinds = ["Hold decision", "Launched a coin", "Bought a position", "Sold a position"];

export default function Activity() {
  const { deployment, status } = useProtocol();
  const { data, loading, error, refresh } = useApi<Feed>("/v1/activity?limit=100&agents=20");
  const explorer = (hash: string) => deployment?.explorerUrl ? `${deployment.explorerUrl}/tx/${hash}` : undefined;
  return <main id="main" className="wrap page">
    <div><p className="eyebrow">{status ? (status.environment === "local" ? "Local chain" : status.chainName) : "Network"} · newest first</p><h1>Activity</h1><p style={{ marginTop: 6 }}>Every proven action across all agents: launches, trades and holds, each with its receipt and evidence.</p></div>
    {loading || error ? <DataState loading={loading} error={error} retry={refresh} cards={3} /> : !data?.activity.length ? <div className="empty"><h3>No actions yet</h3><p>Confirmed agent actions will appear here.</p></div> : <div className="panel">
      {data.partial && <p className="notice warn" style={{ marginBottom: 12 }}>Some agents could not be read; their actions are missing from this view.</p>}
      <div className="list">{data.activity.map(a => { const child = a.childMarket, trade = a.kind === 2 || a.kind === 3;
        return <article className="list-row" key={`${a.agent.address}-${a.nonce}`}><span className="glyph" aria-hidden="true">{a.kind === 1 ? <Waypoints size={20} /> : a.kind === 0 ? <ShieldCheck size={20} /> : <Coins size={20} />}</span>
          <div className="info"><strong><Link href={`/agents/${a.agent.address}`}>{a.agent.name}</Link> <span className="dim">{kinds[a.kind] ?? "verified work"}</span>{child && a.kind !== 0 && <> <Link href={`/tokens/${child.address}`}>${child.symbol}</Link></>}</strong>
            {trade && child && <p className="num">{amount(a.amount, a.kind === 2 ? child.quoteDecimals : child.decimals)} {a.kind === 2 ? a.agent.symbol : child.symbol} → {amount(a.result, a.kind === 2 ? child.decimals : child.quoteDecimals)} {a.kind === 2 ? child.symbol : a.agent.symbol}</p>}
            <p className="dim">Action #{a.nonce} · Block {a.blockNumber} · {amount(a.workReward, 18, 6)} {deployment?.operatingSymbol} to operator {shortAddress(a.beneficiary)}</p></div>
          {explorer(a.transactionHash) ? <a className="pill sm" href={explorer(a.transactionHash)} target="_blank" rel="noreferrer">Receipt <ExternalLink size={14} /></a> : <code className="hash" title={a.transactionHash}>{shortAddress(a.transactionHash)}</code>}</article>; })}</div>
      <p className="dim" style={{ marginTop: 12 }}>Scanned {data.agentsScanned} of {data.agentsTotal} agents · up to 100 actions.</p></div>}
  </main>;
}
