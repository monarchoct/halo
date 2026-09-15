"use client";
import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { Toaster } from "@/components/ui/sonner";
import { ProtocolProvider, useProtocol } from "./protocol-provider";
import { shortAddress } from "@/lib/format";
import { Motion } from "./motion";
import { SoundToggle } from "./sound-toggle";

const links = [["/", "Explore"], ["/activity", "Activity"], ["/portfolio", "Portfolio"], ["/docs", "Docs"]] as const;

function Shell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const { address, openWallet, deployment, status, chainId, switchNetwork, statusError } = useProtocol();
  const [networkError, setNetworkError] = useState("");
  const chainLabel = status ? (status.environment === "local" ? "Local chain" : status.chainName) : statusError ? "Chain unavailable" : "Connecting";
  const current = (href: string) => href === "/" ? path === "/" || path === "/explore" : path === href || path.startsWith(`${href}/`);
  return <div>
    <Motion />
    <a href="#main" className="skip-link">Skip to content</a>
    <header className="site-header"><div className="wrap"><div className="bar">
      <Link href="/" className="wordmark" aria-label="TALOS home"><Image src="/brand/halo-ring-textured-256.png" width={30} height={30} alt="" unoptimized />TALOS</Link>
      <nav className="site-nav" aria-label="Main navigation"><div className="seg">
        {links.map(([href, label]) => <Link key={href} href={href} aria-current={current(href) ? "page" : undefined}>{label}</Link>)}
      </div></nav>
      <div className="actions">
        <span className={`status-chip ${status ? "" : statusError ? "off" : "wait"}`} title={status ? `Block ${status.blockNumber}` : statusError || "Connecting to the chain"}><i aria-hidden="true" />{chainLabel}</span>
        <SoundToggle />
        <Link href="/deploy" className="pill primary">Create</Link>
        <button type="button" className="pill" onClick={openWallet}>{address ? shortAddress(address) : "Connect"}</button>
      </div>
    </div></div></header>
    {address && deployment && chainId !== deployment.chainId && <div className="wrap"><div className="network-notice notice warn"><p>{networkError || "Your wallet is on a different network."}</p>
      <button type="button" className="pill sm" onClick={() => switchNetwork().catch(error => setNetworkError(error.message))}>Switch to {deployment.chainName}</button></div></div>}
    {children}
    <footer className="wrap"><div className="site-footer">
      <div className="stack"><Link href="/" className="wordmark" aria-label="TALOS home"><Image src="/brand/halo-ring-textured-256.png" width={30} height={30} alt="" unoptimized />TALOS</Link>
        <p>Autonomous coin deployers on Robinhood Chain.<br /><span className="dim">{status ? `${status.environment === "local" ? "Local development" : status.chainName} · Block ${status.blockNumber}` : statusError || "Connecting to chain…"}</span></p></div>
      <nav aria-label="Footer"><Link href="/">Explore</Link><Link href="/activity">Activity</Link><Link href="/deploy">Create an agent</Link><Link href="/docs">Docs</Link><a href="/docs/HALO_LIVE_STATUS.md">Status</a></nav>
    </div></footer>
    <Toaster theme="dark" position="bottom-right" />
  </div>;
}
export function SiteShell({ children }: { children: React.ReactNode }) { return <ProtocolProvider><Shell>{children}</Shell></ProtocolProvider>; }
