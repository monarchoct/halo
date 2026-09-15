import assert from 'node:assert/strict';
import { keccak256 } from 'viem';

/** Read-only upstream discovery. Callers must execute exclusively on startChain's loopback Anvil. */
export async function robinhoodForkConfig() {
  const forkUrl = process.env.ROBINHOOD_RPC_URL ?? 'https://rpc.mainnet.chain.robinhood.com';
  const manager = '0x8366a39cc670b4001a1121b8f6a443a643e40951';
  async function read(method, params = []) {
    const response = await fetch(forkUrl, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }), signal: AbortSignal.timeout(20000) });
    if (!response.ok) throw new Error(`Robinhood read-only RPC HTTP ${response.status}`);
    const value = await response.json();
    if (value.error) throw new Error(JSON.stringify(value.error));
    return value.result;
  }
  assert.equal(await read('eth_chainId'), '0x1237');
  const block = await read('eth_getBlockByNumber', ['latest', false]);
  const code = await read('eth_getCode', [manager, block.number]);
  assert(code.length > 2, 'Official PoolManager has no code');
  const poolManagerCodeHash = keccak256(code);
  assert.equal(poolManagerCodeHash, '0xbd3881180b547f5fe817545743cfb4343e96b1bc6640dcd70c106b0066e95626', 'Review changed official PoolManager code before testing');
  return { forkUrl, forkBlock: BigInt(block.number), manager,
    evidence: { upstreamChain: 4663, localExecutionChain: 31337, forkBlock: String(BigInt(block.number)),
      blockHash: block.hash, poolManager: manager, poolManagerCodeHash, mainnetTransactions: 0 } };
}
