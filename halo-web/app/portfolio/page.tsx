"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { createPublicClient, formatUnits, http, type Abi, type Address } from "viem";
import { AddressTap, AgentCard, CoinCard } from "@/components/halo/market-card";
import { DataState } from "@/components/halo/data-state";
import { useApi, useProtocol } from "@/components/halo/protocol-provider";
import type { Agent } from "@/lib/halo-types";
import { shortAddress } from "@/lib/format";
import { countUp } from "@/lib/reveal";
import splitterAbi from "@/lib/generated/FeeSplitter.json";

const PAGE = 20;
const whole = (n: number) => Math.round(n).toLocaleString("en-US");
const fraction = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 4 });
const stagger = (i: number) => ({ "--i": i % 8 } as React.CSSProperties);

/** A headline number that counts up to its value when it arrives; tabular at rest. */
function Count({ value, format = whole, className = "" }: { value: number | null; format?: (n: number) => string; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => { if (ref.current && value !== null) return countUp(ref.current, value, 900, format); }, [value, format]);
  return <span ref={ref} className={`num ${className}`}>{value === null ? "—" : format(value)}</span>;
}

export default function Portfolio() {
  const { address, openWallet, disconnect, submit, deployment, transaction } = useProtocol();
  const [offset, setOffset] = useState(0), [claimError, setClaimError] = useState("");
  const { data, loading, error, refresh } = useApi<{ agents: Agent[]; total: number }>(address ? `/v1/agents?offset=${offset}&limit=${PAGE}` : null);
  const own = data?.agents.filter(a => a.creator.toLowerCase() === address?.toLowerCase()) ?? [];
  const payable = data?.agents.filter(a => a.fees.creator.toLowerCase() === address?.toLowerCase()) ?? [];
  const coins = own.flatMap(agent => agent.children.map(coin => ({ coin, agent })));
  const entries = payable.flatMap(agent => [{ agent, market: agent.market }, ...agent.children.map(market => ({ agent, market }))]);
  const markets = entries.map(e => e.market);
  // Claimable balances are keyed by the wallet + data snapshot they were read for, so a stale read is never shown for a new wallet.
  const [claimable, setClaimable] = useState<{ key: string; values: Record<string, string | null> } | null>(null);
  const key = `${address}:${data?.total}:${offset}`;
  const balances = claimable?.key === key ? claimable.values : null;
  const busy = transaction?.state === "approval" || transaction?.state === "pending";
  const halo = deployment?.haloSymbol ?? "TALOS";
  const payableNow = balances ? Object.values(balances).filter(v => v && v !== "0").length : null;
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
    <div className="row between reveal-up">
      <div className="stack" style={{ gap: 6 }}>
        <p className="eyebrow">Your {halo}</p>
        <h1>Portfolio</h1>
        {address
          ? <p className="lede row" style={{ gap: 6 }}>Agents created by <AddressTap address={address} explorerUrl={deployment?.explorerUrl} /> and the creator fees you can claim{deployment ? ` on ${deployment.chainName}` : ""}.</p>
          : <p className="lede">Your agents, the coins they launched and the creator fees they earned.</p>}
      </div>
      <div className="row">
        <Link href="/deploy" className="pill">Deploy an agent</Link>
        {address
          ? <button type="button" className="pill ghost" onClick={disconnect}>Disconnect {shortAddress(address)}</button>
          : <button type="button" className="pill primary" data-sfx="confirm" onClick={openWallet}>Connect wallet</button>}
      </div>
    </div>

    {!address ? <section className="panel tint reveal-up" id="connect">
      <div className="empty">
        <p className="eyebrow">Wallet</p>
        <h3>Connect to see your agents</h3>
        <p>Your wallet identifies the agents you created and the fee allocations you can claim. Nothing is signed until you claim.</p>
        <div className="row" style={{ justifyContent: "center" }}>
          <button type="button" className="pill primary lg" data-sfx="confirm" onClick={openWallet}>Connect wallet</button>
          <Link href="/explore" className="pill lg ghost">Browse the board <span className="arrow" aria-hidden="true">→</span></Link>
        </div>
      </div>
    </section>
      : loading || error ? <DataState loading={loading} error={error} retry={refresh} /> : <>
        <dl className="metrics">
          <Link href="#agents" className="metric reveal-up" style={stagger(0)}><dt>Agents</dt><dd><Count value={own.length} /><small>created by this wallet</small></dd></Link>
          <Link href="#coins" className="metric reveal-up" style={stagger(1)}><dt>Coins</dt><dd><Count value={coins.length} /><small>launched by your agents</small></dd></Link>
          <Link href="#fees" className="metric reveal-up" style={stagger(2)}><dt>Fee markets</dt><dd><Count value={markets.length} /><small>paying this wallet</small></dd></Link>
          <Link href="#fees" className="metric reveal-up" style={stagger(3)}><dt>Claimable now</dt><dd><Count value={payableNow} /><small>{balances ? "markets with a balance" : "reading balances…"}</small></dd></Link>
        </dl>

        <section className="panel reveal-up" id="agents">
          <div className="panel-head">
            <div><h2>Your agents <span className="count">{own.length}</span></h2><p>Agents whose creator is this wallet, on the current registry page.</p></div>
            <Link href="/deploy" className="pill sm">Deploy another <span className="arrow" aria-hidden="true">→</span></Link>
          </div>
          {own.length ? <div className="grid-cards">{own.map((a, i) => <AgentCard key={a.address} agent={a} haloSymbol={halo} index={i} />)}</div>
            : <div className="empty reveal-up"><h3>No agents from this wallet on this page</h3><p>Deploy an agent and it appears here once its transaction is confirmed.</p><Link href="/deploy" className="pill primary">Deploy an agent</Link></div>}
          {(data?.total ?? 0) > PAGE && <div className="pagination">
            <button type="button" className="pill sm" disabled={!offset} onClick={() => setOffset(v => Math.max(0, v - PAGE))}>Previous page</button>
            <p className="num">{offset + 1}–{Math.min(offset + PAGE, data!.total)} of {data!.total}</p>
            <button type="button" className="pill sm" disabled={offset + PAGE >= data!.total} onClick={() => setOffset(v => v + PAGE)}>Next page</button>
          </div>}
        </section>

        <section className="panel reveal-up" id="coins">
          <div className="panel-head">
            <div><h2>Your coins <span className="count">{coins.length}</span></h2><p>Coins launched by your agents. Each one pays trading fees back to the agent that launched it.</p></div>
            {own.length > 0 && <Link href={`/explore?view=coins&parent=${own[0].address}`} className="pill sm ghost">Open on the board</Link>}
          </div>
          {coins.length ? <div className="grid-cards">{coins.map(({ coin, agent }, i) => <CoinCard key={coin.address} coin={coin} parent={agent} index={i} />)}</div>
            : <div className="empty reveal-up"><h3>No coins yet</h3><p>Coins appear as your agents launch them from their operating budget.</p><Link href={own.length ? `/agents/${own[0].address}#runtime` : "/deploy"} className="pill primary">{own.length ? "Open your agent's runtime" : "Deploy an agent"}</Link></div>}
        </section>

        <section className="panel reveal-up" id="fees">
          <div className="panel-head">
            <div><h2>Creator fees <span className="count">{markets.length}</span></h2><p>Paid to the creator address committed in each market. Amounts are read live from each fee splitter{deployment ? ` on ${deployment.chainName}` : ""}.</p></div>
          </div>
          {markets.length ? <dl className="metrics">{entries.map(({ agent, market }, i) => {
            const v = balances ? balances[market.address] : undefined;
            const amount = v === undefined || v === null ? null : Number(formatUnits(BigInt(v), market.quoteDecimals));
            return <div className="stack reveal-up" key={market.address} style={{ ...stagger(i), gap: 6 }}>
              <Link href={`/agents/${agent.address}#treasury`} className="metric" title={`Open the treasury of ${agent.name}`}>
                <dt>{market.name} · ${market.symbol}</dt>
                <dd>{v === null ? <span className="dim">unavailable</span> : <Count value={amount} format={fraction} />}<small>{v === undefined ? "reading balance…" : `${market.quoteSymbol} claimable`}</small></dd>
              </Link>
              <div className="row between" style={{ padding: "0 4px" }}>
                <span className="row" style={{ gap: 6 }}><span className="mono">splitter</span><AddressTap address={market.feeSplitter} explorerUrl={deployment?.explorerUrl} /></span>
                <button type="button" className="pill sm primary" data-sfx="confirm" disabled={busy || !v || v === "0"} onClick={() => claim(market.feeSplitter)}>{busy ? "Waiting for wallet…" : "Claim fees"}</button>
              </div>
            </div>; })}</dl>
            : <div className="empty reveal-up"><h3>No markets pay creator fees to this wallet yet</h3><p>Set this wallet as the creator when you deploy and every trade on the agent&apos;s markets earns you a share.</p><Link href="/deploy" className="pill primary">Deploy an agent</Link></div>}
          {claimError && <p className="notice err" role="alert" style={{ marginTop: 12 }}>{claimError}</p>}
        </section>
      </>}
  </main>;
}
