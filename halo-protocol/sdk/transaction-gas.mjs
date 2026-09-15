/** Observations can open a new storage slot between estimation and the mined block. Unused gas is not charged. */
export const gasWithHeadroom = estimate => (BigInt(estimate) * 125n + 99n) / 100n + 100_000n;
