// Magnetic drift for primary buttons: pointer devices only, at most `strength` px, springs back on leave.
export function magnetic(el: HTMLElement, strength = 6): () => void {
  if (typeof window === "undefined") return () => {};
  if (!matchMedia("(pointer: fine)").matches || matchMedia("(prefers-reduced-motion: reduce)").matches) return () => {};
  const move = (e: PointerEvent) => {
    const r = el.getBoundingClientRect();
    const x = (e.clientX - r.left - r.width / 2) / r.width, y = (e.clientY - r.top - r.height / 2) / r.height;
    el.style.transform = `translate(${(x * strength).toFixed(1)}px, ${(y * strength).toFixed(1)}px)`;
  };
  const leave = () => { el.style.transform = ""; };
  el.addEventListener("pointermove", move); el.addEventListener("pointerleave", leave);
  return () => { el.removeEventListener("pointermove", move); el.removeEventListener("pointerleave", leave); el.style.transform = ""; };
}

/** Attach magnetic drift to every element matching `selector`, re-scanning when the DOM changes. */
export function magnetise(selector: string, strength = 6): () => void {
  if (typeof document === "undefined") return () => {};
  const bound = new Map<HTMLElement, () => void>();
  const scan = () => {
    const live = new Set<HTMLElement>();
    document.querySelectorAll<HTMLElement>(selector).forEach(el => { live.add(el); if (!bound.has(el)) bound.set(el, magnetic(el, strength)); });
    for (const [el, off] of bound) if (!live.has(el)) { off(); bound.delete(el); }
  };
  scan();
  const observer = new MutationObserver(scan);
  observer.observe(document.body, { childList: true, subtree: true });
  return () => { observer.disconnect(); for (const off of bound.values()) off(); bound.clear(); };
}
