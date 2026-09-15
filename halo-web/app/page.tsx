"use client";
import { useState } from "react";
import { Board } from "@/components/halo/board";

/** Like PONS, the landing page is the launchpad itself: the hero carries the search; the board is the page. */
export default function Home() {
  const [view, setView] = useState<"agents" | "coins">("agents");
  return <main id="main" className="wrap page">
    <Board view={view} onView={setView} intro />
  </main>;
}
