// Scroll reveal: elements with .reveal-up fade/slide in when they enter the viewport. Marks <html class="js"> so
// the CSS only hides things when this script is running; without it (or under reduced motion) everything is visible.
export function startReveal(): () => void {
  if (typeof document === "undefined") return () => {};
  document.documentElement.classList.add("js");
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) {
    document.querySelectorAll(".reveal-up").forEach(el => el.classList.add("in"));
    return () => {};
  }
  const io = new IntersectionObserver(entries => {
    for (const e of entries) if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); }
  }, { rootMargin: "0px 0px -8% 0px", threshold: 0.05 });
  const seen = new WeakSet<Element>();
  const scan = () => document.querySelectorAll(".reveal-up:not(.in)").forEach(el => { if (!seen.has(el)) { seen.add(el); io.observe(el); } });
  scan();
  const mo = new MutationObserver(scan);
  mo.observe(document.body, { childList: true, subtree: true });
  return () => { io.disconnect(); mo.disconnect(); };
}

/** Animate a number from its current displayed value to `target` over `ms`. Returns a cancel function. */
export function countUp(el: HTMLElement, target: number, ms = 900, format: (n: number) => string = n => Math.round(n).toLocaleString("en-US")) {
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) { el.textContent = format(target); return () => {}; }
  const from = Number(el.dataset.value ?? 0) || 0;
  el.dataset.value = String(target);
  const t0 = performance.now();
  let raf = 0;
  const step = (t: number) => {
    const k = Math.min(1, (t - t0) / ms), e = 1 - Math.pow(1 - k, 3);
    el.textContent = format(from + (target - from) * e);
    if (k < 1) raf = requestAnimationFrame(step);
  };
  raf = requestAnimationFrame(step);
  return () => cancelAnimationFrame(raf);
}
