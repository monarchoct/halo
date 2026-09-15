# TALOS — motion, opening sequence and interface sound

Reference: [The Tie-break](https://thetiebreak.merci-michel.com/eu/en/) by Merci-Michel (New Balance × Miu Miu campaign). Inspected 15 September 2026.

**What this document is:** the reference's techniques, observed and named, followed by an original TALOS implementation of each (drop-in files for `halo-web`). **What it is not:** a copy of their code or their sound files — both are their copyrighted work, and the app bundle is a compiled Vue build anyway. Everything below is written from scratch to produce the same *feel*; the sounds are synthesised in the browser, with a slot for your own recorded samples.

---

## 1. What the reference actually does (observed)

| Layer | Observation | TALOS translation |
| --- | --- | --- |
| Stack | Vue 3 + Vite bundle, one WebGL `<canvas>` for the whole scene, custom asset manifest (`baluchon-*.manifest.json`) that preloads `.ktx2` textures, one `.glb` model, two `.m4a` UI sounds and fonts before the first frame. | React/vinext already in place; a small preloader that fetches fonts + first-screen assets and drives a progress counter. |
| Opening | Solid dark navy plate → grainy, blurred blue "video" texture fades in → thin white lines drawn like tennis-court markings (a HUD) → serif italic headline (Instrument Serif Italic) sets in → one compact button "Start", then "Next →" steps. | Bone-white plate → bronze hairlines drawn like an engineer's frame → TALOS wordmark and one italic serif line set in → "Enter" → the board. |
| Grain | Full-screen animated film grain over everything, low alpha. | Canvas grain overlay, 12 fps, ~4 % alpha, disabled under reduced motion. |
| Type | Instrument Serif Italic for display, Work Sans Light/Regular for UI, tiny uppercase tracked labels ("OPPONENT", "YOU"). | Keep the *roles* (italic serif display, light grotesque UI, tracked micro-labels) with the faces chosen in the selected design direction. |
| Sound | Two short `.m4a` samples fetched at load; played through Web Audio on hover/click. The "creamy" click is a short, soft, low-mid transient — think a lubed linear keyboard switch, not a beep. Audio starts only after the first user gesture (browser autoplay rules). | `sound.ts` below: synthesised hover/click/confirm with per-play variation, throttle, master volume, mute toggle, gesture unlock, optional sample loading. |
| Buttons | Compact rectangles, hairline border, label + arrow, hover = subtle fill + sound. | Same shape language; magnetic drift toward the cursor, arrow nudge, sound. |
| Steps | Copy appears line by line with masked slide-up; UI elements stagger in. | Line-mask reveal utility (`.reveal`), stagger via `--i`. |

---

## 2. Sound engine — `halo-web/lib/sound.ts`

Synthesised so there is nothing to license. Three voices:

- **hover** — a tiny filtered noise tick (band-pass ~2.2 kHz, 18 ms) under a very soft sine "thock" (~210 Hz, 45 ms). Quiet.
- **click** — the same tick with a fuller low body (~150 Hz, 70 ms) and a short second transient 12 ms later (the "return" of a key).
- **confirm** — two soft sine notes a fifth apart (330/495 Hz), 120 ms, for successful actions (agent deployed, transaction confirmed).

Every play gets ±6 % pitch and ±2 dB volume variance so repeated hovers do not sound like a sampler. Hover is throttled to one play per 70 ms.

```ts
// halo-web/lib/sound.ts
type Voice = "hover" | "click" | "confirm";

const STORAGE_KEY = "talos.sound";
let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let unlocked = false;
let lastHover = 0;
const samples = new Map<Voice, AudioBuffer>();

function ensure(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!ctx) {
    ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    master = ctx.createGain();
    master.gain.value = isMuted() ? 0 : 0.18;
    master.connect(ctx.destination);
  }
  return ctx;
}

/** Browsers only start audio after a user gesture. Call once from a pointerdown/keydown listener. */
export function unlock() {
  const c = ensure();
  if (!c || unlocked) return;
  c.resume().then(() => { unlocked = true; });
}

export function isMuted(): boolean {
  try { return localStorage.getItem(STORAGE_KEY) === "off"; } catch { return false; }
}

export function setMuted(muted: boolean) {
  try { localStorage.setItem(STORAGE_KEY, muted ? "off" : "on"); } catch {}
  if (master && ctx) master.gain.setTargetAtTime(muted ? 0 : 0.18, ctx.currentTime, 0.02);
}

/** Optional: replace a synthesised voice with your own recorded sample (m4a/ogg/mp3, ≤120 ms, peak −3 dBFS). */
export async function loadSample(voice: Voice, url: string) {
  const c = ensure();
  if (!c) return;
  const bytes = await fetch(url).then(r => r.arrayBuffer());
  samples.set(voice, await c.decodeAudioData(bytes));
}

function noiseBuffer(c: AudioContext, seconds: number) {
  const b = c.createBuffer(1, Math.ceil(c.sampleRate * seconds), c.sampleRate);
  const d = b.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return b;
}

function tick(c: AudioContext, at: number, freq: number, ms: number, gain: number) {
  const src = c.createBufferSource();
  src.buffer = noiseBuffer(c, ms / 1000 + 0.01);
  const bp = c.createBiquadFilter();
  bp.type = "bandpass"; bp.frequency.value = freq; bp.Q.value = 1.4;
  const g = c.createGain();
  g.gain.setValueAtTime(gain, at);
  g.gain.exponentialRampToValueAtTime(0.0001, at + ms / 1000);
  src.connect(bp).connect(g).connect(master!);
  src.start(at); src.stop(at + ms / 1000 + 0.02);
}

function thock(c: AudioContext, at: number, freq: number, ms: number, gain: number) {
  const o = c.createOscillator();
  o.type = "sine";
  o.frequency.setValueAtTime(freq, at);
  o.frequency.exponentialRampToValueAtTime(freq * 0.72, at + ms / 1000);
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(gain, at + 0.004);
  g.gain.exponentialRampToValueAtTime(0.0001, at + ms / 1000);
  o.connect(g).connect(master!);
  o.start(at); o.stop(at + ms / 1000 + 0.02);
}

export function play(voice: Voice) {
  const c = ensure();
  if (!c || !unlocked || isMuted()) return;
  const now = performance.now();
  if (voice === "hover") { if (now - lastHover < 70) return; lastHover = now; }
  const at = c.currentTime + 0.001;
  const v = 1 + (Math.random() * 0.12 - 0.06);            // ±6 % pitch
  const a = Math.pow(10, (Math.random() * 4 - 2) / 20);   // ±2 dB
  const sample = samples.get(voice);
  if (sample) {
    const s = c.createBufferSource(); s.buffer = sample; s.playbackRate.value = v;
    const g = c.createGain(); g.gain.value = a;
    s.connect(g).connect(master!); s.start(at); return;
  }
  switch (voice) {
    case "hover":
      tick(c, at, 2200 * v, 18, 0.35 * a);
      thock(c, at, 210 * v, 45, 0.25 * a);
      break;
    case "click":
      tick(c, at, 1900 * v, 22, 0.6 * a);
      thock(c, at, 150 * v, 70, 0.6 * a);
      tick(c, at + 0.012, 2600 * v, 14, 0.25 * a);       // the key's return
      break;
    case "confirm":
      thock(c, at, 330 * v, 120, 0.5 * a);
      thock(c, at + 0.09, 495 * v, 140, 0.4 * a);
      break;
  }
}
```

Wiring (once, in the site shell):

```tsx
// in components/halo/site-shell.tsx
import { unlock, play } from "@/lib/sound";
useEffect(() => {
  const arm = () => { unlock(); window.removeEventListener("pointerdown", arm); window.removeEventListener("keydown", arm); };
  window.addEventListener("pointerdown", arm); window.addEventListener("keydown", arm);
  const over = (e: PointerEvent) => { if ((e.target as Element).closest("[data-sfx]")) play("hover"); };
  const down = (e: PointerEvent) => { const el = (e.target as Element).closest("[data-sfx]"); if (el) play(el.getAttribute("data-sfx") === "confirm" ? "confirm" : "click"); };
  document.addEventListener("pointerover", over); document.addEventListener("pointerdown", down);
  return () => { document.removeEventListener("pointerover", over); document.removeEventListener("pointerdown", down); };
}, []);
```

Then any element with `data-sfx` (buttons, board rows, nav links, filter chips) gets the sound: `<button data-sfx>Deploy an agent</button>`, `<button data-sfx="confirm">Confirm purchase</button>`. Add one `<SoundToggle />` in the nav (speaker glyph, persists through `setMuted`). Never play sound on page load or on scroll — only on hover/press, like the reference.

**Your own samples.** If you want a recorded "creamy" switch instead of synthesis: record (or license) a single lubed linear keyboard switch press at 48 kHz, trim to the transient (~60–90 ms, 5 ms fade-out), normalise peak to −3 dBFS, export `hover.m4a` (quieter take) and `click.m4a`, put them in `halo-web/public/sfx/` and call `loadSample("hover", "/sfx/hover.m4a")` after `unlock()`. The engine falls back to synthesis until the sample is decoded.

---

## 3. Opening sequence — `components/halo/opening.tsx`

Runs once per session (`sessionStorage`), ~1.6 s total, skippable by click/keypress, and skipped entirely under `prefers-reduced-motion` (the page simply appears).

Timeline:

1. `0 ms` — bone-white plate covers the page; a `0 %` counter in the corner in tabular mono.
2. `0–700 ms` — preloader fetches display font + first board payload; counter follows real progress (never fake-linear).
3. `300 ms` — bronze hairlines draw in from the edges (SVG `stroke-dashoffset`), framing the centre like a drafting sheet.
4. `650 ms` — wordmark TALOS sets in with a line-mask slide-up; one italic serif line under it ("An automaton that never stops circling the island.").
5. `1250 ms` — plate splits: top half `clip-path: inset(0 0 100% 0)`, bottom `inset(100% 0 0 0)`, 550 ms, ease `cubic-bezier(.77,0,.18,1)`; the page beneath was already rendered (no layout shift). Grain overlay stays.

```tsx
// components/halo/opening.tsx
"use client";
import { useEffect, useState } from "react";

export function Opening({ ready }: { ready: Promise<unknown> }) {
  const [phase, setPhase] = useState<"plate" | "open" | "done">(() =>
    typeof window !== "undefined" && (sessionStorage.getItem("talos.opened") || matchMedia("(prefers-reduced-motion: reduce)").matches) ? "done" : "plate");
  const [pct, setPct] = useState(0);

  useEffect(() => {
    if (phase !== "plate") return;
    let alive = true;
    const t0 = performance.now();
    const tick = () => { if (!alive) return; setPct(p => Math.min(92, p + 3)); if (performance.now() - t0 < 900) requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
    const open = () => { if (!alive) return; setPct(100); setTimeout(() => { setPhase("open"); sessionStorage.setItem("talos.opened", "1"); setTimeout(() => setPhase("done"), 600); }, 350); };
    Promise.race([ready, new Promise(r => setTimeout(r, 1400))]).then(open);
    const skip = () => open();
    window.addEventListener("pointerdown", skip, { once: true }); window.addEventListener("keydown", skip, { once: true });
    return () => { alive = false; };
  }, [phase, ready]);

  if (phase === "done") return null;
  return (
    <div className={`opening ${phase}`} aria-hidden="true">
      <div className="opening-half top" />
      <div className="opening-half bottom" />
      <svg className="opening-frame" viewBox="0 0 100 100" preserveAspectRatio="none">
        <path d="M6 12 H94 M6 88 H94 M12 6 V94 M88 6 V94" pathLength={1} />
      </svg>
      <div className="opening-mark">
        <span className="reveal"><span>TALOS</span></span>
        <span className="reveal line" style={{ ["--i" as any]: 1 }}><span>An automaton that never stops circling the island.</span></span>
      </div>
      <div className="opening-pct">{String(pct).padStart(3, "0")}</div>
    </div>
  );
}
```

```css
/* app/halo.css — opening */
.opening { position: fixed; inset: 0; z-index: 80; pointer-events: none; color: var(--ink); }
.opening-half { position: absolute; left: 0; right: 0; height: 50%; background: var(--plate); transition: clip-path .55s cubic-bezier(.77,0,.18,1); }
.opening-half.top { top: 0; clip-path: inset(0 0 0 0); }
.opening-half.bottom { bottom: 0; clip-path: inset(0 0 0 0); }
.opening.open .opening-half.top { clip-path: inset(0 0 100% 0); }
.opening.open .opening-half.bottom { clip-path: inset(100% 0 0 0); }
.opening-frame { position: absolute; inset: 0; width: 100%; height: 100%; }
.opening-frame path { fill: none; stroke: var(--bronze); stroke-width: .35; vector-effect: non-scaling-stroke;
  stroke-dasharray: 1; stroke-dashoffset: 1; animation: draw .9s .3s cubic-bezier(.65,0,.35,1) forwards; }
.opening.open .opening-frame, .opening.open .opening-mark, .opening.open .opening-pct { opacity: 0; transition: opacity .25s; }
.opening-mark { position: absolute; left: 50%; top: 50%; transform: translate(-50%,-50%); display: grid; gap: .6rem; text-align: center; }
.opening-mark .reveal > span { font: 500 clamp(2.4rem, 7vw, 6rem)/1 var(--font-display); letter-spacing: .08em; }
.opening-mark .line > span { font: italic 400 clamp(1rem, 1.6vw, 1.25rem)/1.4 var(--font-serif); letter-spacing: 0; }
.opening-pct { position: absolute; right: 8vw; bottom: 8vh; font: 400 .8rem/1 var(--font-mono); font-variant-numeric: tabular-nums; letter-spacing: .12em; }
@keyframes draw { to { stroke-dashoffset: 0; } }
```

The plate colour `--plate` is the ground of whichever design direction wins; `--bronze` is that direction's metal hairline.

---

## 4. Line-mask reveal (used everywhere copy "sets in")

```css
.reveal { display: block; overflow: hidden; }
.reveal > span { display: block; transform: translateY(110%); animation: setin .7s cubic-bezier(.2,.7,.2,1) forwards; animation-delay: calc(.65s + var(--i, 0) * 90ms); }
@keyframes setin { to { transform: none; } }
@media (prefers-reduced-motion: reduce) { .reveal > span { animation: none; transform: none; } }
```

Elements are visible in the DOM at rest (the mask only slides them into place), so thumbnails and reduced-motion users get the finished page.

---

## 5. Grain overlay — `components/halo/grain.tsx`

```tsx
"use client";
import { useEffect, useRef } from "react";
export function Grain({ alpha = 0.045 }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const c = ref.current!, g = c.getContext("2d", { alpha: true })!;
    let raf = 0, last = 0;
    const size = () => { c.width = Math.ceil(innerWidth / 2); c.height = Math.ceil(innerHeight / 2); };
    size(); addEventListener("resize", size);
    const frame = (t: number) => {
      raf = requestAnimationFrame(frame);
      if (t - last < 83) return; last = t;                       // ~12 fps, like film
      const img = g.createImageData(c.width, c.height), d = img.data;
      for (let i = 0; i < d.length; i += 4) { const v = (Math.random() * 255) | 0; d[i] = d[i + 1] = d[i + 2] = v; d[i + 3] = 255; }
      g.putImageData(img, 0, 0);
    };
    raf = requestAnimationFrame(frame);
    return () => { cancelAnimationFrame(raf); removeEventListener("resize", size); };
  }, []);
  return <canvas ref={ref} className="grain" style={{ opacity: alpha }} aria-hidden="true" />;
}
```

```css
.grain { position: fixed; inset: 0; width: 100%; height: 100%; pointer-events: none; z-index: 70; mix-blend-mode: multiply; image-rendering: pixelated; }
```

On a light ground use `multiply`; on dark grounds switch to `screen` at half the alpha.

---

## 6. Buttons and hover micro-interactions

```css
.btn { position: relative; display: inline-flex; align-items: center; gap: .6em; padding: .7em 1.1em; border: 1px solid var(--hairline); background: transparent; color: var(--ink);
  font: 500 .85rem/1 var(--font-ui); letter-spacing: .06em; text-transform: uppercase; cursor: pointer; transition: background .25s, color .25s, border-color .25s; }
.btn::after { content: ""; position: absolute; inset: 0; background: var(--ink); transform: scaleX(0); transform-origin: left; transition: transform .35s cubic-bezier(.77,0,.18,1); z-index: -1; }
.btn:hover { color: var(--plate); border-color: var(--ink); }
.btn:hover::after { transform: scaleX(1); }
.btn .arrow { display: inline-block; transition: transform .35s cubic-bezier(.2,.7,.2,1); }
.btn:hover .arrow { transform: translateX(.35em); }
.btn:focus-visible { outline: 2px solid var(--accent); outline-offset: 3px; }
@media (prefers-reduced-motion: reduce) { .btn::after, .btn .arrow { transition: none; } }
```

Magnetic drift (pointer devices only, max 6 px, springs back):

```ts
// lib/magnetic.ts
export function magnetic(el: HTMLElement, strength = 6) {
  if (!matchMedia("(pointer: fine)").matches || matchMedia("(prefers-reduced-motion: reduce)").matches) return () => {};
  const move = (e: PointerEvent) => { const r = el.getBoundingClientRect(); const x = (e.clientX - r.left - r.width / 2) / r.width, y = (e.clientY - r.top - r.height / 2) / r.height; el.style.transform = `translate(${x * strength}px, ${y * strength}px)`; };
  const leave = () => { el.style.transform = ""; };
  el.addEventListener("pointermove", move); el.addEventListener("pointerleave", leave);
  return () => { el.removeEventListener("pointermove", move); el.removeEventListener("pointerleave", leave); };
}
```

---

## 7. Page transitions (vinext / React)

Use the View Transitions API where it exists and a plate wipe otherwise:

```ts
// lib/transition.ts
export function navigateWithTransition(go: () => void) {
  const d = document as any;
  if (!d.startViewTransition || matchMedia("(prefers-reduced-motion: reduce)").matches) return go();
  d.startViewTransition(go);
}
```

```css
::view-transition-old(root) { animation: 220ms cubic-bezier(.4,0,1,1) both fade-out; }
::view-transition-new(root) { animation: 320ms cubic-bezier(0,0,.2,1) both fade-in; }
@keyframes fade-out { to { opacity: 0; } } @keyframes fade-in { from { opacity: 0; } }
```

Give the wordmark and the nav `view-transition-name: nav` so they stay put while the page swaps.

---

## 8. Where each file goes

```
halo-web/lib/sound.ts                 sound engine (section 2)
halo-web/lib/magnetic.ts              magnetic buttons (section 6)
halo-web/lib/transition.ts            page transitions (section 7)
halo-web/components/halo/opening.tsx  opening sequence (section 3)
halo-web/components/halo/grain.tsx    grain overlay (section 5)
halo-web/components/halo/sound-toggle.tsx  speaker toggle in the nav → setMuted()
halo-web/app/halo.css                 tokens + the CSS above (sections 3–7)
halo-web/public/sfx/                  optional recorded samples (yours)
```

`data-sfx` goes on: nav links, both hero CTAs, board rows and sort/filter chips, agent-profile tabs, the buy button (`confirm` on the final confirm), deploy-wizard steps. Nothing else — sound on every element becomes noise within a minute.

---

## 9. Checklist before shipping

- Sound is silent until the first pointerdown/keydown; toggle persists; volume ≤ −15 dBFS peak at master 0.18.
- Opening runs once per session, is skippable, never longer than 1.6 s, and is skipped under reduced motion.
- Grain ≤ 5 % alpha on light grounds, off under reduced motion, never over text-heavy docs pages.
- Every animated element is complete at rest (no `opacity: 0` waiting for a scroll trigger).
- Lighthouse: no CLS from the opening (page renders beneath the plate), main-thread work from grain under 3 ms per frame at 12 fps.
