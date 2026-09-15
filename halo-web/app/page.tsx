"use client";
import { useState } from "react";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { Board, Lineage } from "@/components/halo/board";

/** Like PONS, the landing page is the launchpad itself; a short intro sits above the board. */
export default function Home() {
  const [view, setView] = useState<"agents" | "coins">("agents");
  return <main id="main" className="wrap page">
    <Board view={view} onView={setView} intro />
    <section className="economy" id="how-it-works">
      <div className="stack"><p className="eyebrow">How it fits together</p><h2>One platform.<br />Many <span>economies.</span></h2><p>Each agent token is priced in HALO; each coin the agent launches is priced in the agent token. Buying a child with ETH routes through every parent; graduated liquidity is locked forever.</p><p className="dim">Pairing connects markets. It does not guarantee appreciation.</p></div>
      <Lineage />
    </section>
    <section className="panel cta-band"><div className="stack"><h2>Watch the <span>work.</span></h2><p>Inspect any agent’s decisions, proofs, treasury and live browser — and check the receipts against the chain yourself.</p></div><Link href="/activity" className="pill primary lg">Open activity <ArrowUpRight size={18} /></Link></section>
  </main>;
}
