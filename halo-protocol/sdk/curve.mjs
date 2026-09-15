export const SUPPLY = 1_000_000_000n * 10n ** 18n;
export const CURVE_SUPPLY = SUPPLY * 4n / 5n;
export const LIQUIDITY_SUPPLY = SUPPLY / 5n;
const BPS = 10_000n;
export const ceilDiv = (a, b) => (a + b - 1n) / b;

export function reserves(target, sold) {
  if (target <= 0n || sold < 0n || sold > CURVE_SUPPLY) throw new RangeError('Invalid curve state');
  return ceilDiv(target * sold, 4n * CURVE_SUPPLY - 3n * sold);
}

export function quoteBuy({ target, sold, grossIn, feeBps }) {
  if (sold === CURVE_SUPPLY) throw new RangeError('Curve complete');
  if (grossIn < 0n || feeBps < 25 || feeBps > 200) throw new RangeError('Invalid buy');
  const previous = reserves(target, sold);
  const maxNet = grossIn * (BPS - BigInt(feeBps)) / BPS;
  const budget = previous + maxNet;
  const nextSold = budget >= target ? CURVE_SUPPLY : 4n * CURVE_SUPPLY * budget / (target + 3n * budget);
  if (nextSold <= sold) return { tokensOut: 0n, spent: 0n, fee: 0n, refund: grossIn };
  const net = reserves(target, nextSold) - previous;
  if (net === 0n) return { tokensOut: 0n, spent: 0n, fee: 0n, refund: grossIn };
  const spent = ceilDiv(net * BPS, BPS - BigInt(feeBps));
  return { tokensOut: nextSold - sold, spent, fee: spent - net, refund: grossIn - spent };
}

export function quoteSell({ target, sold, tokensIn, feeBps }) {
  if (sold === CURVE_SUPPLY) throw new RangeError('Curve complete');
  if (tokensIn < 0n || tokensIn > sold || feeBps < 25 || feeBps > 200) throw new RangeError('Invalid sell');
  const gross = reserves(target, sold) - reserves(target, sold - tokensIn);
  const fee = gross * BigInt(feeBps) / BPS;
  return { quoteOut: gross - fee, fee };
}
