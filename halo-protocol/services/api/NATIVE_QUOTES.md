# Native ETH integration adapter

GET /v1/tokens/:address/native-quote?buyer=0x...&amount=10000000000000000&slippageBps=100

Amounts are decimal strings in base units. The quote binds a chain, block hash, buyer, token and configured router. Slippage is 1–2000 basis points, default 100. Quotes expire 120 chain seconds after the quoted block. Intermediate refunds retain their asset denomination, except WETH refunds unwrap to ETH. Fees are included in output; gas is extra.

The response includes route addresses, per-hop outputs, refund amounts, minimumOutput and transaction {chainId,from,to,value,data}. It does not request a signature or broadcast anything. Integrators must independently verify chain/router/recipient/value/calldata, freshness, wallet balance and gas; simulate before requesting the user's signature. Value is a decimal string, so convert to the wallet library's required representation. A reorganization or expired quote requires requoting. The web client can continue calling the contracts directly when this API is unavailable.

Implementation: sdk/native-quote.mjs and services/api/server.mjs. Current local endpoint: http://127.0.0.1:8799 . The API bounds concurrent native quotes to four and returns 429 when busy. Unsupported deployments return 503; malformed inputs return 400. It is not a production internet rate-limit or abuse-protection system.

Seven native lifecycle scenarios pass, including generating the SDK/API transaction and actually executing its calldata against ETH-backed WETH, curves and v4 pools on disposable Anvil. Test record: test-results/native-buy.json. Public service GET was also verified on the existing local preview. No Axiom, GMGN or other external platform acceptance is claimed. API-to-wallet signing through a third-party terminal remains outstanding.

The current router follows the complete HALO ancestry. It does not yet implement the owner's exact optional two-hop child shortcut or an ETH sell route. Custom-curve and custom-hook integration review is still required at each external routing provider.

For submission, estimate the exact unsigned transaction and apply the shared sdk/transaction-gas.mjs headroom before asking the wallet to sign. New-block observation writes can increase gas relative to simulation. Requote if the deadline has elapsed; never widen slippage automatically. npm run test:native-buy-fork exercises the integration against a disposable fork of the verified Robinhood PoolManager, with no public transactions.

