import assert from 'node:assert/strict';
import { CURVE_SUPPLY as C, SUPPLY, LIQUIDITY_SUPPLY, reserves, quoteBuy, quoteSell } from '../sdk/curve.mjs';

assert.equal(C + LIQUIDITY_SUPPLY, SUPPLY);
let count = 0;
let seed = 73471n;
function random() { seed = (seed * 48271n) % 2147483647n; return seed; }
for (const target of [1_000_000n, 1_000_001n, 10n ** 24n + 7n, 10n ** 36n]) {
  assert.equal(reserves(target, 0n), 0n);
  assert.equal(reserves(target, C), target);
  for (const feeBps of [25, 100, 200]) {
    let sold = 0n;
    let reserveBalance = 0n;
    for (let step = 0; step < 1000; step++) {
      if (sold === C) break;
      if (sold && random() % 3n === 0n) {
        const tokensIn = sold * (random() % 100n + 1n) / 101n;
        const q = quoteSell({ target, sold, tokensIn, feeBps });
        sold -= tokensIn;
        reserveBalance -= q.quoteOut + q.fee;
      } else {
        const grossIn = target * (random() % 10n + 1n) / 1000n;
        const q = quoteBuy({ target, sold, grossIn, feeBps });
        assert(q.spent <= grossIn && q.refund >= 0n);
        // Contracts reject zero-cost dust trades; model simulation does the same.
        if (q.spent > 0n && q.tokensOut > 0n) {
          reserveBalance += q.spent - q.fee;
          sold += q.tokensOut;
        }
      }
      assert.equal(reserveBalance, reserves(target, sold));
      assert(reserveBalance >= 0n && sold >= 0n && sold <= C);
      count++;
    }
    if (sold < C) {
      const fill = quoteBuy({ target, sold, grossIn: 2n * target, feeBps });
      assert.equal(sold + fill.tokensOut, C);
      assert.equal(reserveBalance + fill.spent - fill.fee, target);
      assert(fill.refund > 0n);
    }
  }
}
console.log(`PASS curve accounting: ${count} seeded mixed buy/sell steps, four target scales, three fee rates`);
