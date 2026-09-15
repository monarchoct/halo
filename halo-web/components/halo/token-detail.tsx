"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { createPublicClient, http, parseUnits, formatUnits, type Abi } from "viem";
import { ArrowUpRight, ExternalLink } from "lucide-react";
import { useApi, useProtocol } from "./protocol-provider";
import { DataState } from "./data-state";
import { CoinChart } from "./coin-chart";
import { NativePurchase } from "./native-purchase";
import type { Market } from "@/lib/halo-types";
import { amount, compact, curvePrice, curveProgress, fdvQuote, shortAddress } from "@/lib/format";
import curveAbi from "@/lib/generated/HaloCurve.json";
import tokenAbi from "@/lib/generated/HaloToken.json";

type Quote = { out: bigint; spent: bigint; fee: bigint; input: string; direction: string; time: number };

export function TokenDetail({ id }: { id: string }) {
  const { data: token, loading, error, refresh } = useApi<Market>(`/v1/tokens/${id}`);
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
  if (!token) return <main id="main" className="wrap page"><DataState loading={loading} error={error} retry={refresh} /></main>;
  const progress = curveProgress(token.sold), price = curvePrice(token.graduated ? "800000000000000000000000000" : token.sold, token.target);
  const isAgentToken = deployment && token.quote.toLowerCase() === deployment.rootHalo.toLowerCase();
  const explorer = deployment?.explorerUrl;
  return <main id="main" className="wrap page">
    <nav className="breadcrumb" aria-label="Breadcrumb"><Link href="/explore">Explore</Link><span>/</span><span>{deployment?.haloSymbol ?? "HALO"}</span>{!isAgentToken && <><span>/</span><span>{token.quoteSymbol}</span></>}<span>/</span><span>{token.symbol}</span></nav>
    <header className="market-head">
      <div className="avatar" aria-hidden="true">{token.symbol.slice(0, 2)}</div>
      <div className="title"><h1>{token.name}</h1>
        <div className="pair"><b>${token.symbol} / ${token.quoteSymbol}</b>{token.graduated ? <span className="chip orange">Graduated</span> : progress >= 100 ? <span className="chip orange">Migration pending</span> : <span className="chip purple">{progress.toFixed(1)}% of curve sold</span>}<span className="chip">{isAgentToken ? "Agent token" : "Child token"}</span></div>
        <div className="links dim"><span className="mono">Token {shortAddress(token.address)}</span><span className="mono">Curve {shortAddress(token.curve)}</span>{explorer && <a href={`${explorer}/token/${token.address}`} target="_blank" rel="noreferrer" className="row" style={{ gap: 4 }}>Explorer <ExternalLink size={12} /></a>}</div></div>
      <div className="market-actions">{isAgentToken ? <span className="dim">Quoted in {token.quoteSymbol}</span> : <Link href={`/explore`} className="pill">Parent ${token.quoteSymbol} <ArrowUpRight size={15} /></Link>}</div>
    </header>

    <dl className="metrics">
      <div className="metric"><dt>Price</dt><dd className="num">{compact(price)}<small>{token.quoteSymbol}</small></dd></div>
      <div className="metric"><dt>FDV</dt><dd className="num">{compact(fdvQuote(token))}<small>{token.quoteSymbol}</small></dd></div>
      <div className="metric"><dt>Curve sold</dt><dd className="num">{progress.toFixed(1)}%<small>{amount(token.sold, token.decimals, 0)} tokens</small></dd></div>
      <div className="metric"><dt>Trading fee</dt><dd>{token.tradingFeeBps / 100}%<small>fixed for this market</small></dd></div>
      <div className="metric"><dt>Fees collected</dt><dd className="num">{compact(Number(formatUnits(BigInt(token.totalFees), token.quoteDecimals)))}<small>{token.quoteSymbol}</small></dd></div>
    </dl>

    <div className="split">
      <aside className="panel sticky trade" aria-label="Trade">
        {deployment?.nativeBuyRouter && !token.graduated && <div className="seg" role="group" aria-label="Payment"><button type="button" aria-pressed={payment === "eth"} disabled={busy} onClick={() => setPayment("eth")}>Pay ETH</button><button type="button" aria-pressed={payment === "pair"} disabled={busy} onClick={() => setPayment("pair")}>Pay {token.quoteSymbol}</button></div>}
        {deployment?.nativeBuyRouter && payment === "eth" && !token.graduated ? <NativePurchase token={token} refresh={refresh} /> : token.graduated ? <>
          <h3>Trade on Uniswap</h3><p>This token graduated to its ${token.quoteSymbol} pair. Its liquidity principal is locked forever; other pools may differ in fees and depth.</p>
          {deployment?.environment !== "local" ? <a className="pill primary" href={`https://app.uniswap.org/swap?chain=robinhood&inputCurrency=${token.quote}&outputCurrency=${token.address}`} target="_blank" rel="noreferrer">Open Uniswap <ExternalLink size={15} /></a> : <p className="notice">Local pool. External trading sites cannot reach this development chain.</p>}
        </> : <>
          <div className="seg" role="group" aria-label="Direction"><button type="button" aria-pressed={direction === "buy"} disabled={busy} onClick={() => setDirection("buy")}>Buy</button><button type="button" aria-pressed={direction === "sell"} disabled={busy} onClick={() => setDirection("sell")}>Sell</button></div>
          <div className="amount field"><label htmlFor="trade-amount">You pay · {direction === "buy" ? token.quoteSymbol : token.symbol}</label><input id="trade-amount" className="input" disabled={busy} inputMode="decimal" placeholder="0.00" value={input} onChange={e => setInput(e.target.value)} /><small>Exact input · 1% slippage limit · quote valid 30s</small></div>
          <div className="trade-details"><div><span>You receive</span><strong className="num">{quoting ? "Quoting…" : liveQuote ? amount(liveQuote.out.toString(), direction === "buy" ? token.decimals : token.quoteDecimals) : "—"} {direction === "buy" ? token.symbol : token.quoteSymbol}</strong></div>
            <div><span>Fee included</span><span className="num">{liveQuote ? formatUnits(liveQuote.fee, token.quoteDecimals) : "—"} {token.quoteSymbol}</span></div></div>
          <button type="button" className="pill primary lg" disabled={busy || (!!address && (!liveQuote || quoting))} onClick={trade}>{address ? `${direction === "buy" ? "Buy" : "Sell"} ${token.symbol}` : "Connect wallet"}</button>
          {(liveError || tradeError) && <p className="inline-error" role="alert">{tradeError || liveError}</p>}
        </>}
        <p className="dim">Buying with existing {token.quoteSymbol} spends that asset. Only a routed purchase creates upstream buys. Pairing does not guarantee appreciation.</p>
      </aside>
      <div className="stack">
        <div className="panel"><CoinChart token={token} /></div>
        <div className="panel"><div className="panel-head"><h2>Market structure</h2></div><table className="table kv"><tbody>
          <tr><th>Quote token</th><td>{token.quoteSymbol} · <code>{shortAddress(token.quote)}</code></td></tr><tr><th>Total supply</th><td>{amount(token.totalSupply, token.decimals, 0)}</td></tr>
          <tr><th>Curve / liquidity allocation</th><td>80% / 20%</td></tr><tr><th>Graduation target</th><td>{amount(token.target, token.quoteDecimals)} {token.quoteSymbol} in reserves</td></tr>
          <tr><th>Market state</th><td>{token.graduated ? "Graduated · permanently held liquidity" : progress >= 100 ? "Migration pending · anyone can retry" : "Bonding curve"}</td></tr>
          <tr><th>Fee splitter</th><td><code>{token.feeSplitter}</code></td></tr><tr><th>Token contract</th><td><code>{token.address}</code></td></tr><tr><th>Curve contract</th><td><code>{token.curve}</code></td></tr>
          {token.graduated && <tr><th>Liquidity vault</th><td><code>{token.liquidityVault}</code></td></tr>}
        </tbody></table></div>
      </div>
    </div>
  </main>;
}
