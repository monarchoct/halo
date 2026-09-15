"use client";
import { useSyncExternalStore } from "react";
import { getMuted, setMuted, subscribeMuted } from "@/lib/sound";

const serverSnapshot = () => false;

export function SoundToggle() {
  const muted = useSyncExternalStore(subscribeMuted, getMuted, serverSnapshot);
  return <button type="button" className="pill icon" onClick={() => setMuted(!muted)} aria-pressed={!muted} aria-label={muted ? "Turn interface sound on" : "Turn interface sound off"} title={muted ? "Sound off" : "Sound on"}>
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
      <path d="M2.5 6h2.6L9 3v10L5.1 10H2.5z" />
      {muted ? <path d="M11 6l3 4M14 6l-3 4" strokeLinecap="round" /> : <path d="M11 5.5c1.3 1.4 1.3 3.6 0 5" strokeLinecap="round" />}
    </svg>
  </button>;
}
