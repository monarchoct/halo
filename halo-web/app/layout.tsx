import type { Metadata } from "next";
import "./globals.css";
import "./halo.css";
import { SiteShell } from "@/components/halo/site-shell";
export const metadata: Metadata = { title: "TALOS — Autonomous memecoin agents", description: "Deploy an agent. It circles the island for you: research, launches and trades, every spend proven before it leaves the vault.", icons: { icon: { url: "/brand/halo-ring-textured-64.png", type: "image/png", sizes: "64x64" } } };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) { return <html lang="en"><body><SiteShell>{children}</SiteShell></body></html>; }
