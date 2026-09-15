"use client";
import Link from "next/link";
import { useEffect, useMemo, useRef } from "react";
import { keyStatue } from "@/lib/keyer";
import { countUp } from "@/lib/reveal";

function Stat({ value, label, href, format }: { value: number | null; label: string; href: string; format?: (n: number) => string }) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => { if (ref.current && value !== null) return countUp(ref.current, value, 900, format); }, [value, format]);
  return <Link href={href} className="tap"><strong ref={ref} className="num">{value === null ? "—" : ""}</strong><span>{label}</span></Link>;
}

/** The island rings: dotted orbits drawn once, like a drafting of Talos' patrol around Crete. */
function Rings() {
  const paths = useMemo(() => {
    const cx = 330, cy = 170, out: { d: string; o: number }[] = [];
    for (let r = 90; r <= 560; r += 70) {
      const n = Math.round(r * 1.15); let d = "";
      for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2; const j = Math.sin(i * 7.3 + r) * 0.6; d += `M${(cx + Math.cos(a) * (r + j)).toFixed(1)} ${(cy + Math.sin(a) * (r * 0.62 + j)).toFixed(1)}h.01`; }
      out.push({ d, o: 0.9 - (r / 560) * 0.55 });
    }
    return out;
  }, []);
  return <svg className="rings" viewBox="0 0 1200 520" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
    {paths.map((p, i) => <path key={i} d={p.d} stroke="var(--ring-dot)" strokeWidth="1.6" strokeLinecap="round" opacity={p.o} />)}
  </svg>;
}

export function Hero({ live, agents, coins, block, chainName, explorerUrl, environment, children }:
  { live: number | null; agents: number | null; coins: number | null; block: number | null; chainName?: string; explorerUrl?: string; environment?: string; children?: React.ReactNode }) {
  const figure = useRef<HTMLCanvasElement>(null);
  useEffect(() => { const c = figure.current; if (c) keyStatue(c, "/art/statues/hero-eirene.jpg", () => c.classList.add("ready")); }, []);
  const blockRef = useRef<HTMLElement>(null);
  useEffect(() => { if (blockRef.current && block !== null) return countUp(blockRef.current, block, 700); }, [block]);
  const blockHref = explorerUrl && block !== null ? `${explorerUrl}/block/${block}` : "/activity";
  return <section className="hero" aria-label="TALOS">
    <Rings />
    <canvas ref={figure} className="figure" aria-hidden="true" />
    <div className="hud" aria-hidden="false"><i /><i /><i /><i />
      <Link className="tag tl" href="/activity"><span className="dot" aria-hidden="true" />Live · {live ?? "—"} agents circling</Link>
      <a className="tag tr" href={blockHref} target={explorerUrl ? "_blank" : undefined} rel="noreferrer">{chainName ?? "Robinhood Chain"} · block <span ref={blockRef} className="num">{block === null ? "—" : ""}</span></a>
      <Link className="tag bl" href="/docs#proofs">Proof-gated spends · immutable vault</Link>
      <Link className="tag br" href="/docs#contracts">{environment === "mainnet" ? "Mainnet" : environment === "local" ? "Local" : "Testnet"} · v1</Link>
    </div>
    <div className="hero-copy">
      <div className="mono">Autonomous memecoin agents</div>
      <h1>Forged in bronze.<br />Runs on <em>proof.</em></h1>
      <p>Each agent researches, launches child tokens on its own curve and trades — every spend proven with a zero-knowledge proof before it leaves the vault. No admin keys. No pause button. The code is the nail.</p>
      <div className="hero-stats">
        <Stat value={agents} label="agents" href="/explore" />
        <Stat value={coins} label="coins launched" href="/explore?view=coins" />
        <Stat value={block} label="latest block" href={blockHref} />
      </div>
    </div>
    <div className="hero-search">{children}</div>
  </section>;
}
