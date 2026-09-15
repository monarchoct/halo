"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { createPublicClient, formatUnits, http, type Abi, type Address } from "viem";
import { AgentCard } from "@/components/halo/market-card";
import { DataState } from "@/components/halo/data-state";
import { useApi, useProtocol } from "@/components/halo/protocol-provider";
import type { Agent } from "@/lib/halo-types";
import { shortAddress } from "@/lib/format";
import splitterAbi from "@/lib/generated/FeeSplitter.json";

const PAGE = 20;
export default function Portfolio() {
  const { address, openWallet, disconnect, submit, deployment, transaction } = useProtocol();
  const [offset, setOffset] = useState(0), [claimError, setClaimError] = useState("");
  const { data, loading, error, refresh } = useApi<{ agents: Agent[]; total: number }>(address ? `/v1/agents?offset=${offset}&limit=${PAGE}` : null);
  const own = data?.agents.filter(a => a.creator.toLowerCase() === address?.toLowerCase()) ?? [];
  const payable = data?.agents.filter(a => a.fees.creator.toLowerCase() === address?.toLowerCase()) ?? [];
  const markets = payable.flatMap(a => [a.market, ...a.children]);
  // Claimable balances are keyed by the wallet + data snapshot they were read for, so a stale read is never shown for a new wallet.
  const [claimable, setClaimable] = useState<{ key: string; values: Record<string, string | null> } | null>(null);
  const key = `${address}:${data?.total}:${offset}`;
  const balances = claimable?.key === key ? claimable.values : null;
  const busy = transaction?.state === "approval" || transaction?.state === "pending";
  useEffect(() => {
    if (!address || !deployment || !data) return;
    let cancelled = false;
    const client = createPublicClient({ transport: http(deployment.rpcUrl) });
    Promise.all(markets.map(async market => {
      try { const value = await client.readContract({ address: market.feeSplitter, abi: splitterAbi as Abi, functionName: "claimable", args: [address] }) as bigint; return [market.address, value.toString()] as const; }
      catch { return [market.address, null] as const; }
    })).then(values => { if (!cancelled) setClaimable({ key, values: Object.fromEntries(values) }); });
    return () => { cancelled = true; };
  // markets derives from data; key captures address/data identity.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [address, deployment, data, key]);
  async function claim(splitter: Address) { try { setClaimError(""); await submit(splitter, splitterAbi as Abi, "claim", [address], "Claim creator fees"); refresh(); } catch (e) { setClaimError((e as Error).message); } }
  return <main id="main" className="wrap page">
    <div className="row between"><div><p className="eyebrow">Your HALO</p><h1>Portfolio</h1><p style={{ marginTop: 6 }}>{address ? `Agents created by ${shortAddress(address)} and the creator fees you can claim.` : "Your agents and earned creator fees."}</p></div>
      <button type="button" className="pill" onClick={address ? disconnect : openWallet}>{address ? "Disconnect" : "Connect wallet"}</button></div>
    {!address ? <div className="empty"><h3>Connect to see your agents</h3><p>Your wallet identifies the agents you created and the fee allocations you can claim.</p><button type="button" className="pill primary" onClick={openWallet}>Connect wallet</button></div>
      : loading || error ? <DataState loading={loading} error={error} retry={refresh} /> : <>
        <section className="panel"><div className="panel-head"><div><h2>Your agents <span className="chip purple">{own.length}</span></h2><p>Agents whose creator is this wallet, on the current registry page.</p></div><Link href="/deploy" className="pill sm">Deploy another</Link></div>
          {own.length ? <div className="grid-cards">{own.map(a => <AgentCard key={a.address} agent={a} haloSymbol={deployment?.haloSymbol} />)}</div> : <p className="dim">No agents from this wallet on this page.</p>}
          {(data?.total ?? 0) > PAGE && <div className="pagination"><button type="button" className="pill sm" disabled={!offset} onClick={() => setOffset(v => Math.max(0, v - PAGE))}>Previous page</button><button type="button" className="pill sm" disabled={offset + PAGE >= data!.total} onClick={() => setOffset(v => v + PAGE)}>Next page</button></div>}</section>
        <section className="panel"><div className="panel-head"><div><h2>Creator fees</h2><p>Paid to the creator address committed in each market. Amounts are read live from each fee splitter.</p></div></div>
          {markets.length ? <div className="list">{markets.map(market => { const v = balances ? balances[market.address] : undefined; return <div className="list-row" key={market.address}><span className="glyph">{market.symbol.slice(0, 2)}</span>
            <div className="info"><strong>{market.name} <span className="dim">${market.symbol}</span></strong><p className="num">{v === undefined ? "Reading balance…" : v === null ? "Balance unavailable" : `${formatUnits(BigInt(v), market.quoteDecimals)} ${market.quoteSymbol} claimable`} · <code>{shortAddress(market.feeSplitter)}</code></p></div>
            <button type="button" className="pill sm" disabled={busy || !v || v === "0"} onClick={() => claim(market.feeSplitter)}>Claim</button></div>; })}</div> : <p className="dim">No markets pay creator fees to this wallet yet.</p>}
          {claimError && <p className="notice err" role="alert" style={{ marginTop: 12 }}>{claimError}</p>}</section>
      </>}
  </main>;
}
