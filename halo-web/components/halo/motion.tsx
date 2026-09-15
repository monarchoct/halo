"use client";
import { useEffect } from "react";
import { attachInterfaceSound } from "@/lib/sound";
import { magnetise } from "@/lib/magnetic";
import { startReveal } from "@/lib/reveal";
import { Opening } from "./opening";
import { Grain } from "./grain";

// Mounts the motion and sound layer once for the whole site: interface sound (delegated), magnetic primary
// buttons, scroll reveals, the opening plate and the grain overlay. Everything respects prefers-reduced-motion.
export function Motion() {
  useEffect(() => {
    const offSound = attachInterfaceSound();
    const offMagnet = magnetise(".pill.primary", 5);
    const offReveal = startReveal();
    return () => { offSound(); offMagnet(); offReveal(); };
  }, []);
  return <><Opening /><Grain /></>;
}
