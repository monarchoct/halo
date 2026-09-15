# HALO on Robinhood Chain testnet (chain 46630)

The exact steps from this repository to a running public testnet slice. Everything here uses test assets; nothing has mainnet value.

## 1. Test ETH

Chain 46630 is an Arbitrum Orbit chain settling to Sepolia; ETH is the gas token.

- Faucet: https://faucet.testnet.chain.robinhood.com (wallet address only; also hands out simulated stock tokens). Reported by a third-party guide — confirm on first use.
- Fallback: get Sepolia ETH (Alchemy, QuickNode or Chainlink faucets) and bridge with https://portal.arbitrum.io/bridge?sourceChain=sepolia&destinationChain=robinhood-chain-testnet
- RPC `https://rpc.testnet.chain.robinhood.com` · explorer `https://explorer.testnet.chain.robinhood.com`

Fund a **deployer** wallet and at least one **operator** wallet. Keep them separate; the deployer key is used once.

## 2. Test HALO and reference market

HALO's root token is supplied outside the protocol. On testnet, deploy a test ERC-20 as the root token (`HaloToken` works: `constructor(name, symbol, initialHolder)`) and use the testnet WETH `0x7943e237c7F95DA44E0301572D358911207852Fa` as the operating token (verify on the explorer). Record both addresses.

## 3. Configuration

Copy `config.example.json` to `config.json` and fill in the addresses. `poolManagerCodeHash` is optional; when present the deploy refuses to continue if the on-chain PoolManager differs from the reviewed bytecode. The mainnet manager `0x8366a39cc670b4001a1121b8f6a443a643e40951` is reported to exist at the same address on testnet — verify the address and record its code hash before relying on it.

`referenceSqrtPriceX96` initialises the HALO/operating reference pool at that price (Q64.96 of `sqrt(token1/token0)`, ordered by address). Leave it out to initialise later.

## 4. Rehearse locally, then deploy

```bash
# rehearsal against the disposable local chain (dev stack must be running on 8545)
HALO_DEPLOYER_KEY=<anvil key> node scripts/deploy-public.mjs deploy/local/config.json

# public testnet
HALO_DEPLOYER_KEY=<deployer key> node scripts/deploy-public.mjs deploy/testnet/config.json --dry-run
HALO_DEPLOYER_KEY=<deployer key> node scripts/deploy-public.mjs deploy/testnet/config.json
```

The script writes `deploy/testnet/deployment.json` (the website's shape) and `deployment-report.json` with every transaction hash and the verified code hashes. It refuses to continue if the chain id, PoolManager or token code do not match the configuration, and if the deployed Halo2 verifier's code hash differs from the pinned artifact.

## 5. Liquidity, services, agents

1. Add liquidity to the reference pool through Uniswap (the pool key is in the report). `FeeSettlementRouter` only converts fees when the pool has at least `minimumDepthWei` of depth.
2. Copy `deployment.json` to `halo-web/public/deployment.json` and start the services with it: `services/api/cli.mjs`, the history service with a PostgreSQL journal, the operations service, and the relays (set the fan-out bus to PostgreSQL when running more than one instance).
3. Create an agent through the website, fund it and activate it. Start an operator with `runtime/cli.mjs` and its own funded wallet.
4. Leave it running for seven days; drill the failures listed in `HALO_GO_LIVE_AND_SCALE.md`.
