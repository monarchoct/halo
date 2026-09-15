import { formatUnits } from "viem";
import type { Market } from "./halo-types";

/** Curve constants mirror HaloTypes.sol: 1B supply, 800M on the curve, 200M reserved for graduation. */
export const CURVE_SUPPLY = 8e26;
export const TOTAL_SUPPLY = 1e27;

export const amount = (value: string | bigint, decimals = 18, maximumFractionDigits = 3) =>
  Number(formatUnits(BigInt(value), decimals)).toLocaleString("en-US", { maximumFractionDigits });
export const compact = (n: number) => n === 0 ? "0" : !Number.isFinite(n) ? "—" : Math.abs(n) < 0.0001 ? n.toExponential(2)
  : new Intl.NumberFormat("en", { maximumSignificantDigits: 4, notation: Math.abs(n) >= 1e5 ? "compact" : "standard" }).format(n);
export const shortAddress = (value: string) => `${value.slice(0, 6)}…${value.slice(-4)}`;
export const days = (seconds: string) => (Number(seconds) / 86400).toFixed(1);
export const curveProgress = (sold: string) => Math.min(100, Number(sold) / CURVE_SUPPLY * 100);

/** Marginal curve price in quote units per token. reserves(s) = R·s/(4C−3s) ⇒ d/ds = 4RC/(4C−3s)². */
export function curvePrice(sold: string, target: string) {
  const s = Number(sold), R = Number(target), C = CURVE_SUPPLY, d = 4 * C - 3 * s;
  return d <= 0 ? 4 * R / C : R * 4 * C / (d * d);
}
/** Fully diluted value in quote tokens. Graduated markets report the price at which the curve sold out. */
export const fdvQuote = (market: Pick<Market, "sold" | "target" | "graduated">) =>
  curvePrice(market.graduated ? String(CURVE_SUPPLY) : market.sold, market.target) * (TOTAL_SUPPLY / 1e18);

export const relativeTime = (iso: string | number) => {
  const ms = Date.now() - (typeof iso === "number" ? iso : Date.parse(iso));
  if (!Number.isFinite(ms)) return "—";
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s ago`; if (s < 3600) return `${Math.round(s / 60)}m ago`; if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
};
/** Deterministic crop offset so identical engravings read as different portraits. */
export const artOffset = (seed: string) => { let h = 0; for (const c of seed) h = (h * 31 + c.charCodeAt(0)) >>> 0; return ["18% 12%", "50% 8%", "82% 14%", "36% 30%", "64% 26%"][h % 5]; };
