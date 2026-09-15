"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type CSSProperties, type MouseEvent } from "react";
import { ExternalLink, Pause, Play, RefreshCw } from "lucide-react";
import { DataState } from "@/components/halo/data-state";
import { useApi, useProtocol } from "@/components/halo/protocol-provider";
import { statueFor } from "@/components/halo/market-card";
import type { ActionRecord, Market } from "@/lib/halo-types";
import { amount, shortAddress } from "@/lib/format";
import { countUp } from "@/lib/reveal";
import { play } from "@/lib/sound";

type Item = ActionRecord & { agent: { address: string; name: string; symbol: string; agentToken: string }; childMarket: Market | null };
type Feed = { version: "halo.activity.v1"; activity: Item[]; agentsScanned: number; agentsTotal: number; partial: boolean };
type Filter = "all" | "launch" | "trade" | "proof" | "activation";
type Sample = { block: number; time: number };

const kinds = ["Hold decision", "Launched a coin", "Bought a position", "Sold a position"];
/** Action kind → feed category. Kinds 0–3 are the vault's proven actions; anything newer is reported as an activation. */
const categoryOf = (kind: number): Exclude<Filter, "all"> => kind === 1 ? "launch" : kind === 2 || kind === 3 ? "trade" : kind === 0 ? "proof" : "activation";
const filters: { id: Filter; label: string }[] = [{ id: "all", label: "All" }, { id: "launch", label: "Launches" }, { id: "trade", label: "Trades" }, { id: "proof", label: "Proofs" }, { id: "activation", label: "Activations" }];
const emptyCopy: { [key in Filter]: string } = { all: "Confirmed agent actions will appear here.", launch: "No coin launches in the last 100 actions.", trade: "No buys or sells in the last 100 actions.", proof: "No hold decisions in the last 100 actions.", activation: "No activations in the last 100 actions." };
const REFRESH_MS = 15000;
const stagger = (i: number) => ({ "--i": i % 8 } as CSSProperties);

/** Headline number that counts up whenever its value arrives or changes. */
function Count({ value, format = (n: number) => Math.round(n).toLocaleString("en-US") }: { value: number | null; format?: (n: number) => string }) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => { if (ref.current && value != null) return countUp(ref.current, value, 900, format); }, [value, format]);
  return <span ref={ref} className="num">{value == null ? "—" : format(value)}</span>;
}

/** Block age as text. With two status samples the chain's block time is known and the age is shown in seconds; before that, in blocks. */
function blockAge(block: string, head: Sample | null, secondsPerBlock: number | null, now: number) {
  if (!head) return null;
  const behind = Math.max(0, head.block - Number(block));
  if (secondsPerBlock == null) return behind === 0 ? "latest block" : `${behind.toLocaleString("en-US")} block${behind === 1 ? "" : "s"} ago`;
  const s = Math.max(0, Math.round(behind * secondsPerBlock + (now / 1000 - head.time)));
  if (s < 60) return `${s}s ago`; if (s < 3600) return `${Math.round(s / 60)}m ago`; if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}

export default function Activity() {
  const { deployment, status } = useProtocol();
  const { data, loading, error, refresh } = useApi<Feed>("/v1/activity?limit=100&agents=20");
  const router = useRouter();
  const [filter, setFilter] = useState<Filter>("all");
  const [live, setLive] = useState(true);
  // The clock ticks once a second for relative ages; block samples from the status poll ride along so no state is set inside an effect body.
  const [clock, setClock] = useState<{ now: number; samples: Sample[] }>({ now: 0, samples: [] });
  const latest = useRef<Sample | null>(null);
  useEffect(() => { latest.current = status ? { block: Number(status.blockNumber), time: Number(status.blockTimestamp) } : null; }, [status]);
  useEffect(() => {
    const tick = () => setClock(c => { const s = latest.current; const last = c.samples.at(-1);
      return { now: Date.now(), samples: s && s.block !== last?.block ? [...c.samples, s].slice(-6) : c.samples }; });
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    if (!live || !deployment) return;
    const timer = setInterval(refresh, REFRESH_MS);
    return () => clearInterval(timer);
  }, [live, deployment, refresh]);

  const head = clock.samples.at(-1) ?? null, first = clock.samples[0];
  const secondsPerBlock = head && first && head.block > first.block ? (head.time - first.time) / (head.block - first.block) : null;
  const explorer = deployment?.explorerUrl;
  const txUrl = (hash: string) => explorer ? `${explorer}/tx/${hash}` : undefined;
  const all = data?.activity ?? [];
  const counts = all.reduce((acc, a) => { acc[categoryOf(a.kind)] += 1; acc.all += 1; return acc; }, { all: 0, launch: 0, trade: 0, proof: 0, activation: 0 } as { [key in Filter]: number });
  const shown = filter === "all" ? all : all.filter(a => categoryOf(a.kind) === filter);
  const chain = status ? (status.environment === "local" ? "Local chain" : status.chainName) : deployment?.chainName ?? "Network";
  const go = (event: MouseEvent, href: string) => { event.preventDefault(); event.stopPropagation(); router.push(href); };
  const open = (event: MouseEvent, href: string) => { event.preventDefault(); event.stopPropagation(); window.open(href, "_blank", "noopener,noreferrer"); };
  const pick = (next: Filter) => { setFilter(next); play("click"); };

  return <main id="main" className="wrap page">
    <div className="reveal-up"><p className="eyebrow">{chain} · newest first</p><h1>Activity</h1>
      <p className="lede" style={{ marginTop: 8 }}>Every proven action across all agents: launches, trades and holds, each with its receipt and evidence.</p></div>

    <dl className="metrics" aria-label="Feed totals">
      <button type="button" className="metric reveal-up" style={stagger(0)} aria-pressed={filter === "all"} onClick={() => pick("all")}><dt>Actions in view</dt><dd><Count value={data ? counts.all : null} /><small>latest 100</small></dd></button>
      <button type="button" className="metric reveal-up" style={stagger(1)} aria-pressed={filter === "launch"} onClick={() => pick("launch")}><dt>Launches</dt><dd><Count value={data ? counts.launch : null} /><small>new coins</small></dd></button>
      <button type="button" className="metric reveal-up" style={stagger(2)} aria-pressed={filter === "trade"} onClick={() => pick("trade")}><dt>Trades</dt><dd><Count value={data ? counts.trade : null} /><small>buys &amp; sells</small></dd></button>
      <button type="button" className="metric reveal-up" style={stagger(3)} aria-pressed={filter === "proof"} onClick={() => pick("proof")}><dt>Proofs</dt><dd><Count value={data ? counts.proof : null} /><small>hold decisions</small></dd></button>
      <Link href="/explore" className="metric reveal-up" style={stagger(4)}><dt>Agents scanned</dt><dd><Count value={data ? data.agentsScanned : null} /><small>of <Count value={data ? data.agentsTotal : null} /> registered</small></dd></Link>
    </dl>

    <div className="row between reveal-up" style={stagger(1)}>
      <div className="chips" role="group" aria-label="Filter the feed">
        {filters.map(f => <button type="button" key={f.id} aria-pressed={filter === f.id} onClick={() => pick(f.id)} data-sfx="click">{f.label}{data && <span className="dim num" style={{ marginLeft: 6 }}>{counts[f.id]}</span>}</button>)}
      </div>
      <div className="row">
        <span className={`chip ${live ? "green live" : ""}`} role="status"><i aria-hidden="true" />{live ? "Live · every 15s" : "Paused"}</span>
        <button type="button" className="pill sm" onClick={() => setLive(v => !v)} aria-pressed={live}>{live ? <><Pause size={14} /> Pause live feed</> : <><Play size={14} /> Resume live feed</>}</button>
        <button type="button" className="pill icon sm" onClick={refresh} aria-label="Refresh the feed now" title="Refresh now"><RefreshCw size={14} /></button>
      </div>
    </div>

    {loading || error ? <DataState loading={loading} error={error} retry={refresh} cards={3} /> : !all.length ? <div className="empty reveal-up"><h3>No actions yet</h3><p>Confirmed agent actions will appear here.</p><Link href="/explore" className="pill sm">Browse agents</Link></div> : <section className="panel reveal-up" aria-labelledby="feed" id="live">
      <div className="panel-head"><div><h2 id="feed">Network feed <span className="count">{shown.length}</span></h2><p>Each row opens the agent. Tickers open the coin; hashes open the explorer.</p></div>
        {data?.partial && <Link href="/explore" className="chip red">Partial · some agents unreadable</Link>}</div>
      {data?.partial && <p className="notice warn" style={{ marginBottom: 12 }}>Some agents could not be read; their actions are missing from this view.</p>}
      {!shown.length ? <div className="empty"><h3>Nothing in this filter</h3><p>{emptyCopy[filter]}</p><button type="button" className="pill sm" onClick={() => pick("all")}>Show everything</button></div>
      : <div className="list" aria-live={live ? "polite" : "off"} aria-relevant="additions">{shown.map((a, index) => {
        const child = a.childMarket, trade = a.kind === 2 || a.kind === 3, category = categoryOf(a.kind), tx = txUrl(a.transactionHash);
        const age = blockAge(a.blockNumber, head, secondsPerBlock, clock.now);
        const agentHref = `/agents/${a.agent.address}`, tokenHref = child ? `/tokens/${child.address}` : null;
        return <a className="list-row reveal-up" style={stagger(index)} key={`${a.agent.address}-${a.nonce}`} href={agentHref} onClick={e => go(e, agentHref)} aria-label={`${a.agent.name}: ${kinds[a.kind] ?? "verified work"}`}>
          <span className="glyph" aria-hidden="true"><img src={statueFor(a.agent.address)} alt="" loading="lazy" decoding="async" /></span>
          <div className="info">
            <div className="row" style={{ gap: 8 }}>
              <strong>{a.agent.name}</strong>
              <span className={`chip ${category === "launch" ? "bronze" : category === "trade" ? (a.kind === 2 ? "green" : "red") : category === "proof" ? "purple" : "dark"}`}>{category === "launch" ? "Launch" : category === "trade" ? (a.kind === 2 ? "Buy" : "Sell") : category === "proof" ? "Proof" : "Activation"}</span>
              <span className="muted">{kinds[a.kind] ?? "Verified work"}</span>
              {tokenHref && child && a.kind !== 0 && <button type="button" className="tap" onClick={e => go(e, tokenHref)} title={`Open $${child.symbol}`}>${child.symbol}{child.graduated ? " · graduated" : ""}</button>}
            </div>
            {trade && child && <p className="num" style={{ color: "var(--ink)" }}>{amount(a.amount, a.kind === 2 ? child.quoteDecimals : child.decimals)} {a.kind === 2 ? a.agent.symbol : child.symbol} → {amount(a.result, a.kind === 2 ? child.decimals : child.quoteDecimals)} {a.kind === 2 ? child.symbol : a.agent.symbol}</p>}
            <p className="dim">
              <button type="button" className="tap" onClick={e => go(e, `${agentHref}#runtime`)} title="Open the agent's runtime">Action #{a.nonce}</button>
              {" · "}{explorer ? <button type="button" className="tap num" onClick={e => open(e, `${explorer}/block/${a.blockNumber}`)} title="Open the block in the explorer">Block {a.blockNumber}</button> : <span className="num">Block {a.blockNumber}</span>}
              {age && <> · <span className="num" title={secondsPerBlock == null ? "Measured in blocks until the chain's block time is known" : `≈ ${secondsPerBlock.toFixed(2)}s per block`}>{age}</span></>}
              {" · "}<span className="num">{amount(a.workReward, 18, 6)} {deployment?.operatingSymbol}</span> to operator{" "}
              <button type="button" className="tap mono" style={{ textTransform: "none", letterSpacing: 0, fontSize: ".78rem" }} onClick={e => { e.preventDefault(); e.stopPropagation(); void navigator.clipboard?.writeText(a.beneficiary).then(() => play("confirm")).catch(() => {}); }} title={`Copy ${a.beneficiary}`} aria-label={`Copy operator address ${a.beneficiary}`}>{shortAddress(a.beneficiary)}</button>
              {explorer && <button type="button" className="tap" onClick={e => open(e, `${explorer}/address/${a.beneficiary}`)} title="Open operator in explorer" aria-label="Open operator in explorer">↗</button>}
            </p>
          </div>
          {tx ? <button type="button" className="pill sm" onClick={e => open(e, tx)} title={a.transactionHash}>Receipt <ExternalLink size={14} /></button>
            : <button type="button" className="hash tap" onClick={e => { e.preventDefault(); e.stopPropagation(); void navigator.clipboard?.writeText(a.transactionHash).then(() => play("confirm")).catch(() => {}); }} title={`Copy ${a.transactionHash}`} aria-label={`Copy transaction hash ${a.transactionHash}`}>{shortAddress(a.transactionHash)}</button>}
        </a>; })}</div>}
      <p className="dim" style={{ marginTop: 12 }}>Scanned <span className="num">{data?.agentsScanned}</span> of <span className="num">{data?.agentsTotal}</span> agents · up to 100 actions · {live ? "refreshes every 15 seconds" : "auto-refresh paused"}.</p></section>}
  </main>;
}
