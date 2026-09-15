"use client";
import { useEffect, useRef } from "react";

// The cycle ring: arc = curve progress, a dot orbits while the agent is live (Talos circling the island),
// the number is the curve percentage (or a check once graduated). Static but complete under reduced motion.
export function CycleRing({ pct, live = false, size = 52, label }: { pct: number; live?: boolean; size?: number; label?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    const g = c?.getContext("2d");
    if (!c || !g) return;
    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const S = size * 2; c.width = S; c.height = S;
    const phase = Math.random() * Math.PI * 2;
    let raf = 0;
    const draw = (t: number) => {
      const cs = getComputedStyle(document.documentElement);
      const cx = S / 2, cy = S / 2, R = S / 2 - 10;
      g.clearRect(0, 0, S, S);
      g.lineWidth = 3; g.lineCap = "round";
      g.strokeStyle = cs.getPropertyValue("--hair").trim() || "rgba(0,0,0,.12)";
      g.beginPath(); g.arc(cx, cy, R, 0, Math.PI * 2); g.stroke();
      const end = -Math.PI / 2 + (Math.min(100, pct) / 100) * Math.PI * 2;
      g.strokeStyle = cs.getPropertyValue("--accent").trim() || "#7d5027";
      g.beginPath(); g.arc(cx, cy, R, -Math.PI / 2, end); g.stroke();
      const a = live && !reduce ? phase + t / 1400 : end;
      g.fillStyle = (live ? cs.getPropertyValue("--up") : cs.getPropertyValue("--ink-3")).trim() || "#2f7d5a";
      g.beginPath(); g.arc(cx + Math.cos(a) * R, cy + Math.sin(a) * R, 5, 0, Math.PI * 2); g.fill();
      g.fillStyle = cs.getPropertyValue("--ink").trim() || "#1b1813";
      g.font = `500 ${Math.round(S * 0.21)}px "DM Mono", monospace`; g.textAlign = "center"; g.textBaseline = "middle";
      g.fillText(pct >= 100 ? "✓" : String(Math.round(pct)), cx, cy + 1);
      if (live && !reduce) raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [pct, live, size]);
  return <canvas ref={ref} style={{ width: size, height: size }} role="img" aria-label={label ?? `${Math.round(pct)}% of the curve sold${live ? ", agent live" : ""}`} />;
}
