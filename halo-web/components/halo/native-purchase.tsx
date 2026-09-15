"use client";
import Link from "next/link";
import { Fragment, useEffect, useRef, useState } from "react";
import { createPublicClient, http, parseEther, formatUnits, type Abi, type Address } from "viem";
import { useProtocol } from "./protocol-provider";
import { AddressTap } from "./market-card";
import type { Market } from "@/lib/halo-types";
import { countUp } from "@/lib/reveal";
import routerAbi from "@/lib/generated/NativeBuyRouter.json";
import tokenAbi from "@/lib/generated/HaloToken.json";

type Quote = { input: string; token: Address; router: Address; time: number; output: bigint; assets: Address[]; symbols: string[]; decimals: number[]; refunds: bigint[] };
const received = (n: number) => n.toLocaleString(undefined, { maximumSignificantDigits: 8 });

/** Animates a headline number towards `value` whenever it changes; the element keeps its rendered text without JS. */
function useCount(value: number | null, format: (n: number) => string, ms = 900) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => { if (ref.current && value !== null) return countUp(ref.current, value, ms, format); }, [value, format, ms]);
  return ref;
}

export function NativePurchase({ token, refresh }: { token: Market; refresh: () => void }) {
  const { deployment, address, openWallet, submit, transaction } = useProtocol();
  const [input, setInput] = useState(""), [quote, setQuote] = useState<Quote | null>(null), [quoteError, setQuoteError] = useState<{ input: string; message: string } | null>(null), [tradeError, setTradeError] = useState("");
  const busy = transaction?.state === "approval" || transaction?.state === "pending";
  const router = deployment?.nativeBuyRouter;
  const live = quote && quote.input === input && quote.token === token.address && quote.router === router ? quote : null;
  const liveError = quoteError?.input === input ? quoteError.message : "";
  const loading = !!input && !live && !liveError;
  useEffect(() => {
    if (!input || !router || !deployment) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const value = parseEther(input);
        if (value <= 0n) throw new Error("Enter an ETH amount greater than zero.");
        const client = createPublicClient({ transport: http(deployment.rpcUrl) });
        const { result } = await client.simulateContract({ address: router, abi: routerAbi as Abi, functionName: "quote", args: [token.address, value] });
        const [assets, outputs, refunds] = result as [Address[], bigint[], bigint[]];
        const metadata = await Promise.all(assets.map(async asset => Promise.all([client.readContract({ address: asset, abi: tokenAbi as Abi, functionName: "symbol" }) as Promise<string>, client.readContract({ address: asset, abi: tokenAbi as Abi, functionName: "decimals" }) as Promise<number>])));
        if (!cancelled) setQuote({ input, token: token.address, router, time: Date.now(), output: outputs.at(-1)!, assets, symbols: metadata.map(m => m[0]), decimals: metadata.map(m => m[1]), refunds });
      } catch (e) { if (!cancelled) setQuoteError({ input, message: (e as Error).message.split("\n")[0] }); }
    }, 350);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [input, router, deployment, token.address]);
  async function buy() {
    if (!address) { openWallet(); return; }
    try {
      if (!live || !deployment || !router || Date.now() - live.time > 30000) throw new Error("Quote expired. Change the amount to refresh it.");
      const minimum = live.output * 99n / 100n;
      if (minimum === 0n) throw new Error("Amount is too small to trade safely.");
      const block = await createPublicClient({ transport: http(deployment.rpcUrl) }).getBlock();
      await submit(router, routerAbi as Abi, "buy", [token.address, minimum, block.timestamp + 120n], `Buy ${token.symbol} with ETH`, parseEther(input));
      setInput(""); refresh();
    } catch (e) { setTradeError((e as Error).message.split("\n")[0]); }
  }
  const output = live ? Number(formatUnits(live.output, token.decimals)) : null;
  const outputRef = useCount(output, received, 700);
  const explorer = deployment?.explorerUrl;
  // Wrapped ETH and the root token have no curve page of their own; they open in the explorer instead.
  const isProtocolAsset = (asset: Address) => [deployment?.operatingToken, deployment?.rootHalo].some(a => a?.toLowerCase() === asset.toLowerCase());
  const hop = (asset: Address, symbol: string) => isProtocolAsset(asset)
    ? explorer ? <a className="chip bronze" href={`${explorer}/token/${asset}`} target="_blank" rel="noreferrer" title={`${symbol} in the explorer`}>{symbol}</a> : <span className="chip bronze">{symbol}</span>
    : <Link className="chip bronze" href={`/tokens/${asset}`} title={`Open the ${symbol} market`}>{symbol}</Link>;
  return <>
    <h3>Buy with ETH</h3><p>One transaction. Every parent token on the route is bought automatically.</p>
    <div className="amount field"><label htmlFor="native-amount">You pay · ETH</label><input id="native-amount" className="input num" inputMode="decimal" placeholder="0.00" value={input} disabled={busy} onChange={e => { setInput(e.target.value); setTradeError(""); }} /><small>1% total-route slippage limit · quote valid 30s</small></div>
    <div className="trade-details">
      <div><span>You receive</span><strong className="num">{loading ? "Quoting…" : output !== null ? <span ref={outputRef}>{received(output)}</span> : "—"} {token.symbol}</strong></div>
      <div><span>Route</span><span className="route row" style={{ gap: 4, justifyContent: "flex-end" }}>{live
        ? <><span className="chip">ETH</span>{live.assets.map((asset, i) => <Fragment key={asset}><span aria-hidden="true">→</span>{hop(asset, live.symbols[i])}</Fragment>)}</>
        : <><span className="chip">ETH</span><span aria-hidden="true">→</span><span className="chip">…</span><span aria-hidden="true">→</span><span className="chip bronze">{token.symbol}</span></>}</span></div>
      {live?.refunds.map((refund, i) => refund > 0n && <div key={live.assets[i]}><span>Refund</span><span className="num row" style={{ gap: 6, justifyContent: "flex-end" }}>{formatUnits(refund, live.decimals[i])} {i === 0 ? "ETH" : live.symbols[i]} <AddressTap address={live.assets[i]} explorerUrl={explorer} /></span></div>)}
    </div>
    <button type="button" className="pill primary lg" data-sfx="confirm" disabled={busy || (!!address && (!live || loading))} onClick={buy}>{address ? `Buy ${token.symbol} with ETH` : "Connect wallet"}</button>
    {(liveError || tradeError) && <p className="inline-error" role="alert">{tradeError || liveError}</p>}
    <p className="dim">Pool and curve fees are included in the estimate; network gas is extra. Unused parent tokens return to your wallet in their own currency.</p>
  </>;
}
