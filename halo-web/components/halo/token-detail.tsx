"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { createPublicClient, http, parseUnits, formatUnits, type Abi } from "viem";
import { Button } from "@/components/ui/button";
import { Field, FieldGroup, FieldLabel, FieldDescription } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useApi, useProtocol } from "./protocol-provider";
import { DataState } from "./data-state";
import { amount } from "./agent-profile";
import { shortAddress, type Market } from "@/lib/halo-types";
import curveAbi from "@/lib/generated/HaloCurve.json";
import tokenAbi from "@/lib/generated/HaloToken.json";
import { CoinChart } from "./coin-chart";
import { NativePurchase } from "./native-purchase";

export function TokenDetail({ id }: { id: string }) {
  const { data: token, loading, error, refresh } = useApi<Market>(`/v1/tokens/${id}`);
  const { deployment, address, openWallet, submit, transaction } = useProtocol();
  const [direction, setDirection] = useState("buy"), [input, setInput] = useState(""), [quote, setQuote] = useState<{ out: bigint; spent: bigint; fee: bigint; input: string; direction: string; time: number } | null>(null);
  const [tradeError, setTradeError] = useState(""), [quoting, setQuoting] = useState(false);
  const [payment, setPayment] = useState("eth");
  const busy = transaction?.state === "approval" || transaction?.state === "pending";
  useEffect(() => {
    let cancelled = false; setQuote(null); setTradeError("");
    if (!input || !token || !deployment || token.graduated) return;
    const timer = setTimeout(async () => {
      setQuoting(true);
      try {
        const value = parseUnits(input, direction === "buy" ? token.quoteDecimals : token.decimals);
        if (value <= 0n) throw new Error("Enter an amount greater than zero.");
        const client = createPublicClient({ transport: http(deployment.rpcUrl) });
        const result = await client.readContract({ address: token.curve, abi: curveAbi as Abi,
          functionName: direction === "buy" ? "quoteBuy" : "quoteSell", args: [value] }) as readonly bigint[];
        if (!cancelled) setQuote({ out: result[0], spent: direction === "buy" ? result[1] : value,
          fee: direction === "buy" ? result[2] : result[1], input, direction, time: Date.now() });
      } catch (error) { if (!cancelled) setTradeError((error as Error).message.split("\n")[0]); }
      finally { if (!cancelled) setQuoting(false); }
    }, 350);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [input, direction, token, deployment]);
  async function trade() {
    if (!address) { openWallet(); return; }
    if (!token || !deployment || !quote) return;
    try {
      setTradeError("");
      if (Date.now() - quote.time > 30000 || quote.input !== input || quote.direction !== direction) throw new Error("This quote expired. Edit the amount to request a new quote.");
      const value = parseUnits(input, direction === "buy" ? token.quoteDecimals : token.decimals);
      await submit(direction === "buy" ? token.quote : token.address, tokenAbi as Abi, "approve", [token.curve, value], "Approve this trade amount");
      const client = createPublicClient({ transport: http(deployment.rpcUrl) });
      const block = await client.getBlock();
      const minimum = quote.out * 99n / 100n;
      if (minimum === 0n) throw new Error("Amount is too small to trade safely.");
      await submit(token.curve, curveAbi as Abi, direction, [value, minimum, address, block.timestamp + 120n], `${direction === "buy" ? "Buy" : "Sell"} ${token.symbol}`);
      setInput(""); setQuote(null); refresh();
    } catch (error) { setTradeError((error as Error).message); }
  }
  if (!token) return <main id="main" className="wrap page-main"><DataState loading={loading} error={error} retry={refresh} /></main>;
  const progress = Math.min(100, Number(token.sold) / 8e26 * 100);
  return <main id="main" className="wrap page-main"><p className="eyebrow"><Link href="/explore">EXPLORE</Link> / {token.symbol}</p>
    <div className="page-heading"><div><h1>{token.name}<span className="lime">.</span></h1><p>${token.symbol} · Paired with ${token.quoteSymbol}</p></div></div>
    <CoinChart token={token} />
    <div className="token-layout"><section><dl className="metrics"><div className="metric"><dt>Curve allocation sold</dt><dd>{progress.toFixed(2)}%<small>{amount(token.sold)} tokens</small></dd></div>
      <div className="metric"><dt>Trading fee</dt><dd>{token.tradingFeeBps / 100}%<small>Fixed for this market</small></dd></div><div className="metric"><dt>Collected quote fees</dt><dd>{amount(token.totalFees, token.quoteDecimals)}<small>{token.quoteSymbol}</small></dd></div></dl>
      <div className="curve-progress" role="progressbar" aria-label="Curve allocation sold" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100}><div style={{ width: `${progress}%` }} /></div>
      <div className="section-topline"><h2>Market structure</h2></div><table className="details-table"><tbody><tr><th>Quote token</th><td>{token.quoteSymbol} · {shortAddress(token.quote)}</td></tr>
        <tr><th>Total supply</th><td>{amount(token.totalSupply, token.decimals, 0)}</td></tr><tr><th>Curve / liquidity allocation</th><td>80% / 20%</td></tr><tr><th>Graduation reserve target</th><td>{amount(token.target, token.quoteDecimals)} {token.quoteSymbol}</td></tr>
        <tr><th>Market state</th><td>{token.graduated ? "Graduated · permanently held liquidity" : progress === 100 ? "Migration pending · permissionless retry" : "Bonding curve"}</td></tr>
        <tr><th>Token contract</th><td><code>{token.address}</code></td></tr><tr><th>Curve contract</th><td><code>{token.curve}</code></td></tr></tbody></table>
      <p className="warning-copy">Buying this token with existing {token.quoteSymbol} spends that asset. It does not automatically buy HALO upstream, and the pairing does not guarantee appreciation.</p></section>
      <section className="trade-panel">{deployment?.nativeBuyRouter && <ToggleGroup type="single" value={payment} disabled={busy} onValueChange={value => { if (value) setPayment(value); }} variant="outline"><ToggleGroupItem value="eth">Pay ETH</ToggleGroupItem><ToggleGroupItem value="parent">Direct pair</ToggleGroupItem></ToggleGroup>}{deployment?.nativeBuyRouter && payment === "eth" ? <NativePurchase token={token} refresh={refresh} /> : <><h2>{token.graduated ? "Trade on Uniswap" : "Trade on the curve"}</h2>
        {token.graduated ? <><p>This token has graduated to its parent pair. Other pools may have different fees and liquidity.</p>
          {deployment?.environment !== "local" ? <Button asChild><a href={`https://app.uniswap.org/swap?chain=robinhood&inputCurrency=${token.quote}&outputCurrency=${token.address}`} target="_blank" rel="noreferrer">Open Uniswap</a></Button> : <p className="warning-copy">This is a local pool. External trading sites cannot access this development chain.</p>}</>
          : <><ToggleGroup type="single" disabled={busy} value={direction} onValueChange={value => { if (value) setDirection(value); }} variant="outline" className="full-width"><ToggleGroupItem value="buy">Buy</ToggleGroupItem><ToggleGroupItem value="sell">Sell</ToggleGroupItem></ToggleGroup>
            <FieldGroup><Field><FieldLabel htmlFor="trade-amount">You pay · {direction === "buy" ? token.quoteSymbol : token.symbol}</FieldLabel><Input id="trade-amount" disabled={busy} inputMode="decimal" placeholder="0.00" value={input} onChange={event => setInput(event.target.value)} /><FieldDescription>Exact input · 1% slippage limit</FieldDescription></Field></FieldGroup>
            <div className="trade-details"><div><span>Estimated received</span><strong>{quoting ? "Quoting…" : quote ? amount(quote.out.toString(), direction === "buy" ? token.decimals : token.quoteDecimals) : "—"} {direction === "buy" ? token.symbol : token.quoteSymbol}</strong></div>
              <div><span>Fee included</span><span>{quote ? formatUnits(quote.fee, token.quoteDecimals) : "—"} {token.quoteSymbol}</span></div></div>
            <Button disabled={busy || !!address && (!quote || quoting)} onClick={trade}>{address ? `${direction === "buy" ? "Buy" : "Sell"} ${token.symbol}` : "Connect wallet"}</Button></>}
        </>}{tradeError && <Alert variant="destructive" style={{ marginTop: 18 }}><AlertDescription>{tradeError}</AlertDescription></Alert>}
      </section></div></main>;
}

