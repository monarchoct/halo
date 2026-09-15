"use client";
import { useEffect, useState } from "react";
import { createPublicClient, http, parseEther, formatUnits, type Abi, type Address } from "viem";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useProtocol } from "./protocol-provider";
import { type Market, shortAddress } from "@/lib/halo-types";
import routerAbi from "@/lib/generated/NativeBuyRouter.json";
import tokenAbi from "@/lib/generated/HaloToken.json";

type Quote = { input: string; token: Address; router: Address; time: number; output: bigint; assets: Address[]; symbols: string[]; decimals: number[]; refunds: bigint[] };
export function NativePurchase({ token, refresh }: { token: Market; refresh: () => void }) {
  const { deployment, address, openWallet, submit, transaction } = useProtocol();
  const [input, setInput] = useState("");
  const [quote, setQuote] = useState<Quote | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const busy = transaction?.state === "approval" || transaction?.state === "pending";
  const router = deployment?.nativeBuyRouter;
  useEffect(() => {
    let cancelled = false;
    setQuote(null); setError(""); setLoading(false);
    if (!input || !router || !deployment) return;
    setLoading(true);
    const timer = setTimeout(async () => {
      try {
        const value = parseEther(input);
        if (value <= 0n) throw new Error("Enter an ETH amount greater than zero.");
        const client = createPublicClient({ transport: http(deployment.rpcUrl) });
        const { result } = await client.simulateContract({ address: router, abi: routerAbi as Abi, functionName: "quote", args: [token.address, value] });
        const [assets, outputs, refunds] = result as [Address[], bigint[], bigint[]];
        const metadata = await Promise.all(assets.map(async asset => Promise.all([
          client.readContract({ address: asset, abi: tokenAbi as Abi, functionName: "symbol" }) as Promise<string>,
          client.readContract({ address: asset, abi: tokenAbi as Abi, functionName: "decimals" }) as Promise<number>,
        ])));
        if (!cancelled) setQuote({ input, token: token.address, router, time: Date.now(), output: outputs.at(-1)!, assets, symbols: metadata.map(m => m[0]), decimals: metadata.map(m => m[1]), refunds });
      } catch (e) { if (!cancelled) setError((e as Error).message.split("\n")[0]); }
      finally { if (!cancelled) setLoading(false); }
    }, 350);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [input, router, deployment, token.address]);
  async function buy() {
    if (!address) { openWallet(); return; }
    try {
      if (!quote || !deployment || !router || quote.input !== input || quote.token !== token.address || quote.router !== router || Date.now() - quote.time > 30000) throw new Error("Quote expired. Change the amount to refresh it.");
      const minimum = quote.output * 99n / 100n;
      if (minimum === 0n) throw new Error("Amount is too small to trade safely.");
      const client = createPublicClient({ transport: http(deployment.rpcUrl) });
      const block = await client.getBlock();
      await submit(router, routerAbi as Abi, "buy", [token.address, minimum, block.timestamp + 120n], `Buy ${token.symbol} with ETH`, parseEther(input));
      setInput(""); setQuote(null); refresh();
    } catch (e) { setError((e as Error).message.split("\n")[0]); }
  }
  return <div><h2>Buy with ETH</h2><p>One transaction. Parent-token swaps happen automatically.</p>
    <label htmlFor="native-amount">You pay · ETH</label>
    <Input id="native-amount" inputMode="decimal" placeholder="0.00" value={input} disabled={busy} onChange={e => setInput(e.target.value)} />
    <div className="trade-details"><div><span>Estimated received</span><strong>{loading ? "Quoting…" : quote ? Number(formatUnits(quote.output, token.decimals)).toLocaleString(undefined, { maximumSignificantDigits: 8 }) : "—"} {token.symbol}</strong></div>
      <div><span>Slippage limit</span><span>1% total route</span></div></div>
    {quote && <><p aria-label="Purchase route">ETH → {quote.symbols.join(" → ")}</p><p className="warning-copy">Pool and curve fees are included in the estimate. Network gas is additional.</p>
      {quote.refunds.map((refund, i) => refund > 0n && <p key={quote.assets[i]}>Estimated refund: {formatUnits(refund, quote.decimals[i])} {i === 0 ? "ETH" : quote.symbols[i]} <small>{shortAddress(quote.assets[i])}</small></p>)}</>}
    <p className="warning-copy">Unused parent tokens return to your wallet in their original currency.</p>
    <Button disabled={busy || !!address && (!quote || loading || quote.input !== input)} onClick={buy}>{address ? `Buy ${token.symbol} with ETH` : "Connect wallet"}</Button>
    {error && <p role="alert">{error}</p>}
  </div>;
}
