# HALO — External terminal ETH routing requirement

Updated 2026-09-13 following the owner's clarification. This requirement supersedes the assumption that every child purchase must traverse HALO.

## Required experience

- Agent coin: ETH → HALO → agent coin, in one transaction.
- Child coin: ETH → agent coin → child coin, in one transaction.
- Users should be able to initiate this from external terminals, including Axiom and GMGN where supported, without first visiting HALO or manually acquiring parent assets.

## Current evidence and missing work

The current local NativeBuyRouter follows the full ancestry: ETH/WETH → HALO → agent → child. It satisfies the agent route, but NOT the requested two-swap child shortcut. Local website quotes are not evidence of external-terminal compatibility.

Skipping HALO in the child route requires funded WETH/agent liquidity (or a quote provider willing to supply the agent token against ETH). The existing agent/HALO pair cannot independently perform an ETH/agent trade. A facade that internally traverses HALO would simplify the interface but would not change the economic route.

An ordinary child/agent pool accepts the agent quote asset. A terminal router can acquire that asset and trade atomically. Publishing a custom router does not make terminals discover or invoke it. Before graduation, the custom curve needs a supported integration/adapter; after graduation, canonical Uniswap pools still require route discovery, supported hooks and sufficient liquidity.

Implementation remaining: determine how ETH/agent liquidity is funded and locked without altering activated instances; implement and test shortcut routing; publish integration ABI/SDK and indexing metadata; verify native ETH quote and transaction construction in each target terminal on Robinhood; only mark supported after actual venue acceptance. No liquidity spending or external integration request has been sent.

## Primary references checked

- Axiom's interface displays a Robinhood chain selector: https://axiom.trade/exp?chain=sol
- GMGN published trading API documentation describes route discovery and simulation but does not establish HALO custom-curve or Robinhood support: https://docs.gmgn.ai/index/cooperation-api-integrate-gmgn-eth-base-bsc-trading-api
- Uniswap explains arbitrary pair routing as a higher-layer responsibility: https://docs.uniswap.org/whitepaper.pdf

## Hosting

Current preview and backing test chain run on the owner's Windows PC. The Linux lab is a VM on that same PC, not an independent cloud host. No public production domain or paid cloud deployment exists. Akash remains a planned production provider, not a live deployment.

## Verified follow-up — PONS / Long terminal behavior

Checked 2026-09-13. Earlier GMGN chain uncertainty is superseded: GMGN's own newer blog confirms Robinhood trading (https://gmgn.ai/blog/how-to-buy-new-robinhood-chain-launches/). Its public market CLI also lists robinhood (https://github.com/GMGNAI/gmgn-skills/blob/main/skills/gmgn-market/SKILL.md). Older API pages were incomplete evidence.

PONS v2 explicitly has a separate curve before graduation, accepting its configured quote token; custom-pair buys send no native value. Graduated markets are ordinary v4 pools. Source: https://docs.ponsfamily.com/v2 . Therefore an ETH purchase into a custom pair must acquire the quote asset upstream; the custom pool does not itself treat ETH as its other currency.

There is concrete integration evidence: 0x lists Pons V2 bonding curve among supported Robinhood liquidity sources, alongside Uniswap v2/v3/v4: https://docs.0x.org/changelog/2026/7/31 . This proves an aggregator integrated the custom curve. It does not prove Axiom or GMGN use 0x internally. 0x separately publishes DEX and custom-hook integration requests, with review rather than automatic acceptance: https://docs.0x.org/liquidity-integration/liquidity-integrations .

Long's actual site lists SIT anchored to AI; AI is itself listed anchored to NVDA. SIT: 0x89da5167eb1a0067f9b3e39a544ef8d4b9c41e18 . Source inspected in browser: https://app.long.xyz/tokens/0x89da5167eb1a0067f9b3e39a544ef8d4b9c41e18 . Its Trade on Matcha Meta DEX link sets chainId=4663, sellToken=native ETH, buyToken=SIT.

An unsigned 0.01 ETH quote on that linked Matcha page returned ~14,355.2631 SIT via several aggregators; selecting 0x returned ~14,018.4873 SIT and the page reported a matching simulation. No wallet was connected and no transaction was signed. These are time-specific UI observations, not audited execution traces. The visible page did not expose intermediate pools, so do not claim that the actual route was exactly ETH→AI→SIT; NVDA or another market may have been traversed internally.

Engineering implication: external ETH buying is feasible for nested pairs through integrated liquidity routes. A direct ETH/agent pool is required only if skipping HALO is an exact economic-path requirement, not merely a simplified user-facing display. Do not add costly duplicate liquidity just to simplify the payment UI. The current all-ancestor HALO router already provides the latter experience locally. For terminal compatibility, package the custom curve's quote/execution interface and integration metadata; validate real external quotes for both pre-graduation curves and graduated hooked pools. Do not spoof Long/PONS identities, factories or fee recipients to acquire their badges.

Still unverified: Axiom/GMGN's exact private route implementation for specific PONS/Long custom-pair trades, their HALO onboarding requirements, and which intermediate pools the inspected Long quote used.
