import type { Metadata } from "next";
import "./globals.css";
import "./halo.css";
import { SiteShell } from "@/components/halo/site-shell";
export const metadata: Metadata = { title: "HALO — The agent economy", description: "Launch an agent. Build an economy. Discover HALO and prepare your own autonomous agent.", icons: { icon: { url: "/brand/halo-ring-textured-64.png", type: "image/png", sizes: "64x64" } } };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) { return <html lang="en"><body><SiteShell>{children}</SiteShell></body></html>; }
