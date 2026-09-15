// Page transitions: the View Transitions API where it exists, a plain navigation otherwise.
export function withViewTransition(update: () => void) {
  if (typeof document === "undefined") { update(); return; }
  const d = document as Document & { startViewTransition?: (cb: () => void) => unknown };
  if (!d.startViewTransition || matchMedia("(prefers-reduced-motion: reduce)").matches) { update(); return; }
  d.startViewTransition(update);
}
