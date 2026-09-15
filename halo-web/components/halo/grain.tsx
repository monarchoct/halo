"use client";
import { useEffect, useRef } from "react";

// Film grain at ~12 fps over the whole page; off under reduced motion and while the tab is hidden.
export function Grain({ alpha = 0.04 }: { alpha?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const g = c.getContext("2d", { alpha: true });
    if (!g) return;
    let raf = 0, last = 0;
    const size = () => { c.width = Math.ceil(innerWidth / 2); c.height = Math.ceil(innerHeight / 2); };
    size();
    addEventListener("resize", size);
    const frame = (t: number) => {
      raf = requestAnimationFrame(frame);
      if (t - last < 83 || document.visibilityState === "hidden") return;
      last = t;
      const img = g.createImageData(c.width, c.height), d = img.data;
      for (let i = 0; i < d.length; i += 4) { const v = (Math.random() * 255) | 0; d[i] = d[i + 1] = d[i + 2] = v; d[i + 3] = 255; }
      g.putImageData(img, 0, 0);
    };
    raf = requestAnimationFrame(frame);
    return () => { cancelAnimationFrame(raf); removeEventListener("resize", size); };
  }, []);
  return <canvas ref={ref} className="grain" style={{ opacity: alpha }} aria-hidden="true" />;
}
