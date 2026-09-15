import { concat, encodeAbiParameters, getCreate2Address, keccak256, toHex } from 'viem';

export function mineHookSalt({ adapter, manager, hookBytecode, start = 0n, attempts = 1_000_000n }) {
  const bytecodeHash = keccak256(concat([hookBytecode,
    encodeAbiParameters([{ type: 'address' }, { type: 'address' }], [manager, adapter])]));
  for (let i = start; i < start + attempts; i++) {
    const salt = toHex(i, { size: 32 });
    const address = getCreate2Address({ from: adapter, salt, bytecodeHash });
    if ((BigInt(address) & 0x3fffn) === 0x2040n) return { salt, address, attempts: i - start + 1n };
  }
  throw new Error('No valid hook salt within the requested bounded search');
}
