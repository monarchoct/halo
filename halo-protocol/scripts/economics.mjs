#!/usr/bin/env node
/**
 * Unit economics for one HALO agent: what trading volume it must attract to pay for its own
 * compute and gas, and how long it survives when volume decays the way memecoin volume does.
 *
 *   node scripts/economics.mjs [--eth-usd 3000] [--gas-gwei 0.05] [--compute-usd-day 3]
 *        [--fee-bps 100] [--ops-share 0.6] [--attributable 0.7] [--interval-min 15]
 *        [--reward-eth 0.00005] [--volume-day0-usd 50000] [--half-life-days 2]
 *
 * Gas units per action come from the measured local receipts in test-results/action-costs-live.json
 * when present (costWei / 1 gwei, Anvil's default price); otherwise the documented defaults below.
 * Every figure printed is a model, not a forecast. Change one input at a time and watch break-even move.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const arg = (name, fallback) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? Number(process.argv[i + 1]) : fallback; };
const p = {
  ethUsd: arg('eth-usd', 3000), gasGwei: arg('gas-gwei', 0.05), computeUsdDay: arg('compute-usd-day', 3),
  feeBps: arg('fee-bps', 100), opsShare: arg('ops-share', 0.6), attributable: arg('attributable', 0.7),
  intervalMin: arg('interval-min', 15), rewardEth: arg('reward-eth', 0.00005),
  volumeDay0Usd: arg('volume-day0-usd', 50000), halfLifeDays: arg('half-life-days', 2), reserveDays: arg('reserve-days', 30),
};

// Measured gas units by action kind (0 hold, 1 launch, 2 buy, 3 sell). Local Anvil prices at 1 gwei.
const defaults = { 1: 3_750_000, 2: 1_300_000, 3: 1_100_000, 0: 250_000 };
let gasUnits = { ...defaults }, source = 'documented defaults';
try {
  const live = JSON.parse(fs.readFileSync(path.join(root, 'test-results/action-costs-live.json'), 'utf8'));
  const byKind = {};
  for (const r of live.results ?? []) { const units = Number(BigInt(r.gasCostWei) / 1_000_000_000n); if (units > 0) (byKind[r.kind] ??= []).push(units); }
  for (const [kind, list] of Object.entries(byKind)) gasUnits[kind] = Math.round(list.reduce((a, b) => a + b, 0) / list.length);
  if (Object.keys(byKind).length) source = `test-results/action-costs-live.json (${live.results.length} receipts)`;
} catch { /* fall back to defaults */ }

const cyclesPerDay = Math.floor(1440 / p.intervalMin);
// A day's cycle mix: most cycles hold; launches are capped by policy (default 1/day); trades are occasional.
const mix = { 0: cyclesPerDay - 4, 1: 1, 2: 2, 3: 1 };
const gasEthDay = Object.entries(mix).reduce((sum, [kind, n]) => sum + n * gasUnits[kind] * p.gasGwei * 1e-9, 0);
const gasUsdDay = gasEthDay * p.ethUsd;
const rewardUsdDay = cyclesPerDay * p.rewardEth * p.ethUsd;       // what the vault pays operators per day
const operatorCostUsdDay = gasUsdDay + p.computeUsdDay;           // what an operator spends to earn that
const feeTake = p.feeBps / 10_000 * p.opsShare * p.attributable;  // share of volume that reaches operations
const breakEvenVolumeDay = rewardUsdDay / feeTake;

// Volume decay: V(t) = V0 · 2^(-t/halfLife). Reserve drains by (reward − fee income) each day while income < reward.
let reserve = rewardUsdDay * p.reserveDays, day = 0, cumulativeFees = 0, lastPositiveDay = -1;
const rows = [];
while (day < 365 && reserve > 0) {
  const volume = p.volumeDay0Usd * Math.pow(2, -day / p.halfLifeDays);
  const fees = volume * feeTake; cumulativeFees += fees;
  const net = fees - rewardUsdDay; reserve += net;
  if (net >= 0) lastPositiveDay = day;
  if (day < 7 || day % 7 === 0) rows.push({ day, volumeUsd: Math.round(volume), feesUsd: fees.toFixed(2), netUsd: net.toFixed(2), reserveUsd: Math.max(0, reserve).toFixed(2) });
  day++;
}
const lifespanDays = reserve > 0 ? '365+' : day;
const fmt = n => Number(n).toLocaleString('en-US', { maximumFractionDigits: 2 });

console.log(`HALO agent unit economics  (gas source: ${source})\n`);
console.log(`Inputs: ETH $${fmt(p.ethUsd)} · L2 gas ${p.gasGwei} gwei · compute $${p.computeUsdDay}/day · fee ${p.feeBps} bps · ops share ${p.opsShare} · attributable ${p.attributable}`);
console.log(`        interval ${p.intervalMin} min (${cyclesPerDay} cycles/day) · reward ${p.rewardEth} ETH/cycle · reserve ${p.reserveDays} days\n`);
console.log(`Gas units: launch ${fmt(gasUnits[1])} · buy ${fmt(gasUnits[2])} · sell ${fmt(gasUnits[3])} · hold ${fmt(gasUnits[0])}`);
console.log(`Operator side per day:   gas $${fmt(gasUsdDay)} + compute $${fmt(p.computeUsdDay)} = $${fmt(operatorCostUsdDay)}  vs rewards earned $${fmt(rewardUsdDay)}  → operator margin $${fmt(rewardUsdDay - operatorCostUsdDay)}/day`);
console.log(`Vault side per day:      pays $${fmt(rewardUsdDay)} in rewards; operations receive ${(feeTake * 100).toFixed(3)}% of attributable volume`);
console.log(`\nBREAK-EVEN VOLUME: $${fmt(breakEvenVolumeDay)} per day  ($${fmt(breakEvenVolumeDay * 30)} per month) for the vault to fund its own work.\n`);
console.log(`Volume decay scenario: day-0 $${fmt(p.volumeDay0Usd)} halving every ${p.halfLifeDays} days`);
console.table(rows);
console.log(`Last self-funding day: ${lastPositiveDay < 0 ? 'never' : `day ${lastPositiveDay}`} · reserve exhausted: ${reserve > 0 ? 'not within a year' : `day ${day}`} · lifespan ≈ ${lifespanDays} days · cumulative fees $${fmt(cumulativeFees)}`);
if (rewardUsdDay - operatorCostUsdDay < 0) console.log('\n! Operators lose money at this reward: no independent operator will run the agent. Raise the reward or cut compute/gas.');
if (lastPositiveDay < 0) console.log('! The agent never earns its daily reward from fees under this scenario: it lives only as long as its funded reserve.');
