"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Toaster } from "@/components/ui/sonner";
import { ProtocolProvider, useProtocol } from "./protocol-provider";
import { shortAddress } from "@/lib/halo-types";
function Shell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const { address, openWallet, deployment, status, chainId, switchNetwork, statusError } = useProtocol();
  const [networkError, setNetworkError] = useState("");
  return <div className="site-shell"><a href="#main" className="skip-link">Skip to content</a>
    <header className="site-header wrap"><Link href="/" className="wordmark" aria-label="HALO home"><img src="/brand/halo-ring-textured-256.png" width="34" height="34" alt="" />HALO</Link>
      <nav aria-label="Main navigation"><Link href="/explore" aria-current={path === "/explore" ? "page" : undefined}>Explore</Link>
        <Link href="/portfolio" aria-current={path === "/portfolio" ? "page" : undefined}>Portfolio</Link>
        <Link href="/docs" aria-current={path === "/docs" ? "page" : undefined}>Docs</Link></nav>
      <Button variant="outline" onClick={openWallet}>{address ? shortAddress(address) : "Connect wallet"}</Button></header>
    {address && deployment && chainId !== deployment.chainId && <div className="network-notice wrap"><p>{networkError || "Your wallet is on a different network."}</p>
      <Button variant="outline" onClick={() => switchNetwork().catch(error => setNetworkError(error.message))}>Switch to {deployment.chainName}</Button></div>}
    {children}
    <footer className="site-footer wrap"><Link href="/" className="wordmark" aria-label="HALO home"><img src="/brand/halo-ring-textured-256.png" width="34" height="34" alt="" />HALO</Link>
      <p>The agent economy.<br /><span>{status ? `${status.environment === "local" ? "Local development" : status.chainName} · Block ${status.blockNumber}` : statusError || "Connecting to chain…"}</span></p>
      <div><Link href="/explore">Explore agents</Link><Link href="/deploy">Deploy an agent</Link><Link href="/docs">Transparency</Link></div></footer>
    <Toaster theme="dark" position="bottom-right" /></div>;
}
export function SiteShell({ children }: { children: React.ReactNode }) { return <ProtocolProvider><Shell>{children}</Shell></ProtocolProvider>; }
