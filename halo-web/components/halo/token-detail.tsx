"use client";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPublicClient, http, parseUnits, formatUnits, type Abi } from "viem";
import { ArrowUpRight, ExternalLink, RefreshCw } from "lucide-react";
import { useApi, useProtocol } from "./protocol-provider";
import { DataState } from "./data-state";
import { CoinChart } from "./coin-chart";
import { NativePurchase } from "./native-purchase";
import { AddressTap, Art } from "./market-card";
import { CycleRing } from "./cycle-ring";
import type { Agent, Market } from "@/lib/halo-types";
import { amount, compact, curvePrice, curveProgress, fdvQuote } from "@/lib/format";
import { countUp } from "@/lib/reveal";
import curveAbi from "@/lib/generated/HaloCurve.json";
import tokenAbi from "@/lib/generated/HaloToken.json";

type Quote = { out: bigint; spent: bigint; fee: bigint; input: string; direction: string; time: number };
const percent = (n: number) => `${n.toFixed(1)}%`;
const feePercent = (n: number) => `${(Math.round(n * 100) / 100).toLocaleString("en-US")}%`;
const received = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 3 });

/** Animates a headline number towards `value` whenever it changes; the element keeps its rendered text without JS. */
function useCount(value: number | null, format: (n: number) => string, ms = 900) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => { if (ref.current && value !== null) return countUp(ref.current, value, ms, format); }, [value, format, ms]);
  return ref;
}

export function TokenDetail({ id }: { id: string }) {
  const { data: token, loading, error, refresh } = useApi<Market>(`/v1/tokens/${id}`);
  // The token payload carries no parent; the board's first page resolves the launching agent for the breadcrumb and links.
  const { data: board } = useApi<{ agents: Agent[]; total: number }>("/v1/agents?offset=0&limit=20");
  const { deployment, address, openWallet, submit, transaction } = useProtocol();
  const [direction, setDirection] = useState<"buy" | "sell">("buy"), [input, setInput] = useState("");
  const [quote, setQuote] = useState<Quote | null>(null), [quoteError, setQuoteError] = useState<{ input: string; message: string } | null>(null);
  const [tradeError, setTradeError] = useState(""), [payment, setPayment] = useState<"eth" | "pair">("eth");
  const busy = transaction?.state === "approval" || transaction?.state === "pending";
  // A quote is only meaningful for the exact input it was requested for; stale ones are simply not shown.
  const liveQuote = quote && quote.input === input && quote.direction === direction ? quote : null;
  const liveError = quoteError && quoteError.input === input ? quoteError.message : "";
  const quoting = !!input && !liveQuote && !liveError && !!token && !token.graduated;
  useEffect(() => {
    if (!input || !token || !deployment || token.graduated) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const value = parseUnits(input, direction === "buy" ? token.quoteDecimals : token.decimals);
        if (value <= 0n) throw new Error("Enter an amount greater than zero.");
        const client = createPublicClient({ transport: http(deployment.rpcUrl) });
        const result = await client.readContract({ address: token.curve, abi: curveAbi as Abi, functionName: direction === "buy" ? "quoteBuy" : "quoteSell", args: [value] }) as readonly bigint[];
        if (!cancelled) setQuote({ out: result[0], spent: direction === "buy" ? result[1] : value, fee: direction === "buy" ? result[2] : result[1], input, direction, time: Date.now() });
      } catch (e) { if (!cancelled) setQuoteError({ input, message: (e as Error).message.split("\n")[0] }); }
    }, 350);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [input, direction, token, deployment]);
  async function trade() {
    if (!address) { openWallet(); return; }
    if (!token || !deployment || !liveQuote) return;
    try {
      setTradeError("");
      if (Date.now() - liveQuote.time > 30000) throw new Error("This quote expired. Edit the amount to request a new one.");
      const value = parseUnits(input, direction === "buy" ? token.quoteDecimals : token.decimals);
      await submit(direction === "buy" ? token.quote : token.address, tokenAbi as Abi, "approve", [token.curve, value], "Approve this trade amount");
      const block = await createPublicClient({ transport: http(deployment.rpcUrl) }).getBlock();
      const minimum = liveQuote.out * 99n / 100n;
      if (minimum === 0n) throw new Error("Amount is too small to trade safely.");
      await submit(token.curve, curveAbi as Abi, direction, [value, minimum, address, block.timestamp + 120n], `${direction === "buy" ? "Buy" : "Sell"} ${token.symbol}`);
      setInput(""); refresh();
    } catch (e) { setTradeError((e as Error).message); }
  }
  const isAgentToken = !!token && !!deployment && token.quote.toLowerCase() === deployment.rootHalo.toLowerCase();
  const agent = useMemo(() => {
    if (!token || !board) return null;
    const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
    return board.agents.find(a => same(a.agentToken, token.address) || a.children.some(c => same(c.address, token.address)))
      ?? board.agents.find(a => same(a.agentToken, token.quote)) ?? null;
  }, [token, board]);
  const progress = token ? (token.graduated ? 100 : curveProgress(token.sold)) : 0;
  const price = token ? curvePrice(token.graduated ? "800000000000000000000000000" : token.sold, token.target) : null;
  const fdv = token ? fdvQuote(token) : null;
  const fees = token ? Number(formatUnits(BigInt(token.totalFees), token.quoteDecimals)) : null;
  const priceRef = useCount(price, compact), fdvRef = useCount(fdv, compact), soldRef = useCount(token ? progress : null, percent);
  const feeRef = useCount(token ? token.tradingFeeBps / 100 : null, feePercent), collectedRef = useCount(fees, compact);
  const receive = liveQuote && token ? Number(formatUnits(liveQuote.out, direction === "buy" ? token.decimals : token.quoteDecimals)) : null;
  const receiveRef = useCount(receive, received, 700);
  if (!token) return <main id="main" className="wrap page"><DataState loading={loading} error={error} retry={refresh} /></main>;
  const explorer = deployment?.explorerUrl;
  const halo = deployment?.haloSymbol ?? token.quoteSymbol;
  const agentHref = agent ? `/agents/${agent.address}` : "/explore";
  const quoteHref = isAgentToken ? "/explore" : `/tokens/${token.quote}`;
  const live = !!agent?.active && !token.graduated;
  const stateChip = token.graduated ? <Link href={`/explore?view=${isAgentToken ? "agents" : "coins"}#graduated`} className="chip orange" title="Show graduated markets">Graduated</Link>
    : progress >= 100 ? <Link href="#structure" className="chip orange">Migration pending</Link>
    : <Link href="#structure" className="chip purple num" title="How the curve works">{progress.toFixed(1)}% of curve sold</Link>;
  return <main id="main" className="wrap page">
    <nav className="breadcrumb reveal-up" aria-label="Breadcrumb"><Link href="/explore">Explore</Link><span>/</span>
      {agent ? <Link href={agentHref}>{agent.name}</Link> : <span>{halo}</span>}
      {!isAgentToken && <><span>/</span><Link href={quoteHref}>${token.quoteSymbol}</Link></>}<span>/</span><span aria-current="page">${token.symbol}</span></nav>
    <header className="market-head reveal-up">
      <Link href={agentHref} className="avatar" aria-label={agent ? `Open ${agent.name}` : "Open the board"}><Art seed={isAgentToken ? (agent?.address ?? token.address) : token.address} symbol={token.symbol} kind={isAgentToken ? "agent" : "coin"} /></Link>
      <div className="title"><h1>{agent ? <Link href={agentHref} className="tap" title={isAgentToken ? "Open the agent" : `Launched by ${agent.name}`}>{token.name}</Link> : token.name}</h1>
        <div className="pair"><b>${token.symbol} / <Link href={quoteHref} className="tap" title={isAgentToken ? "Open the board" : `Open the $${token.quoteSymbol} market`}>${token.quoteSymbol}</Link></b>
          {stateChip}
          {isAgentToken ? <Link href={agentHref} className="chip" title="This token funds an agent">Agent token</Link> : <Link href={agentHref} className="chip bronze" title={agent ? `Launched by ${agent.name}` : "Launched by an agent"}>Child of {agent?.symbol ?? token.quoteSymbol}</Link>}
          {live && <Link href={`${agentHref}#runtime`} className="chip green live" title={`Cycle ${Number(agent!.nonce)} · agent live`}><i aria-hidden="true" />Live · cycle {Number(agent!.nonce)}</Link>}
          {agent && Number(agent.childCount) > 0 && <Link href={`/explore?view=coins&parent=${agent.address}`} className="chip" title={`Coins launched by ${agent.name}`}>{agent.childCount} {Number(agent.childCount) === 1 ? "coin" : "coins"}</Link>}</div>
        <div className="links"><span className="mono">Token <AddressTap address={token.address} explorerUrl={explorer} /></span><span className="mono">Curve <AddressTap address={token.curve} explorerUrl={explorer} /></span>{explorer && <a href={`${explorer}/token/${token.address}`} target="_blank" rel="noreferrer" className="mono tap">Explorer <ExternalLink size={11} /></a>}</div>
        <Link href="#structure" className="curve" aria-label={`${progress.toFixed(1)}% of the curve sold`} title="Curve progress"><span className="progress"><i style={{ "--w": `${progress}%` } as React.CSSProperties} /></span><span className="pct num">{progress.toFixed(0)}%</span></Link></div>
      <div className="market-actions">
        <Link href={agent ? `${agentHref}#runtime` : "#structure"} className="ring lg" title={agent ? `Cycle ${Number(agent.nonce)} · ${progress.toFixed(0)}% of the curve` : `${progress.toFixed(0)}% of the curve`}><CycleRing pct={progress} live={live} size={96} /></Link>
        <div className="stack" style={{ gap: 8 }}>
          {agent && <Link href={agentHref} className="pill">{isAgentToken ? "Open agent" : `Agent ${agent.name}`} <ArrowUpRight size={15} className="arrow" /></Link>}
          <Link href={quoteHref} className="pill">{isAgentToken ? `Quoted in ${token.quoteSymbol}` : `Parent $${token.quoteSymbol}`} <ArrowUpRight size={15} className="arrow" /></Link>
          <button type="button" className="pill ghost sm" onClick={refresh} title="Refresh chain data"><RefreshCw size={14} /> Refresh</button>
        </div>
      </div>
    </header>

    <div className="metrics">
      <Link href="#chart" className="metric reveal-up" style={{ "--i": 0 } as React.CSSProperties} title="Open the price chart"><dt>Price</dt><dd className="num"><span ref={priceRef}>{compact(price ?? 0)}</span><small>{token.quoteSymbol}</small></dd></Link>
      <Link href="#chart" className="metric reveal-up" style={{ "--i": 1 } as React.CSSProperties} title="Open the price chart"><dt>FDV</dt><dd className="num"><span ref={fdvRef}>{compact(fdv ?? 0)}</span><small>{token.quoteSymbol}</small></dd></Link>
      <Link href="#structure" className="metric reveal-up" style={{ "--i": 2 } as React.CSSProperties} title="See the market structure"><dt>Curve sold</dt><dd className="num"><span ref={soldRef}>{percent(progress)}</span><small>{amount(token.sold, token.decimals, 0)} tokens</small></dd></Link>
      <Link href="#structure" className="metric reveal-up" style={{ "--i": 3 } as React.CSSProperties} title="Fees are fixed for this market"><dt>Trading fee</dt><dd className="num"><span ref={feeRef}>{feePercent(token.tradingFeeBps / 100)}</span><small>fixed for this market</small></dd></Link>
      {agent ? <Link href={`${agentHref}#treasury`} className="metric reveal-up" style={{ "--i": 4 } as React.CSSProperties} title="Open the agent treasury"><dt>Fees collected</dt><dd className="num"><span ref={collectedRef}>{compact(fees ?? 0)}</span><small>{token.quoteSymbol}</small></dd></Link>
        : <a href={explorer ? `${explorer}/address/${token.feeSplitter}` : "#structure"} target={explorer ? "_blank" : undefined} rel={explorer ? "noreferrer" : undefined} className="metric reveal-up" style={{ "--i": 4 } as React.CSSProperties} title="Open the fee splitter"><dt>Fees collected</dt><dd className="num"><span ref={collectedRef}>{compact(fees ?? 0)}</span><small>{token.quoteSymbol}</small></dd></a>}
    </div>

    <div className="split">
      <aside className="panel sticky trade reveal-up" id="buy" aria-label="Trade">
        {deployment?.nativeBuyRouter && !token.graduated && <div className="seg" role="group" aria-label="Payment"><button type="button" aria-pressed={payment === "eth"} disabled={busy} onClick={() => setPayment("eth")}>Pay ETH</button><button type="button" aria-pressed={payment === "pair"} disabled={busy} onClick={() => setPayment("pair")}>Pay {token.quoteSymbol}</button></div>}
        {deployment?.nativeBuyRouter && payment === "eth" && !token.graduated ? <NativePurchase token={token} refresh={refresh} /> : token.graduated ? <>
          <h3>Trade on Uniswap</h3><p>This token graduated to its <Link href={quoteHref} className="tap">${token.quoteSymbol}</Link> pair. Its liquidity principal is locked forever; other pools may differ in fees and depth.</p>
          {deployment?.environment !== "local" ? <a className="pill primary lg" href={`https://app.uniswap.org/swap?chain=robinhood&inputCurrency=${token.quote}&outputCurrency=${token.address}`} target="_blank" rel="noreferrer">Open Uniswap <ExternalLink size={15} /></a> : <p className="notice">Local pool. External trading sites cannot reach this development chain.</p>}
        </> : <>
          <div className="seg" role="group" aria-label="Direction"><button type="button" aria-pressed={direction === "buy"} disabled={busy} onClick={() => setDirection("buy")}>Buy</button><button type="button" aria-pressed={direction === "sell"} disabled={busy} onClick={() => setDirection("sell")}>Sell</button></div>
          <div className="amount field"><label htmlFor="trade-amount">You pay · {direction === "buy" ? token.quoteSymbol : token.symbol}</label><input id="trade-amount" className="input num" disabled={busy} inputMode="decimal" placeholder="0.00" value={input} onChange={e => setInput(e.target.value)} /><small>Exact input · 1% slippage limit · quote valid 30s</small></div>
          <div className="trade-details"><div><span>You receive</span><strong className="num">{quoting ? "Quoting…" : receive !== null ? <span ref={receiveRef}>{received(receive)}</span> : "—"} {direction === "buy" ? token.symbol : token.quoteSymbol}</strong></div>
            <div><Link href="#structure" className="tap" title="Fees are fixed for this market">Fee included</Link><span className="num">{liveQuote ? formatUnits(liveQuote.fee, token.quoteDecimals) : "—"} {token.quoteSymbol}</span></div>
            <div><span>Route</span><span className="route row" style={{ gap: 4, justifyContent: "flex-end" }}><Link href={quoteHref} className="chip bronze">{token.quoteSymbol}</Link><span aria-hidden="true">{direction === "buy" ? "→" : "←"}</span><span className="chip bronze">{token.symbol}</span></span></div></div>
          <button type="button" className="pill primary lg" data-sfx="confirm" disabled={busy || (!!address && (!liveQuote || quoting))} onClick={trade}>{address ? `${direction === "buy" ? "Buy" : "Sell"} ${token.symbol} with ${direction === "buy" ? token.quoteSymbol : token.symbol}` : "Connect wallet"}</button>
          {(liveError || tradeError) && <p className="inline-error" role="alert">{tradeError || liveError}</p>}
        </>}
        <p className="dim">Buying with existing {token.quoteSymbol} spends that asset. Only a routed purchase creates upstream buys. Pairing does not guarantee appreciation.</p>
      </aside>
      <div className="stack">
        <div className="panel reveal-up"><CoinChart token={token} /></div>
        <div className="panel reveal-up" id="structure"><div className="panel-head"><div><h2>Market structure</h2><p>Every address below copies on tap and opens in the explorer.</p></div>{agent && <Link href={`${agentHref}#children`} className="pill sm">All {agent.name} markets <ArrowUpRight size={14} className="arrow" /></Link>}</div>
          <div className="table-scroll"><table className="table kv"><tbody>
            <tr><th>Quote token</th><td><span className="row" style={{ gap: 8 }}><Link href={quoteHref} className="tap">${token.quoteSymbol}</Link><AddressTap address={token.quote} explorerUrl={explorer} /></span></td></tr>
            <tr><th>Total supply</th><td className="num">{amount(token.totalSupply, token.decimals, 0)} <Link href="#chart" className="tap dim" title="FDV = price × total supply">used for FDV</Link></td></tr>
            <tr><th>Curve / liquidity allocation</th><td>80% / 20%</td></tr>
            <tr><th>Graduation target</th><td className="num">{amount(token.target, token.quoteDecimals)} {token.quoteSymbol} in reserves</td></tr>
            <tr><th>Market state</th><td>{token.graduated ? <Link href={`/explore?view=${isAgentToken ? "agents" : "coins"}#graduated`} className="tap">Graduated · permanently held liquidity</Link> : progress >= 100 ? "Migration pending · anyone can retry" : <Link href="#chart" className="tap">Bonding curve · {progress.toFixed(1)}% sold</Link>}</td></tr>
            {agent && <tr><th>Launched by</th><td><span className="row" style={{ gap: 8 }}><Link href={agentHref} className="tap">{agent.name}</Link><AddressTap address={agent.address} explorerUrl={explorer} /></span></td></tr>}
            <tr><th>Fee splitter</th><td><AddressTap address={token.feeSplitter} explorerUrl={explorer} /></td></tr>
            <tr><th>Token contract</th><td><AddressTap address={token.address} explorerUrl={explorer} /></td></tr>
            <tr><th>Curve contract</th><td><AddressTap address={token.curve} explorerUrl={explorer} /></td></tr>
            {token.graduated && <tr><th>Liquidity vault</th><td><AddressTap address={token.liquidityVault} explorerUrl={explorer} /></td></tr>}
          </tbody></table></div></div>
      </div>
    </div>
  </main>;
}
