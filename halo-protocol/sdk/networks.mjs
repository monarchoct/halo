import { defineChain } from 'viem';

export const robinhood = defineChain({ id: 4663, name: 'Robinhood Chain',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: ['https://rpc.mainnet.chain.robinhood.com'] } },
  blockExplorers: { default: { name: 'Robinhood Chain Explorer', url: 'https://robinhoodchain.blockscout.com' } },
});
export const robinhoodTestnet = defineChain({ id: 46630, name: 'Robinhood Chain Testnet', testnet: true,
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: ['https://rpc.testnet.chain.robinhood.com'] } },
  blockExplorers: { default: { name: 'Robinhood Testnet Explorer', url: 'https://explorer.testnet.chain.robinhood.com' } },
});

export function assertSupportedDeployment(deployment) {
  const expected = { local: 31337, testnet: 46630, mainnet: 4663 }[deployment.environment];
  if (!expected || deployment.chainId !== expected) throw new Error('HALO deployment must target Robinhood Chain or its local test environment');
  if (deployment.environment === 'local' && !['127.0.0.1', 'localhost', '[::1]'].includes(new URL(deployment.rpcUrl).hostname)) throw new Error('Local development RPC must be loopback');
}
