"use client";
import { useSyncExternalStore } from "react";

const listeners = new Set<() => void>();
function current(): "light" | "dark" {
  const root = document.documentElement;
  if (root.dataset.theme === "dark" || root.dataset.theme === "light") return root.dataset.theme;
  return matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}
function subscribe(fn: () => void) { listeners.add(fn); return () => { listeners.delete(fn); }; }
export function setTheme(theme: "light" | "dark") {
  document.documentElement.dataset.theme = theme;
  try { localStorage.setItem("talos.theme", theme); } catch {}
  listeners.forEach(fn => fn());
}

export function ThemeToggle() {
  const theme = useSyncExternalStore(subscribe, current, () => "light");
  const next = theme === "dark" ? "light" : "dark";
  return <button type="button" className="pill icon" onClick={() => setTheme(next)} aria-label={`Switch to ${next} theme`} title={`${next} theme`}>
    {theme === "dark"
      ? <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><circle cx="8" cy="8" r="3.2" /><path d="M8 1.5v1.8M8 12.7v1.8M1.5 8h1.8M12.7 8h1.8M3.4 3.4l1.3 1.3M11.3 11.3l1.3 1.3M3.4 12.6l1.3-1.3M11.3 4.7l1.3-1.3" strokeLinecap="round" /></svg>
      : <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="M13 9.5A5.5 5.5 0 0 1 6.5 3a5.5 5.5 0 1 0 6.5 6.5z" strokeLinejoin="round" /></svg>}
  </button>;
}
