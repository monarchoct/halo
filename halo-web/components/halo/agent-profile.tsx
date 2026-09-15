"use client";
import Link from "next/link";
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { ArrowUpRight, Check, Coins, Copy, ExternalLink, Plus, RefreshCw, ShieldCheck, Waypoints } from "lucide-react";
import { createPublicClient, formatUnits, http, type Abi } from "viem";
import { AddressTap, CoinCard, statueFor } from "./market-card";
import { CycleRing } from "./cycle-ring";
import { DataState } from "./data-state";
import { LiveActivity } from "./live-activity";
import { DecisionEvidence } from "./decision-evidence";
import { AgentOperations } from "./agent-operations";
import { SocialConnect } from "./social-connect";
import { useApi, useProtocol } from "./protocol-provider";
import type { Agent, ActionRecord } from "@/lib/halo-types";
import { amount, compact, curveProgress, days, fdvQuote, relativeTime, shortAddress } from "@/lib/format";
import { countUp } from "@/lib/reveal";
import vaultAbi from "@/lib/generated/AgentVault.json";
import tokenAbi from "@/lib/generated/HaloToken.json";
import feeTreasuryAbi from "@/lib/generated/AgentFeeTreasury.json";

const kinds = ["Hold decision", "Child token launched", "Position purchased", "Position sold"];
const SECTIONS = [["runtime", "Runtime"], ["children", "Coins"], ["actions", "Actions"], ["live", "Live"], ["treasury", "Treasury"], ["operations", "Operations"], ["proofs", "Proofs"], ["social", "Social"]] as const;
/** The reserve a top-up buys; the runway bar is measured against it. */
const RUNWAY_TARGET_DAYS = 30;
const fmtInt = (n: number) => Math.round(n).toLocaleString("en-US");
const fmtDays = (n: number) => n.toFixed(1);
const fmtMinutes = (n: number) => (Math.round(n * 10) / 10).toLocaleString("en-US");
const fmtCompact = (n: number) => compact(n);
const fmtFine = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 6 });
const toNumber = (value: string, decimals = 18) => Number(formatUnits(BigInt(value), decimals));
const stagger = (i: number) => ({ "--i": i % 8 } as CSSProperties);

/** Animates the element's text from its last value to `value` whenever a new value arrives. The formatted value is rendered server-side so nothing is blank without JS. */
function useCountUp(value: number | null, format: (n: number) => string) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => { if (ref.current && value !== null && Number.isFinite(value)) return countUp(ref.current, value, 900, format); }, [value, format]);
  return ref;
}

/** A metric is always a control: it links to the section or market that explains it. */
function Metric({ href, label, title, children, progress }: { href: string; label: string; title?: string; children: ReactNode; progress?: number }) {
  const body = <dl className="stack" style={{ gap: 4 }}><dt>{label}</dt><dd className="num">{children}</dd>
    {progress !== undefined && <div className="progress" aria-hidden="true"><i style={{ "--w": `${Math.max(0, Math.min(100, progress))}%` } as CSSProperties} /></div>}</dl>;
  return /^https?:/.test(href) ? <a className="metric" href={href} target="_blank" rel="noreferrer" title={title} data-sfx="click">{body}</a>
    : <Link className="metric" href={href} title={title} data-sfx="click">{body}</Link>;
}

/** Copy-on-click for a 32-byte commitment; the explorer has no page for these. */
function HashTap({ label, value, index }: { label: string; value: string; index: number }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => { try { await navigator.clipboard.writeText(value); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch {} };
  return <div className="hash-block reveal-up" style={stagger(index)}>
    <div className="row between"><p>{label}</p><button type="button" className={`pill sm ghost ${copied ? "copied" : ""}`} data-sfx="confirm" onClick={copy} aria-label={`Copy ${label.toLowerCase()}`}>{copied ? <Check size={13} /> : <Copy size={13} />} {copied ? "Copied" : "Copy"}</button></div>
    <code className="hash" title={value}>{value}</code>
  </div>;
}

export function AgentProfile({ id }: { id: string }) {
  const { data: agent, loading, error, refresh } = useApi<Agent>(`/v1/agents/${id}`);
  const { data: history, refresh: refreshHistory } = useApi<{ actions: ActionRecord[]; completeHistory: boolean }>(`/v1/agents/${id}/actions`);
  const { deployment, address, submit, transaction, status } = useProtocol();
  const [operationError, setOperationError] = useState("");
  const [section, setSection] = useState<string>("runtime");
  const [lastBlock, setLastBlock] = useState<{ block: string; at: number } | null>(null);
  const busy = transaction?.state === "approval" || transaction?.state === "pending";
  const halo = deployment?.haloSymbol ?? "TALOS", ops = deployment?.operatingSymbol ?? "WETH";
  const explorer = deployment?.explorerUrl;
  const tx = (hash: string) => explorer ? `${explorer}/tx/${hash}` : undefined;

  // Derived numbers are computed before the early return so every count-up hook runs on each render.
  const m = agent?.market ?? null;
  const pct = m ? (m.graduated ? 100 : curveProgress(m.sold)) : 0;
  const live = !!agent?.active && !m?.graduated;
  const pnl = agent ? BigInt(agent.realizedPnl) : 0n;
  const runwayDays = agent ? Number(agent.runwaySeconds) / 86400 : null;
  const runwayPct = runwayDays === null ? 0 : runwayDays / RUNWAY_TARGET_DAYS * 100;
  const intervalMinutes = agent ? agent.policy.intervalSeconds / 60 : null;
  const fdvRef = useCountUp(m ? fdvQuote(m) : null, fmtCompact);
  const coinsRef = useCountUp(agent ? Number(agent.childCount) : null, fmtInt);
  const runwayRef = useCountUp(runwayDays, fmtDays);
  const reserveRef = useCountUp(runwayDays, fmtDays);
  const pnlRef = useCountUp(agent ? toNumber(agent.realizedPnl) : null, fmtCompact);
  const cyclesRef = useCountUp(agent ? Number(agent.nonce) : null, fmtInt);
  const cyclesRuntimeRef = useCountUp(agent ? Number(agent.nonce) : null, fmtInt);
  const intervalRef = useCountUp(intervalMinutes, fmtMinutes);
  const workRewardRef = useCountUp(agent ? toNumber(agent.policy.workReward) : null, fmtFine);
  const workPaidRef = useCountUp(agent ? toNumber(agent.totalWorkPaid) : null, fmtFine);
  const operatingRef = useCountUp(agent ? toNumber(agent.operatingBalance) : null, fmtFine);
  const tradingRef = useCountUp(agent ? toNumber(agent.tradingBalance) : null, fmtCompact);
  const capitalRef = useCountUp(agent ? toNumber(agent.capitalBasis) : null, fmtCompact);
  const feesInRef = useCountUp(agent?.feeAccounting ? toNumber(agent.feeAccounting.totalOperatingReceived) : null, fmtFine);

  // The newest action by nonce; its block timestamp gives the "last action" time.
  const latest = history?.actions.reduce<ActionRecord | null>((best, action) => !best || BigInt(action.nonce) > BigInt(best.nonce) ? action : best, null) ?? null;
  const latestBlock = latest?.blockNumber ?? null;
  useEffect(() => {
    if (latestBlock === null || !deployment) return;
    let cancelled = false;
    createPublicClient({ transport: http(deployment.rpcUrl) }).getBlock({ blockNumber: BigInt(latestBlock) })
      .then(block => { if (!cancelled) setLastBlock({ block: latestBlock, at: Number(block.timestamp) * 1000 }); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [latestBlock, deployment]);
  const lastAt = lastBlock && lastBlock.block === latestBlock ? lastBlock.at : null;
  const latestReceipt = latest ? tx(latest.transactionHash) : undefined;

  // The section nav follows the reader down the page.
  const ready = !!agent;
  useEffect(() => {
    if (!ready) return;
    const targets = SECTIONS.map(([sid]) => document.getElementById(sid)).filter((el): el is HTMLElement => !!el);
    const io = new IntersectionObserver(entries => {
      const hit = entries.filter(e => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
      if (hit) setSection(hit.target.id);
    }, { rootMargin: "-20% 0px -65% 0px" });
    targets.forEach(el => io.observe(el));
    return () => io.disconnect();
  }, [ready]);

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
  if (!agent || !m) return <main id="main" className="wrap page"><DataState loading={loading} error={error} retry={refresh} /></main>;

  const refreshAll = () => { refresh(); refreshHistory(); };
  const ringLabel = `${pct.toFixed(0)}% of the curve sold${live ? ", agent live" : m.graduated ? ", graduated" : ""}`;
  const stateChip = m.graduated ? <Link href="/explore" className="chip bronze" title="Browse graduated agents">Graduated</Link>
    : agent.active ? <Link href="/explore" className="chip green live" title="Browse live agents"><i aria-hidden="true" />Live</Link>
    : <Link href="/explore" className="chip" title="Browse agents">Not activated</Link>;

  return <main id="main" className="wrap page">
    <nav className="breadcrumb reveal-up" aria-label="Breadcrumb"><Link href="/explore">Explore</Link><span>/</span><Link href="/explore">Agents</Link><span>/</span><span>{agent.symbol}</span></nav>

    <header className="market-head reveal-up" style={stagger(1)}>
      <Link href={`/tokens/${agent.agentToken}`} className="avatar" aria-label={`Open the $${agent.symbol} market`}><img src={statueFor(agent.address)} alt="" decoding="async" /></Link>
      <div className="title"><h1>{agent.name}</h1>
        <div className="pair"><Link href={`/tokens/${agent.agentToken}`} className="tap" title="Open the market"><b>${agent.symbol} / ${halo}</b></Link>{stateChip}
          {m.graduated ? <Link href={`/tokens/${agent.agentToken}`} className="chip purple" title="Open the graduated market">Curve sold out</Link> : <Link href={`/tokens/${agent.agentToken}`} className="chip purple" title="Open the market">{pct.toFixed(0)}% of curve sold</Link>}
          <Link href={`/explore?view=coins&parent=${agent.address}`} className="chip" title="Coins launched by this agent">{agent.childCount} {Number(agent.childCount) === 1 ? "coin" : "coins"}</Link>
          {deployment?.environment === "local" && <span className="chip">Local test agent</span>}</div>
        <div className="links"><span className="mono">Vault</span><AddressTap address={agent.address} explorerUrl={explorer} /><span className="mono">Creator</span><AddressTap address={agent.creator} explorerUrl={explorer} /></div></div>
      <div className="market-actions" style={{ alignItems: "center", gap: 14 }}>
        <Link href="#runtime" className="ring lg" title={`Cycle ${agent.nonce} · ${ringLabel}`} data-sfx="click"><CycleRing pct={pct} live={live} size={96} label={ringLabel} /></Link>
        <Link href={`/tokens/${agent.agentToken}`} className="pill primary">Trade ${agent.symbol} <ArrowUpRight size={16} /></Link>
        <button type="button" className="pill" data-sfx="confirm" disabled={busy} onClick={topUp}><Plus size={16} /> Add {RUNWAY_TARGET_DAYS} days of runway</button>
        <button type="button" className="pill icon" aria-label="Refresh chain data" title="Refresh chain data" onClick={refreshAll}><RefreshCw size={16} /></button>
      </div>
    </header>

    <nav className="tabs reveal-up" aria-label="Sections" style={stagger(2)}>{SECTIONS.map(([sid, label]) => <a key={sid} href={`#${sid}`} data-sfx="click" aria-current={section === sid ? "page" : undefined}>{label}</a>)}</nav>

    <div className="metrics reveal-up" style={stagger(3)}>
      <Metric href={`/tokens/${agent.agentToken}`} label="FDV" title="Open the market"><span ref={fdvRef}>{compact(fdvQuote(m))}</span><small>{halo}</small></Metric>
      <Metric href="#children" label="Coins launched"><span ref={coinsRef}>{fmtInt(Number(agent.childCount))}</span><small>priced in {agent.symbol}</small></Metric>
      <Metric href="#treasury" label="Operating runway" progress={runwayPct}><span ref={runwayRef}>{days(agent.runwaySeconds)}</span><small>days at the current work rate</small></Metric>
      <Metric href="#treasury" label="Realized trading result" title={`${amount(agent.realizedPnl, 18, 6)} ${agent.symbol}`}><span ref={pnlRef} className={pnl < 0n ? "neg" : pnl > 0n ? "pos" : ""}>{compact(toNumber(agent.realizedPnl))}</span><small>{agent.symbol} · after fees</small></Metric>
      <Metric href="#runtime" label="Cycles"><span ref={cyclesRef}>{fmtInt(Number(agent.nonce))}</span><small>proven &amp; executed</small></Metric>
    </div>
    {operationError && <p className="notice err reveal-up" role="alert">{operationError}</p>}

    <section id="runtime" className="panel tint reveal-up" aria-labelledby="runtime-title">
      <div className="panel-head">
        <div><h2 id="runtime-title">Runtime {live ? <span className="chip green live"><i aria-hidden="true" />Live</span> : <span className="chip">{m.graduated ? "Graduated" : "Idle"}</span>}</h2>
          <p>One cycle every {intervalMinutes === null ? "—" : fmtMinutes(intervalMinutes)} minutes: read the chain, research, prove a decision, execute it. Each cycle is paid from the operating reserve.</p></div>
        <Link href={`/tokens/${agent.agentToken}`} className="pill sm">Open the ${agent.symbol} market <ArrowUpRight size={14} /></Link>
      </div>
      <div className="row" style={{ gap: 22, alignItems: "flex-start" }}>
        <Link href="#actions" className="ring lg" title={`Cycle ${agent.nonce} · ${ringLabel}`} data-sfx="click"><CycleRing pct={pct} live={live} size={96} label={ringLabel} /></Link>
        <div className="metrics" style={{ flex: "1 1 420px" }}>
          <Metric href="#actions" label="Cycles completed"><span ref={cyclesRuntimeRef}>{fmtInt(Number(agent.nonce))}</span><small>actions on chain</small></Metric>
          <Metric href="#proofs" label="Cadence" title="Committed in the policy"><small>one cycle every</small><span ref={intervalRef}>{intervalMinutes === null ? "—" : fmtMinutes(intervalMinutes)}</span><small>min</small></Metric>
          <Metric href={latestReceipt ?? "#actions"} label="Last action" title={lastAt ? new Date(lastAt).toLocaleString() : undefined}>
            {lastAt ? relativeTime(lastAt) : latest ? `#${latest.nonce}` : "—"}<small>{latest ? `block ${latest.blockNumber}` : "no action yet"}</small></Metric>
          <Metric href="#treasury" label="Reserve" progress={runwayPct}><span ref={reserveRef}>{days(agent.runwaySeconds)}</span><small>days of {RUNWAY_TARGET_DAYS}</small></Metric>
          <Metric href="#treasury" label="Work reward per cycle"><span ref={workRewardRef}>{fmtFine(toNumber(agent.policy.workReward))}</span><small>{ops}</small></Metric>
          <Metric href="#treasury" label="Total work paid"><span ref={workPaidRef}>{fmtFine(toNumber(agent.totalWorkPaid))}</span><small>{ops}</small></Metric>
        </div>
      </div>
    </section>

    <section id="children" className="panel reveal-up" aria-labelledby="children-title">
      <div className="panel-head"><div><h2 id="children-title">Coins <span className="count">{agent.childCount}</span></h2><p>Launched by {agent.name}; each is priced in ${agent.symbol}. Buying one with ETH routes through {halo} and ${agent.symbol} first.</p></div>
        <Link href={`/explore?view=coins&parent=${agent.address}`} className="pill sm">Browse on the board <ArrowUpRight size={14} /></Link></div>
      {agent.children.length ? <div className="grid-cards">{agent.children.map((child, i) => <CoinCard key={child.address} coin={child} parent={agent} index={i} />)}</div>
        : <div className="empty reveal-up"><h3>No coin launched yet</h3><p>Confirmed launches appear here as soon as the cycle that creates them executes.</p><Link href="#live" className="pill sm">Watch the next cycle</Link></div>}
    </section>

    <section id="actions" className="panel reveal-up" aria-labelledby="actions-title">
      <div className="panel-head"><div><h2 id="actions-title">Actions <span className="count">{agent.nonce}</span></h2><p>Every completed action carries a proof, a receipt and its evidence.</p></div>
        <button type="button" className="pill sm" onClick={refreshAll}><RefreshCw size={14} /> Refresh history</button></div>
      <div className="list">{history?.actions.map((action, i) => {
        const child = agent.children.find(item => item.address.toLowerCase() === action.child.toLowerCase()), trade = action.kind === 2 || action.kind === 3;
        const receipt = tx(action.transactionHash);
        return <article className="list-row hover reveal-up" key={action.transactionHash} style={stagger(i)} data-sfx="click">
          <Link className="glyph" href={child ? `/tokens/${child.address}` : "#runtime"} aria-label={child ? `Open $${child.symbol}` : "Runtime"} title={child ? `Open $${child.symbol}` : "Runtime"}>{action.kind === 1 ? <Waypoints size={20} /> : action.kind === 0 ? <ShieldCheck size={20} /> : <Coins size={20} />}</Link>
          <div className="info"><strong>{kinds[action.kind] ?? "Verified work"}{child && action.kind !== 0 && <> · <Link href={`/tokens/${child.address}`} className="tap">${child.symbol}</Link></>}</strong>
            {trade && child && <p className="num">{amount(action.amount, action.kind === 2 ? child.quoteDecimals : child.decimals)} {action.kind === 2 ? agent.symbol : child.symbol} → {amount(action.result, action.kind === 2 ? child.decimals : child.quoteDecimals)} {action.kind === 2 ? child.symbol : agent.symbol}</p>}
            <p className="dim"><Link href="#runtime" className="tap">Cycle {action.nonce}</Link> · {explorer ? <a className="tap" href={`${explorer}/block/${action.blockNumber}`} target="_blank" rel="noreferrer">Block {action.blockNumber}</a> : <>Block {action.blockNumber}</>} · <Link href="#treasury" className="tap num">{amount(action.workReward, 18, 6)} {ops} paid to the operator</Link></p>
            <DecisionEvidence agent={agent.address} action={action} /></div>
          {receipt ? <a className="pill sm" href={receipt} target="_blank" rel="noreferrer" title="Open the transaction in the explorer">Receipt <ExternalLink size={14} /></a> : <code className="hash" title={action.transactionHash}>{shortAddress(action.transactionHash)}</code>}
        </article>;
      })}</div>
      {!history?.actions.length && <div className="empty reveal-up"><h3>No confirmed action in this window</h3><p>Actions appear once a cycle is proven and executed on chain.</p><Link href="#live" className="pill sm">Watch the next cycle</Link></div>}
      {history && !history.completeHistory && <p className="dim" style={{ marginTop: 10 }}>Showing recent blocks. Older history requires the full indexer.</p>}
    </section>

    <section id="live" className="panel reveal-up" aria-labelledby="live-title">
      <div className="panel-head"><div><h2 id="live-title">Live</h2><p>Signed operator reports and a verified window into the agent&apos;s browser, checked in yours.</p></div>
        <Link href="#actions" className="pill sm ghost">Confirmed actions <ArrowUpRight size={14} /></Link></div>
      <LiveActivity agent={agent.address} onConfirmed={refreshAll} />
    </section>

    <section id="treasury" className="stack reveal-up" aria-labelledby="treasury-title">
      <div className="panel tint">
        <div className="panel-head"><div><h2 id="treasury-title">Treasury</h2><p>The operating reserve pays for cycles; trading inventory is what the agent buys and sells with. Deposits and market capitalization are never reported as profit.</p></div>
          <div className="row"><button type="button" className="pill" data-sfx="confirm" disabled={busy} onClick={topUp}><Plus size={15} /> Add {RUNWAY_TARGET_DAYS} days of runway</button>
            <button type="button" className="pill primary" data-sfx="confirm" disabled={busy || !address} onClick={claim} title={address ? "Collect earned operating fees into the reserve" : "Connect a wallet to claim fees"}>Claim earned fees</button></div></div>
        <div className="metrics">
          <Metric href={explorer ? `${explorer}/address/${agent.address}` : "#treasury"} label="Operating reserve" title="Vault on the explorer"><span ref={operatingRef}>{fmtFine(toNumber(agent.operatingBalance))}</span><small>{ops}</small></Metric>
          <Metric href="#runtime" label="Runway" progress={runwayPct}><span className="num">{days(agent.runwaySeconds)}</span><small>days of {RUNWAY_TARGET_DAYS}</small></Metric>
          <Metric href={`/tokens/${agent.agentToken}`} label="Trading inventory" title="Open the market"><span ref={tradingRef}>{compact(toNumber(agent.tradingBalance))}</span><small>{agent.symbol}</small></Metric>
          <Metric href={`/tokens/${agent.agentToken}`} label="Recorded capital" title="Open the market"><span ref={capitalRef}>{compact(toNumber(agent.capitalBasis))}</span><small>{agent.symbol}</small></Metric>
          {agent.feeAccounting && <Metric href={explorer ? `${explorer}/address/${agent.feeAccounting.treasury}` : "#treasury"} label="Reserve from fees" title="Fee treasury on the explorer"><span ref={feesInRef}>{fmtFine(toNumber(agent.feeAccounting.totalOperatingReceived))}</span><small>{ops}</small></Metric>}
        </div>
      </div>
      <div className="split reverse">
        <div className="panel reveal-up"><div className="panel-head"><h2>Funds &amp; costs</h2></div><table className="table kv"><tbody>
          <tr><th>Available trading inventory</th><td className="num"><Link href={`/tokens/${agent.agentToken}`} className="tap">{amount(agent.tradingBalance)} {agent.symbol}</Link></td></tr>
          <tr><th>Operating reserve</th><td className="num">{amount(agent.operatingBalance, 18, 6)} {ops}</td></tr>
          <tr><th>Recorded trading capital</th><td className="num">{amount(agent.capitalBasis)} {agent.symbol}</td></tr>
          <tr><th>Realized trading result</th><td className={`num ${pnl < 0n ? "neg" : pnl > 0n ? "pos" : ""}`}>{amount(agent.realizedPnl)} {agent.symbol}</td></tr>
          <tr><th>Operator work paid</th><td className="num"><Link href="#runtime" className="tap">{amount(agent.totalWorkPaid, 18, 6)} {ops}</Link></td></tr>
          <tr><th>Unrealized P&amp;L</th><td className="dim">Unavailable · no validated valuation feed</td></tr>
          {agent.feeAccounting && <><tr><th>Reserve replenished from fees</th><td className="num">{amount(agent.feeAccounting.totalOperatingReceived, 18, 6)} {ops}</td></tr><tr><th>Conversion work paid</th><td className="num">{amount(agent.feeAccounting.totalKeeperPaid, 18, 6)} {ops}</td></tr></>}
        </tbody></table><p className="dim" style={{ marginTop: 12 }}>Deposits and market capitalization are never reported as profit. Operator gas is separate from the vault&apos;s work payments.</p></div>
        <div className="panel sticky reveal-up" style={stagger(1)}><div className="panel-head"><h2>Fees keep it running</h2></div>
          {agent.feeAccounting ? <><p>Earned fees stay separate from trading capital. Independent operators convert them into {ops} when price history, liquidity and the work payment allow it.</p>
            <div className="table-scroll" style={{ marginTop: 12 }}><table className="table"><thead><tr><th>Fee asset</th><th>Pending</th><th>Ready</th></tr></thead><tbody>{agent.feeAccounting.balances.map(b => <tr key={b.address}><td><span className="row" style={{ gap: 6 }}>{b.symbol}<AddressTap address={b.address} explorerUrl={explorer} /></span></td><td className="num">{amount(b.pending, b.decimals, 6)}</td><td className="num">{amount(b.claimable, b.decimals, 6)}</td></tr>)}</tbody></table></div>
            <p className="dim" style={{ marginTop: 10 }}><span className="row" style={{ gap: 6, display: "inline-flex" }}>Treasury <AddressTap address={agent.feeAccounting.treasury} explorerUrl={explorer} /></span>. A conversion worker receives at most 1% of proceeds, capped at the work reward. {agent.feeAccounting.completeSources ? "All launched tokens included." : "First 100 child markets shown."}</p></>
            : <p>Operating fees are collected in their original tokens. Automatic conversion is unavailable for this agent.</p>}
          <button type="button" className="pill" style={{ marginTop: 14 }} data-sfx="confirm" disabled={busy || !address} onClick={claim}>Claim earned fees</button></div>
      </div>
    </section>

    <section id="operations" className="stack reveal-up" aria-labelledby="operations-title">
      <div className="panel-head"><div><h2 id="operations-title">Operations</h2><p>Operator-side records: jobs, inbox and publication attempts. Reports, not chain truth; Actions holds the receipts.</p></div>
        <Link href="#actions" className="pill sm ghost">Chain receipts <ArrowUpRight size={14} /></Link></div>
      <AgentOperations agent={agent.address} />
    </section>

    <section id="proofs" className="split reverse reveal-up" aria-labelledby="proofs-title">
      <div className="panel"><div className="panel-head"><div><h2 id="proofs-title">Policy &amp; proof</h2><p>Committed at activation. Immutable: this vault exposes no owner pause, withdrawal, upgrade or policy replacement.</p></div></div><table className="table kv"><tbody>
        <tr><th>Trading venues</th><td><Link href={`/tokens/${agent.agentToken}`} className="tap">{agent.tradeRouter ? "Bonding curve, then the official graduated Uniswap v4 pool" : "Bonding curve"}</Link></td></tr>
        <tr><th>Maximum position</th><td className="num">{agent.policy.maxPositionBps / 100}% of accounted trading capital</td></tr><tr><th>Daily trading debits</th><td className="num">{agent.policy.maxDailyDebitBps / 100}% maximum</td></tr>
        <tr><th>Work interval</th><td className="num"><Link href="#runtime" className="tap">{agent.policy.intervalSeconds / 60} minutes</Link></td></tr><tr><th>Maximum launches</th><td className="num">{agent.policy.maxLaunchesPerDay} per UTC day</td></tr>
        <tr><th>Work reward</th><td className="num"><Link href="#runtime" className="tap">{amount(agent.policy.workReward, 18, 6)} {ops} per cycle</Link></td></tr>
        <tr><th>Trade slippage</th><td className="num">{agent.policy.maxSlippageBps / 100}% below the recorded quote</td></tr><tr><th>Trading fee</th><td className="num">{agent.fees.tradingBps / 100}%</td></tr>
        <tr><th>Fee distribution</th><td className="num">{agent.fees.operationsBps / 100}% operations · {agent.fees.haloBps / 100}% {halo} · {(10000 - agent.fees.operationsBps - agent.fees.haloBps) / 100}% creator</td></tr>
        <tr><th>Fee recipients</th><td><span className="row" style={{ gap: 10 }}><span className="row" style={{ gap: 6 }}><span className="mono">Operations</span><AddressTap address={agent.fees.operations} explorerUrl={explorer} /></span><span className="row" style={{ gap: 6 }}><span className="mono">Creator</span><AddressTap address={agent.fees.creator} explorerUrl={explorer} /></span></span></td></tr>
      </tbody></table></div>
      <div className="stack"><HashTap label="Manifest commitment" value={agent.manifestHash} index={0} /><HashTap label="Policy commitment" value={agent.policyHash} index={1} /><HashTap label="Decision core" value={agent.coreId} index={2} />
        <p className="notice reveal-up" style={stagger(3)}>The proof establishes that each action satisfies these rules. It does not prove that a larger model chose the action without human involvement.</p></div>
    </section>

    <section id="social" className="panel reveal-up" aria-labelledby="social-title">
      <div className="panel-head"><div><h2 id="social-title">Social</h2><p>Where this agent publishes its theses.</p></div>
        <Link href="#operations" className="pill sm ghost">Publication records <ArrowUpRight size={14} /></Link></div>
      <SocialConnect agent={agent} />
    </section>
  </main>;
}
