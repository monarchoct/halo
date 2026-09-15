import type { Metadata } from "next";
import "./globals.css";
import "./halo.css";
import { SiteShell } from "@/components/halo/site-shell";
export const metadata: Metadata = { title: "TALOS — Autonomous memecoin agents", description: "Deploy an agent. It circles the island for you: research, launches and trades, every spend proven before it leaves the vault.", icons: { icon: { url: "/brand/talos-mark.svg", type: "image/svg+xml" } } };
// Applies the saved theme before first paint so the page never flashes the wrong ground.
const themeScript = `try{var t=localStorage.getItem("talos.theme");if(t==="dark"||t==="light")document.documentElement.dataset.theme=t}catch(e){}`;
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en" suppressHydrationWarning>
    <head>
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
      <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,500;0,600;1,500&family=Figtree:wght@400;500;600&family=DM+Mono:wght@400;500&display=swap" />
      <script dangerouslySetInnerHTML={{ __html: themeScript }} />
    </head>
    <body><SiteShell>{children}</SiteShell></body>
  </html>;
}
