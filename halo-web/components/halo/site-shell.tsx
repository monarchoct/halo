"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { Toaster } from "@/components/ui/sonner";
import { ProtocolProvider, useProtocol } from "./protocol-provider";
import { shortAddress } from "@/lib/format";
import { Motion } from "./motion";
import { SoundToggle } from "./sound-toggle";
import { ThemeToggle } from "./theme-toggle";

const links = [["/", "Explore"], ["/activity", "Activity"], ["/portfolio", "Portfolio"], ["/docs", "Docs"]] as const;

export function Mark() {
  return <svg viewBox="0 0 26 26" fill="none" aria-hidden="true"><circle cx="13" cy="13" r="10.5" stroke="currentColor" strokeWidth="1.4" /><circle cx="13" cy="13" r="2.2" fill="var(--accent)" /><path d="M13 2.5v4M13 19.5v4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" /></svg>;
}

function Shell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const { address, openWallet, deployment, status, chainId, switchNetwork, statusError } = useProtocol();
  const [networkError, setNetworkError] = useState("");
  const chainLabel = status ? (status.environment === "local" ? "Local chain" : status.chainName) : statusError ? "Chain unavailable" : "Connecting";
  const current = (href: string) => href === "/" ? path === "/" || path === "/explore" : path === href || path.startsWith(`${href}/`);
  const explorer = deployment?.explorerUrl;
  const blockHref = explorer && status ? `${explorer}/block/${status.blockNumber}` : undefined;
  const chip = <><i aria-hidden="true" />{chainLabel}{status && <span className="num"> · {Number(status.blockNumber).toLocaleString("en-US")}</span>}</>;
  return <div>
    <Motion />
    <a href="#main" className="skip-link">Skip to content</a>
    <header className="site-header"><div className="wrap"><div className="bar">
      <Link href="/" className="wordmark" aria-label="TALOS home"><Mark />TALOS</Link>
      <nav className="site-nav" aria-label="Main navigation"><div className="tabs">
        {links.map(([href, label]) => <Link key={href} href={href} aria-current={current(href) ? "page" : undefined}>{label}</Link>)}
      </div></nav>
      <div className="actions">
        {blockHref
          ? <a className={`status-chip ${status ? "" : statusError ? "off" : "wait"}`} href={blockHref} target="_blank" rel="noreferrer" title="Open the latest block in the explorer">{chip}</a>
          : <span className={`status-chip ${status ? "" : statusError ? "off" : "wait"}`} title={status ? `Block ${status.blockNumber}` : statusError || "Connecting to the chain"}>{chip}</span>}
        <SoundToggle />
        <ThemeToggle />
        <Link href="/deploy" className="pill primary">Deploy</Link>
        <button type="button" className="pill" onClick={openWallet}>{address ? shortAddress(address) : "Connect"}</button>
      </div>
    </div></div></header>
    {address && deployment && chainId !== deployment.chainId && <div className="wrap"><div className="network-notice notice warn"><p>{networkError || "Your wallet is on a different network."}</p>
      <button type="button" className="pill sm" onClick={() => switchNetwork().catch(error => setNetworkError(error.message))}>Switch to {deployment.chainName}</button></div></div>}
    {children}
    <footer className="wrap"><div className="site-footer">
      <p>© 2026 TALOS · {status ? `${status.environment === "local" ? "Local development" : status.chainName} · block ${Number(status.blockNumber).toLocaleString("en-US")}` : statusError || "Connecting to chain…"} · statuary CC0, The Met</p>
      <nav aria-label="Footer"><Link href="/">Explore</Link><Link href="/activity">Activity</Link><Link href="/deploy">Deploy an agent</Link><Link href="/docs">Docs</Link><a href="/docs/HALO_LIVE_STATUS.md">Status</a><a href="/art/statues/CREDITS.md">Credits</a></nav>
    </div></footer>
    <Toaster theme="light" position="bottom-right" />
  </div>;
}
export function SiteShell({ children }: { children: React.ReactNode }) { return <ProtocolProvider><Shell>{children}</Shell></ProtocolProvider>; }
