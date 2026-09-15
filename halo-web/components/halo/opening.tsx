"use client";
import { useEffect, useState } from "react";

// Opening plate: rendered from the server so nothing flashes, removed on the client at once when this session has
// already seen it (or under reduced motion), otherwise opened after fonts settle — never later than 1.6 s — and
// skippable by any gesture. The page renders beneath it, so opening causes no layout shift.
export function Opening() {
  const [phase, setPhase] = useState<"plate" | "open" | "done">("plate");
  const [pct, setPct] = useState(0);

  useEffect(() => {
    let alive = true;
    const finish = () => setPhase("done");
    let seen = false;
    try { seen = !!sessionStorage.getItem("talos.opened") || matchMedia("(prefers-reduced-motion: reduce)").matches || document.visibilityState === "hidden"; } catch { seen = true; }
    if (seen) { const t = setTimeout(finish, 0); return () => clearTimeout(t); }
    const open = () => {
      if (!alive) return;
      alive = false;
      try { sessionStorage.setItem("talos.opened", "1"); } catch {}
      setPct(100);
      setPhase("open");
      setTimeout(finish, 700);
    };
    const t0 = performance.now();
    const counter = setInterval(() => { if (alive) setPct(Math.min(96, Math.round((performance.now() - t0) / 9))); }, 40);
    const fonts = typeof document.fonts?.ready?.then === "function" ? document.fonts.ready : Promise.resolve();
    Promise.race([fonts, new Promise(r => setTimeout(r, 1000))]).then(() => setTimeout(open, 350));
    const cap = setTimeout(open, 1600);
    const hide = () => { if (document.visibilityState === "hidden") open(); };
    window.addEventListener("pointerdown", open, { once: true });
    window.addEventListener("keydown", open, { once: true });
    document.addEventListener("visibilitychange", hide);
    return () => { alive = false; clearInterval(counter); clearTimeout(cap); window.removeEventListener("pointerdown", open); window.removeEventListener("keydown", open); document.removeEventListener("visibilitychange", hide); };
  }, []);

  if (phase === "done") return null;
  return <div className={`opening ${phase}`} aria-hidden="true">
    <div className="opening-half top" /><div className="opening-half bottom" />
    <svg className="opening-frame" viewBox="0 0 100 100" preserveAspectRatio="none"><path d="M6 10 H94 M6 90 H94 M10 6 V94 M90 6 V94" pathLength={1} /></svg>
    <div className="opening-mark">
      <span className="reveal"><span>TALOS</span></span>
      <span className="reveal line" style={{ "--i": 1 } as React.CSSProperties}><span>An automaton that never stops circling the island.</span></span>
    </div>
    <div className="opening-pct num">{String(pct).padStart(3, "0")}</div>
  </div>;
}
