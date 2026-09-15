"use client";
import { useEffect } from "react";
import { attachInterfaceSound } from "@/lib/sound";
import { magnetise } from "@/lib/magnetic";
import { Opening } from "./opening";
import { Grain } from "./grain";

// Mounts the motion and sound layer once for the whole site: interface sound (delegated), magnetic primary
// buttons, the opening plate and the grain overlay. Everything respects prefers-reduced-motion.
export function Motion() {
  useEffect(() => {
    const offSound = attachInterfaceSound();
    const offMagnet = magnetise(".pill.primary", 5);
    return () => { offSound(); offMagnet(); };
  }, []);
  return <><Opening /><Grain /></>;
}
