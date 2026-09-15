"use client";
import Link from "next/link";
import { useState } from "react";
import { ArrowUpRight, Coins, ExternalLink, Plus, RefreshCw, ShieldCheck, Waypoints } from "lucide-react";
import { formatUnits, type Abi } from "viem";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Art, CoinCard } from "./market-card";
import { DataState } from "./data-state";
import { LiveActivity } from "./live-activity";
import { DecisionEvidence } from "./decision-evidence";
import { AgentOperations } from "./agent-operations";
import { useApi, useProtocol } from "./protocol-provider";
import type { Agent, ActionRecord } from "@/lib/halo-types";
import { amount, compact, curveProgress, days, fdvQuote, shortAddress } from "@/lib/format";
import vaultAbi from "@/lib/generated/AgentVault.json";
import tokenAbi from "@/lib/generated/HaloToken.json";
import feeTreasuryAbi from "@/lib/generated/AgentFeeTreasury.json";

const kinds = ["Hold decision", "Child token launched", "Position purchased", "Position sold"];

export function AgentProfile({ id }: { id: string }) {
  const { data: agent, loading, error, refresh } = useApi<Agent>(`/v1/agents/${id}`);
  const { data: history, refresh: refreshHistory } = useApi<{ actions: ActionRecord[]; completeHistory: boolean }>(`/v1/agents/${id}/actions`);
  const { deployment, address, submit, transaction, status } = useProtocol();
  const [operationError, setOperationError] = useState("");
  const busy = transaction?.state === "approval" || transaction?.state === "pending";
  const halo = deployment?.haloSymbol ?? "HALO", ops = deployment?.operatingSymbol ?? "WETH";
  async function topUp() {
    if (!agent || !deployment) return;
    try { setOperationError(""); await submit(deployment.operatingToken, tokenAbi as Abi, "transfer", [agent.address, BigInt(agent.reserveRequired)], "Add 30 days of operating funds"); refresh(); }
    catch (e) { setOperationError((e as Error).message); }
  }
  async function claim() {
    if (!agent) return;
    try {
      setOperationError("");
      if (agent.feeAccounting) {
        if (!status) throw new Error("Wait for the latest chain status before collecting fees.");
        const sources = [agent.market, ...agent.children].slice(0, 16).map(market => ({ token: market.address, baseToConvert: 0n }));
        await submit(agent.feeAccounting.treasury, feeTreasuryAbi as Abi, "collect", [sources, BigInt(status.blockTimestamp) + 600n], "Collect operating fees");
      } else for (const market of [agent.market, ...agent.children]) await submit(agent.address, vaultAbi as Abi, "claimFees", [market.address], `Collect ${market.symbol} operating fees`);
      refresh();
    } catch (e) { setOperationError((e as Error).message); }
  }
  if (!agent) return <main id="main" className="wrap page"><DataState loading={loading} error={error} retry={refresh} /></main>;
  const m = agent.market, pnl = BigInt(agent.realizedPnl);
  const explorer = (hash: string) => deployment?.explorerUrl ? `${deployment.explorerUrl}/tx/${hash}` : undefined;
  return <main id="main" className="wrap page">
    <nav className="breadcrumb" aria-label="Breadcrumb"><Link href="/explore">Explore</Link><span>/</span><span>{agent.symbol}</span></nav>
    <header className="market-head">
      <div className="avatar"><Art seed={agent.address} symbol={agent.symbol} /></div>
      <div className="title"><h1>{agent.name}</h1>
        <div className="pair"><b>${agent.symbol} / ${halo}</b>{agent.active ? <span className="chip green">Active</span> : <span className="chip">Not activated</span>}{m.graduated ? <span className="chip orange">Graduated</span> : <span className="chip purple">{curveProgress(m.sold).toFixed(0)}% of curve sold</span>}{deployment?.environment === "local" && <span className="chip">Local test agent</span>}</div>
        <div className="links dim"><span className="mono">Vault {shortAddress(agent.address)}</span><span className="mono">Creator {shortAddress(agent.creator)}</span></div></div>
      <div className="market-actions"><Link href={`/tokens/${agent.agentToken}`} className="pill primary">Trade ${agent.symbol} <ArrowUpRight size={16} /></Link><button type="button" className="pill" disabled={busy} onClick={topUp}><Plus size={16} /> Add 30 days of runway</button><button type="button" className="pill icon" aria-label="Refresh chain data" onClick={() => { refresh(); refreshHistory(); }}><RefreshCw size={16} /></button></div>
    </header>

    <dl className="metrics">
      <div className="metric"><dt>FDV</dt><dd className="num">{compact(fdvQuote(m))}<small>{halo}</small></dd></div>
      <div className="metric"><dt>Coins launched</dt><dd>{agent.childCount}<small>quoted in {agent.symbol}</small></dd></div>
      <div className="metric"><dt>Operating runway</dt><dd>{days(agent.runwaySeconds)}<small>days at current work rate</small></dd></div>
      <div className="metric"><dt>Realized trading result</dt><dd className={`num ${pnl < 0n ? "neg" : pnl > 0n ? "pos" : ""}`} title={`${amount(agent.realizedPnl, 18, 6)} ${agent.symbol}`}>{compact(Number(formatUnits(pnl, 18)))}<small>{agent.symbol} · after fees</small></dd></div>
      <div className="metric"><dt>Actions</dt><dd>{agent.nonce}<small>proven &amp; executed</small></dd></div>
    </dl>
    {operationError && <p className="notice err" role="alert">{operationError}</p>}

    <Tabs defaultValue="coins">
      <TabsList><TabsTrigger value="coins"><Coins size={15} /> Coins</TabsTrigger><TabsTrigger value="live">Live</TabsTrigger><TabsTrigger value="activity">Activity</TabsTrigger><TabsTrigger value="operations">Operations</TabsTrigger><TabsTrigger value="treasury">Treasury</TabsTrigger><TabsTrigger value="policy"><ShieldCheck size={15} /> Policy &amp; proof</TabsTrigger></TabsList>
      <TabsContent value="coins">
        <div className="panel"><div className="panel-head"><div><h2>Launched by {agent.name} <span className="chip purple">{agent.childCount}</span></h2><p>Each coin is priced in ${agent.symbol}. Buying one with ETH routes through HALO and ${agent.symbol} first.</p></div></div>
          {agent.children.length ? <div className="grid-cards">{agent.children.map(child => <CoinCard key={child.address} coin={child} parent={agent} />)}</div> : <p className="dim">No child token has been launched yet. Confirmed launches appear here.</p>}</div>
      </TabsContent>
      <TabsContent value="live"><LiveActivity agent={agent.address} onConfirmed={() => { refresh(); refreshHistory(); }} /></TabsContent>
      <TabsContent value="operations"><AgentOperations agent={agent.address} /></TabsContent>
      <TabsContent value="activity">
        <div className="panel"><div className="panel-head"><div><h2>Public activity</h2><p>{agent.nonce} completed actions. Every one carries a proof, a receipt and its evidence.</p></div></div>
          <div className="list">{history?.actions.map(action => {
            const child = agent.children.find(item => item.address.toLowerCase() === action.child.toLowerCase()), trade = action.kind === 2 || action.kind === 3;
            return <article className="list-row" key={action.transactionHash}><span className="glyph" aria-hidden="true">{action.kind === 1 ? <Waypoints size={20} /> : action.kind === 0 ? <ShieldCheck size={20} /> : <Coins size={20} />}</span>
              <div className="info"><strong>{kinds[action.kind] ?? "Verified work"}{child && action.kind !== 0 && <> · <Link href={`/tokens/${child.address}`}>${child.symbol}</Link></>}</strong>
                {trade && child && <p>{amount(action.amount, action.kind === 2 ? child.quoteDecimals : child.decimals)} {action.kind === 2 ? agent.symbol : child.symbol} → {amount(action.result, action.kind === 2 ? child.decimals : child.quoteDecimals)} {action.kind === 2 ? child.symbol : agent.symbol}</p>}
                <p className="dim">Action #{action.nonce} · Block {action.blockNumber} · {amount(action.workReward, 18, 6)} {ops} paid to the operator</p><DecisionEvidence agent={agent.address} action={action} /></div>
              {explorer(action.transactionHash) ? <a className="pill sm" href={explorer(action.transactionHash)} target="_blank" rel="noreferrer">Receipt <ExternalLink size={14} /></a> : <code className="hash" title={action.transactionHash}>{shortAddress(action.transactionHash)}</code>}</article>;
          })}</div>
          {!history?.actions.length && <p className="dim">No confirmed actions in this history window.</p>}
          {history && !history.completeHistory && <p className="dim" style={{ marginTop: 10 }}>Showing recent blocks. Older history requires the full indexer.</p>}</div>
      </TabsContent>
      <TabsContent value="treasury">
        <div className="split reverse">
          <div className="panel"><div className="panel-head"><h2>Funds &amp; costs</h2></div><table className="table kv"><tbody>
            <tr><th>Available trading inventory</th><td>{amount(agent.tradingBalance)} {agent.symbol}</td></tr><tr><th>Operating reserve</th><td>{amount(agent.operatingBalance, 18, 6)} {ops}</td></tr>
            <tr><th>Recorded trading capital</th><td>{amount(agent.capitalBasis)} {agent.symbol}</td></tr><tr><th>Realized trading result</th><td className={pnl < 0n ? "neg" : ""}>{amount(agent.realizedPnl)} {agent.symbol}</td></tr>
            <tr><th>Operator work paid</th><td>{amount(agent.totalWorkPaid, 18, 6)} {ops}</td></tr><tr><th>Unrealized P&amp;L</th><td className="dim">Unavailable · no validated valuation feed</td></tr>
            {agent.feeAccounting && <><tr><th>Reserve replenished from fees</th><td>{amount(agent.feeAccounting.totalOperatingReceived, 18, 6)} {ops}</td></tr><tr><th>Conversion work paid</th><td>{amount(agent.feeAccounting.totalKeeperPaid, 18, 6)} {ops}</td></tr></>}
          </tbody></table><p className="dim" style={{ marginTop: 12 }}>Deposits and market capitalization are never reported as profit. Operator gas is separate from the vault&apos;s work payments.</p></div>
          <div className="panel sticky"><div className="panel-head"><h2>Fees keep it running</h2></div>
            {agent.feeAccounting ? <><p>Earned fees stay separate from trading capital. Independent operators convert them into {ops} when price history, liquidity and the work payment allow it.</p>
              <div className="table-scroll" style={{ marginTop: 12 }}><table className="table"><thead><tr><th>Fee asset</th><th>Pending</th><th>Ready</th></tr></thead><tbody>{agent.feeAccounting.balances.map(b => <tr key={b.address}><td>{b.symbol}</td><td className="num">{amount(b.pending, b.decimals, 6)}</td><td className="num">{amount(b.claimable, b.decimals, 6)}</td></tr>)}</tbody></table></div>
              <p className="dim" style={{ marginTop: 10 }}>Treasury <code>{shortAddress(agent.feeAccounting.treasury)}</code>. A conversion worker receives at most 1% of proceeds, capped at the work reward. {agent.feeAccounting.completeSources ? "All launched tokens included." : "First 100 child markets shown."}</p></>
              : <p>Operating fees are collected in their original tokens. Automatic conversion is unavailable for this agent.</p>}
            <button type="button" className="pill" style={{ marginTop: 14 }} disabled={busy || !address} onClick={claim}>Collect earned operating fees</button></div>
        </div>
      </TabsContent>
      <TabsContent value="policy">
        <div className="split reverse">
          <div className="panel"><div className="panel-head"><div><h2>Committed at activation</h2><p>Immutable. This vault exposes no owner pause, withdrawal, upgrade or policy replacement.</p></div></div><table className="table kv"><tbody>
            <tr><th>Trading venues</th><td>{agent.tradeRouter ? "Bonding curve, then the official graduated Uniswap v4 pool" : "Bonding curve"}</td></tr>
            <tr><th>Maximum position</th><td>{agent.policy.maxPositionBps / 100}% of accounted trading capital</td></tr><tr><th>Daily trading debits</th><td>{agent.policy.maxDailyDebitBps / 100}% maximum</td></tr>
            <tr><th>Work interval</th><td>{agent.policy.intervalSeconds / 60} minutes</td></tr><tr><th>Maximum launches</th><td>{agent.policy.maxLaunchesPerDay} per UTC day</td></tr>
            <tr><th>Trade slippage</th><td>{agent.policy.maxSlippageBps / 100}% below the recorded quote</td></tr><tr><th>Trading fee</th><td>{agent.fees.tradingBps / 100}%</td></tr>
            <tr><th>Fee distribution</th><td>{agent.fees.operationsBps / 100}% operations · {agent.fees.haloBps / 100}% HALO · {(10000 - agent.fees.operationsBps - agent.fees.haloBps) / 100}% creator</td></tr>
          </tbody></table></div>
          <div className="stack"><div className="hash-block"><p>Manifest commitment</p><code>{agent.manifestHash}</code></div><div className="hash-block"><p>Policy commitment</p><code>{agent.policyHash}</code></div><div className="hash-block"><p>Decision core</p><code>{agent.coreId}</code></div>
            <p className="notice">The proof establishes that each action satisfies these rules. It does not prove that a larger model chose the action without human involvement.</p></div>
        </div>
      </TabsContent>
    </Tabs>
  </main>;
}
