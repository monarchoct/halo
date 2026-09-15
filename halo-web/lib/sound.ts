// Interface sound for TALOS: three synthesised voices (hover tick, click thock, confirm), silent until the first
// user gesture, master volume -16 dB, per-play pitch/level variance so repeated hovers never sound sampled.
// Optional recorded samples replace a voice through loadSample(). See public/docs/TALOS_MOTION_AND_SOUND.md.
export type Voice = "hover" | "click" | "confirm";

const STORAGE_KEY = "talos.sound";
const MASTER = 0.16;
/** Elements that make a sound on hover and press. */
export const SFX_SELECTOR = "[data-sfx], .pill, .seg > *, .card, .site-nav a, .site-footer nav a, .docs-nav a, .pagination button";

const listeners = new Set<() => void>();
let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let unlocked = false;
let lastHover = 0;
const samples = new Map<Voice, AudioBuffer>();

function ensure(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  if (!ctx) {
    ctx = new Ctor();
    master = ctx.createGain();
    master.gain.value = isMuted() ? 0 : MASTER;
    master.connect(ctx.destination);
  }
  return ctx;
}

/** Browsers only start audio after a user gesture; call from a pointerdown/keydown listener. */
export function unlock() {
  const c = ensure();
  if (!c || unlocked) return;
  c.resume().then(() => { unlocked = true; }).catch(() => {});
}

export function isMuted(): boolean {
  try { return localStorage.getItem(STORAGE_KEY) === "off"; } catch { return false; }
}

export function setMuted(muted: boolean) {
  try { localStorage.setItem(STORAGE_KEY, muted ? "off" : "on"); } catch {}
  if (master && ctx) master.gain.setTargetAtTime(muted ? 0 : MASTER, ctx.currentTime, 0.02);
  listeners.forEach(fn => fn());
}

/** External-store pair for React (useSyncExternalStore). */
export const getMuted = () => isMuted();
export function subscribeMuted(fn: () => void) { listeners.add(fn); return () => { listeners.delete(fn); }; }

/** Replace a synthesised voice with a recorded sample (m4a/ogg/mp3, <= 120 ms, peak -3 dBFS). */
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
  if (!c || !unlocked || isMuted() || !master) return;
  const now = performance.now();
  if (voice === "hover") { if (now - lastHover < 70) return; lastHover = now; }
  const at = c.currentTime + 0.001;
  const v = 1 + (Math.random() * 0.12 - 0.06);           // ±6 % pitch
  const a = Math.pow(10, (Math.random() * 4 - 2) / 20);  // ±2 dB
  const sample = samples.get(voice);
  if (sample) {
    const s = c.createBufferSource(); s.buffer = sample; s.playbackRate.value = v;
    const g = c.createGain(); g.gain.value = a;
    s.connect(g).connect(master); s.start(at); return;
  }
  switch (voice) {
    case "hover":
      tick(c, at, 2200 * v, 18, 0.35 * a);
      thock(c, at, 210 * v, 45, 0.25 * a);
      break;
    case "click":
      tick(c, at, 1900 * v, 22, 0.6 * a);
      thock(c, at, 150 * v, 70, 0.6 * a);
      tick(c, at + 0.012, 2600 * v, 14, 0.25 * a);        // the key's return
      break;
    case "confirm":
      thock(c, at, 330 * v, 120, 0.5 * a);
      thock(c, at + 0.09, 495 * v, 140, 0.4 * a);
      break;
  }
}

/** Wire delegated hover/press sound onto the document. Returns the teardown. */
export function attachInterfaceSound(): () => void {
  if (typeof document === "undefined") return () => {};
  const arm = () => { unlock(); window.removeEventListener("pointerdown", arm); window.removeEventListener("keydown", arm); };
  const over = (e: PointerEvent) => { if ((e.target as Element | null)?.closest?.(SFX_SELECTOR)) play("hover"); };
  const down = (e: PointerEvent) => {
    const el = (e.target as Element | null)?.closest?.(SFX_SELECTOR);
    if (!el) return;
    play(el.getAttribute("data-sfx") === "confirm" ? "confirm" : "click");
  };
  window.addEventListener("pointerdown", arm); window.addEventListener("keydown", arm);
  document.addEventListener("pointerover", over); document.addEventListener("pointerdown", down);
  return () => {
    window.removeEventListener("pointerdown", arm); window.removeEventListener("keydown", arm);
    document.removeEventListener("pointerover", over); document.removeEventListener("pointerdown", down);
  };
}
