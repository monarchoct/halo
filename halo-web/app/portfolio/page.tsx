"use client";
import { useEffect, useState } from "react";
import { createPublicClient, formatUnits, http, type Abi, type Address } from "viem";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Empty, EmptyHeader, EmptyTitle, EmptyDescription } from "@/components/ui/empty";
import { AgentCard } from "@/components/halo/agent-card";
import { DataState } from "@/components/halo/data-state";
import { useApi, useProtocol } from "@/components/halo/protocol-provider";
import { shortAddress, type Agent } from "@/lib/halo-types";
import splitterAbi from "@/lib/generated/FeeSplitter.json";
export default function Portfolio() {
  const { address, openWallet, disconnect, submit, deployment, transaction } = useProtocol();
  const [offset, setOffset] = useState(0), [claimError, setClaimError] = useState("");
  const { data, loading, error, refresh } = useApi<{ agents: Agent[]; total: number }>(address ? `/v1/agents?offset=${offset}&limit=20` : null);
  const own = data?.agents.filter(agent => agent.creator.toLowerCase() === address?.toLowerCase()) || [];
  const payable = data?.agents.filter(agent => agent.fees.creator.toLowerCase() === address?.toLowerCase()) || [];
  const [claimable, setClaimable] = useState<Record<string, string | null>>({});
  const busy = transaction?.state === "approval" || transaction?.state === "pending";
  useEffect(() => {
    let cancelled = false; setClaimable({});
    if (!address || !deployment || !data) return;
    const client = createPublicClient({ transport: http(deployment.rpcUrl) });
    const markets = data.agents.filter(agent => agent.fees.creator.toLowerCase() === address.toLowerCase()).flatMap(agent => [agent.market, ...agent.children]);
    Promise.all(markets.map(async market => {
      try { const value = await client.readContract({ address: market.feeSplitter, abi: splitterAbi as Abi, functionName: "claimable", args: [address] }) as bigint;
        return [market.address, value.toString()] as const; } catch { return [market.address, null] as const; }
    })).then(values => { if (!cancelled) setClaimable(Object.fromEntries(values)); });
    return () => { cancelled = true; };
  }, [address, deployment, data]);
  async function claim(splitter: Address) { try { setClaimError(""); await submit(splitter, splitterAbi as Abi, "claim", [address], "Claim creator fees"); refresh(); } catch (error) { setClaimError((error as Error).message); } }
  return <main id="main" className="wrap page-main"><div className="page-heading"><div><p className="eyebrow">YOUR HALO</p><h1>Your portfolio<span className="lime">.</span></h1><p>{address ? `Agents created by ${shortAddress(address)}` : "Your agents and earned creator fees."}</p></div>
    <Button variant="outline" onClick={address ? disconnect : openWallet}>{address ? "Disconnect session" : "Connect wallet"}</Button></div>
    {!address ? <Empty><EmptyHeader><EmptyTitle>Connect to see your agents</EmptyTitle><EmptyDescription>Your wallet identifies the agents you created and the fee allocations you can claim.</EmptyDescription></EmptyHeader><Button onClick={openWallet}>Connect wallet</Button></Empty>
      : loading || error ? <DataState loading={loading} error={error} retry={refresh} /> : <><div className="agent-grid">{own.map(agent => <AgentCard agent={agent} key={agent.address} />)}</div>
        {!own.length && <p style={{ paddingBlock: 30 }}>No agents from this wallet in the current registry page.</p>}
        {(data?.total || 0) > 20 && <div className="pagination"><Button variant="outline" disabled={!offset} onClick={() => setOffset(value => Math.max(0, value - 20))}>Previous registry page</Button><Button variant="outline" disabled={offset + 20 >= data!.total} onClick={() => setOffset(value => value + 20)}>Next registry page</Button></div>}
        <div className="section-topline"><h2>Creator fee destinations</h2></div><p className="small-note">Claims are paid to the creator address committed in each market. The transaction reads the current claimable amount on chain.</p>
        <div className="token-list" style={{ marginTop: 20 }}>{payable.flatMap(agent => [agent.market, ...agent.children]).map(market => <div className="token-row" key={market.address}><div className="token-info"><h3>{market.name}</h3><p>{claimable[market.address] == null ? claimable[market.address] === null ? "Balance unavailable" : "Reading balance…" : `${formatUnits(BigInt(claimable[market.address]!), market.quoteDecimals)} ${market.quoteSymbol} claimable`} · {shortAddress(market.feeSplitter)}</p></div><Button variant="outline" disabled={busy || !claimable[market.address] || claimable[market.address] === "0"} onClick={() => claim(market.feeSplitter)}>Claim fees</Button></div>)}</div>
        {claimError && <Alert variant="destructive"><AlertDescription>{claimError}</AlertDescription></Alert>}</>}
  </main>;
}
