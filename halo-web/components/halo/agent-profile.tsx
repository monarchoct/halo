"use client";
import Link from "next/link";
import { ArrowUpRight, Coins, Plus, ShieldCheck, Waypoints } from "lucide-react";
import { formatUnits, type Abi } from "viem";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Portrait } from "./agent-card";
import { DataState } from "./data-state";
import { LiveActivity } from "./live-activity";
import { DecisionEvidence } from "./decision-evidence";
import { AgentOperations } from "./agent-operations";
import { useApi, useProtocol } from "./protocol-provider";
import { days, shortAddress, type Agent, type ActionRecord } from "@/lib/halo-types";
import vaultAbi from "@/lib/generated/AgentVault.json";
import tokenAbi from "@/lib/generated/HaloToken.json";
import feeTreasuryAbi from "@/lib/generated/AgentFeeTreasury.json";
export const amount = (value: string, decimals = 18, maximumFractionDigits = 3) => Number(formatUnits(BigInt(value), decimals)).toLocaleString("en-US", { maximumFractionDigits });

export function AgentProfile({ id }: { id: string }) {
  const { data: agent, loading, error, refresh } = useApi<Agent>(`/v1/agents/${id}`);
  const { data: history, refresh: refreshHistory } = useApi<{ actions: ActionRecord[]; completeHistory: boolean }>(`/v1/agents/${id}/actions`);
  const { deployment, address, submit, transaction, status } = useProtocol();
  const [operationError, setOperationError] = useState("");
  const busy = transaction?.state === "approval" || transaction?.state === "pending";
  async function topUp() {
    if (!agent || !deployment) return;
    try { setOperationError(""); await submit(deployment.operatingToken, tokenAbi as Abi, "transfer", [agent.address, BigInt(agent.reserveRequired)], "Add 30 days of operating funds"); refresh(); }
    catch (error) { setOperationError((error as Error).message); }
  }
  async function claim() {
    if (!agent) return;
    try {
      setOperationError("");
      if (agent.feeAccounting) {
        if (!status) throw new Error("Wait for the latest chain status before collecting fees.");
        const sources = [agent.market, ...agent.children].slice(0, 16).map(market => ({ token: market.address, baseToConvert: 0n }));
        await submit(agent.feeAccounting.treasury, feeTreasuryAbi as Abi, "collect",
          [sources, BigInt(status.blockTimestamp) + 600n], "Collect operating fees");
      } else {
        for (const market of [agent.market, ...agent.children]) await submit(agent.address, vaultAbi as Abi, "claimFees", [market.address], `Collect ${market.symbol} operating fees`);
      }
      refresh();
    }
    catch (error) { setOperationError((error as Error).message); }
  }
  if (!agent) return <main id="main" className="wrap page-main"><DataState loading={loading} error={error} retry={refresh} /></main>;
  return <main id="main" className="wrap page-main"><p className="eyebrow"><Link href="/explore">EXPLORE</Link> / {agent.symbol}</p>
    <div className="profile-layout"><aside className="profile-sidebar"><div className="profile-art"><Portrait name={agent.name} /></div><h1>{agent.name}</h1>
      <p>${agent.symbol} · Autonomous coin deployer</p><div className="profile-labels"><Badge variant="secondary">{agent.active ? "Activated" : "Not activated"}</Badge><Badge variant="outline">{deployment?.environment === "local" ? "Local test agent" : "Robinhood Chain"}</Badge></div>
      <p className="small-note">{agent.policy.maxLaunchesPerDay} launches per day at most. One agent can develop many separate token narratives.</p>
      <div className="profile-actions"><Button asChild><Link href={`/tokens/${agent.agentToken}`}>View ${agent.symbol}<ArrowUpRight data-icon="inline-end" /></Link></Button>
        <Button variant="outline" onClick={topUp} disabled={busy}><Plus data-icon="inline-start" />Add 30 days of runway</Button>
        <Button variant="ghost" onClick={() => { refresh(); refreshHistory(); }}>Refresh chain data</Button></div>
      <p className="small-note">Created by {shortAddress(agent.creator)}<br />Vault {shortAddress(agent.address)}</p></aside>
    <section className="profile-main"><h2>An economy in motion.</h2><p style={{ marginTop: 12 }}>Every coin, decision and operating payment leaves a public record.</p>
      <dl className="metrics"><div className="metric"><dt>Coins launched</dt><dd>{agent.childCount}<small>Quoted in {agent.symbol}</small></dd></div>
        <div className="metric"><dt>Operating runway</dt><dd>{days(agent.runwaySeconds)}<small>Days at current work rate</small></dd></div>
        <div className="metric"><dt>Realized trading result</dt><dd className={BigInt(agent.realizedPnl) < 0n ? "negative" : ""} title={`${amount(agent.realizedPnl, 18, 6)} ${agent.symbol}`}>
          <span className="metric-full-value">{amount(agent.realizedPnl)}</span><span className="metric-compact-value">{Number(formatUnits(BigInt(agent.realizedPnl), 18)).toLocaleString("en-US", { notation: "compact", maximumFractionDigits: 2 })}</span>
          <small>{agent.symbol} · after trading fees</small></dd></div></dl>
      {deployment?.environment === "local" && <p className="small-note">Local test results · test assets and simulated market conditions.</p>}
      {operationError && <Alert variant="destructive"><AlertDescription>{operationError}</AlertDescription></Alert>}
      <Tabs defaultValue="coins"><TabsList><TabsTrigger value="coins">Coins</TabsTrigger><TabsTrigger value="live">Live</TabsTrigger><TabsTrigger value="operations">Operations</TabsTrigger><TabsTrigger value="activity">Activity</TabsTrigger><TabsTrigger value="treasury">Treasury</TabsTrigger><TabsTrigger value="policy">Policy & proof</TabsTrigger></TabsList>
        <TabsContent value="operations"><AgentOperations agent={agent.address} /></TabsContent>
        <TabsContent value="live"><LiveActivity agent={agent.address} onConfirmed={() => { refresh(); refreshHistory(); }} /></TabsContent>
        <TabsContent value="coins"><div className="section-topline"><h2>Launched by {agent.name}</h2><span className="small-note">{agent.childCount} coins</span></div>
          <div className="token-list">{agent.children.map(child => <Link className="token-row" key={child.address} href={`/tokens/${child.address}`}><span className="token-glyph">{child.symbol[0]}</span>
            <div className="token-info"><h3>{child.name}</h3><p>${child.symbol} / ${agent.symbol}</p><div className="curve-progress" aria-label={`${Math.min(100, Number(child.sold) / 8e26 * 100).toFixed(1)} percent of curve sold`}><div style={{ width: `${Math.min(100, Number(child.sold) / 8e26 * 100)}%` }} /></div></div>
            <Badge variant="secondary">{child.graduated ? "Graduated" : "On curve"}</Badge><ArrowUpRight aria-hidden="true" /></Link>)}</div>
          {!agent.children.length && <p style={{ paddingBlock: 30 }}>No child token has been launched yet. Confirmed launches will appear here.</p>}</TabsContent>
        <TabsContent value="activity"><div className="section-topline"><h2>Public activity</h2><span className="small-note">{agent.nonce} completed actions</span></div>
          {history?.actions.map(action => {
            const child = agent.children.find(item => item.address.toLowerCase() === action.child.toLowerCase());
            const isTrade = action.kind === 2 || action.kind === 3;
            return <article className="action-row" key={action.transactionHash}><span>{action.kind === 1 ? <Waypoints /> : action.kind === 0 ? <ShieldCheck /> : <Coins />}</span>
            <div><strong>{["Hold decision", "Child token launched", "Position purchased", "Position sold"][action.kind] || "Verified work"}</strong>
              {isTrade && child && <p>{amount(action.amount, action.kind === 2 ? child.quoteDecimals : child.decimals)} {action.kind === 2 ? agent.symbol : child.symbol} → {amount(action.result, action.kind === 2 ? child.decimals : child.quoteDecimals)} {action.kind === 2 ? child.symbol : agent.symbol}</p>}
              <p>Action #{action.nonce} · Block {action.blockNumber} · {amount(action.workReward, 18, 6)} {deployment?.operatingSymbol} paid</p><DecisionEvidence agent={agent.address} action={action} /></div>
            {deployment?.explorerUrl ? <a href={`${deployment.explorerUrl}/tx/${action.transactionHash}`} target="_blank" rel="noreferrer">View receipt</a> : <code title={action.transactionHash}>{shortAddress(action.transactionHash)}</code>}</article>;
          })}
          {!history?.actions.length && <p style={{ paddingBlock: 25 }}>No confirmed actions are available in this history window.</p>}
          {history && !history.completeHistory && <p className="small-note">Showing recent blocks. Older history requires the full indexer or your own RPC query.</p>}</TabsContent>
        <TabsContent value="treasury"><div className="section-topline"><h2>Funds & costs</h2></div><table className="details-table"><tbody>
          <tr><th>Available trading inventory</th><td>{amount(agent.tradingBalance)} {agent.symbol}</td></tr><tr><th>Operating reserve</th><td>{amount(agent.operatingBalance, 18, 6)} {deployment?.operatingSymbol}</td></tr>
          <tr><th>Recorded trading capital</th><td>{amount(agent.capitalBasis)} {agent.symbol}</td></tr><tr><th>Realized trading result</th><td>{amount(agent.realizedPnl)} {agent.symbol}</td></tr>
          <tr><th>Operator work paid</th><td>{amount(agent.totalWorkPaid, 18, 6)} {deployment?.operatingSymbol}</td></tr><tr><th>Unrealized P&L</th><td>Unavailable · no validated valuation feed</td></tr>
          {agent.feeAccounting && <><tr><th>Reserve replenished from fees</th><td>{amount(agent.feeAccounting.totalOperatingReceived, 18, 6)} {deployment?.operatingSymbol}</td></tr>
            <tr><th>Conversion work paid</th><td>{amount(agent.feeAccounting.totalKeeperPaid, 18, 6)} {deployment?.operatingSymbol}</td></tr></>}
        </tbody></table><p className="warning-copy">Deposits and token market capitalization are not reported as profit. Gas paid by operators is separate from the vault’s work payments.</p>
          {agent.feeAccounting ? <section aria-label="Fee conversion"><h3>Fees keep the agent running.</h3>
            <p className="small-note">Earned fees stay separate from trading capital. Independent operators can convert them into {deployment?.operatingSymbol} when price history, liquidity and the work payment allow it.</p>
            <table className="details-table fee-balances-table"><thead><tr><th>Fee asset</th><th>Pending conversion</th><th>Ready to collect</th></tr></thead><tbody>
              {agent.feeAccounting.balances.map(balance => <tr key={balance.address}><th>{balance.symbol}</th><td>{amount(balance.pending, balance.decimals, 6)}</td><td>{amount(balance.claimable, balance.decimals, 6)}</td></tr>)}
            </tbody></table><p className="small-note">Uncollected pool fees and direct token transfers are excluded. {agent.feeAccounting.completeSources ? "All launched tokens are included." : "Showing the first 100 child markets."}</p>
            <p className="small-note">Fee treasury <code title={agent.feeAccounting.treasury}>{shortAddress(agent.feeAccounting.treasury)}</code>. A conversion worker receives at most 1% of converted proceeds, capped at the agent’s work reward.</p>
          </section> : <p className="small-note">Operating fees are collected in their original tokens. Automatic conversion is unavailable for this agent.</p>}
          <Button variant="outline" disabled={busy || !address} onClick={claim}>Collect earned operating fees</Button></TabsContent>
        <TabsContent value="policy"><div className="section-topline"><h2>Committed at activation</h2></div><table className="details-table"><tbody>
          <tr><th>Trading venues</th><td>{agent.tradeRouter ? "Bonding curve, then the official graduated Uniswap pool" : "Bonding curve"}</td></tr>
          <tr><th>Maximum position</th><td>{agent.policy.maxPositionBps / 100}% of accounted trading capital</td></tr><tr><th>Daily trading debits</th><td>{agent.policy.maxDailyDebitBps / 100}% maximum</td></tr>
          <tr><th>Work interval</th><td>{agent.policy.intervalSeconds / 60} minutes</td></tr><tr><th>Maximum launches</th><td>{agent.policy.maxLaunchesPerDay} per UTC day</td></tr>
          <tr><th>Trade slippage</th><td>{agent.policy.maxSlippageBps / 100}% below the recorded quote</td></tr><tr><th>Trading fee</th><td>{agent.fees.tradingBps / 100}%</td></tr>
          <tr><th>Fee distribution</th><td>{agent.fees.operationsBps / 100}% operations · {agent.fees.haloBps / 100}% HALO · {(10000 - agent.fees.operationsBps - agent.fees.haloBps) / 100}% creator</td></tr>
        </tbody></table><p className="warning-copy">The public ONNX core proves a small authorization graph. Larger model research is unproven. Once activated, this vault exposes no owner pause, withdrawal or policy replacement.</p>
          {[['Manifest commitment', agent.manifestHash], ['Policy commitment', agent.policyHash], ['Decision core', agent.coreId]].map(([label, value]) => <div className="hash-block" key={label}><p>{label}</p><code>{value}</code></div>)}</TabsContent>
      </Tabs>
    </section></div></main>;
}
