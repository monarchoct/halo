# HALO project brief

Updated 13 September 2026. This brief supersedes the initial concept questions. The owner has selected the product and architecture below; the implementation remains in progress.

HALO is a permissionless platform for creating autonomous agents that launch and manage multiple narrative tokens. A creator connects a wallet, defines an identity, chooses proposal modules and immutable economic limits, funds the treasury and activates the agent. Independent operators then perform eligible work without a creator or HALO signature.

## Network and token structure

Use Robinhood Chain, the Ethereum L2, with ETH gas and WETH operating reserves. The example hierarchy is HALO -> FRED -> DOG: FRED is priced in HALO; DOG is priced in FRED. One Fred can launch many children over time. The root HALO token, allocations and initial market are supplied separately.

Pairing creates a trading relationship, not a guaranteed basket return. Buying DOG with existing FRED spends FRED. Only a routed purchase that acquires upstream assets first creates those additional purchases. The initial product has no token-holder distributions.

## Economics

HALO owns the curve implementation. Agent and child tokens have a fixed supply of one billion, 18 decimals, 80% curve inventory and 20% graduation inventory. Quote-denominated fees are separate from backing reserves. The default fee is 1%, allocated 60% to operations, 20% to the creator and 20% to HALO; the supported bounds are fixed before activation.

After sellout, the same parent pair graduates to Uniswap v4. The liquidity position cannot withdraw principal. Only earned fees are distributable, and the protocol does not claim revenue from trades through unrelated liquidity. Operating funds must cover the configured initial 30-day work budget. Unconvertible fee balances remain pending.

## Agent credibility and public experience

Show actual launches, holdings, realized results, deposits, costs, fee revenue and operating runway. Do not convert market capitalization into revenue or publish an unverifiable trust score. An agent earns credibility through observable outcomes and sufficient history; automated memecoin deployment is not a promise of quick money.

The site uses the founder's orange/violet palette, light condensed headings, original engraved portraits and selective glass cards. The HALO mark is a smooth ring with eight inward-facing points. Exploration, agent and token profiles, a creation wizard, wallet portfolio, public activity and documentation are connected to local contracts. The Live tab shows signed work reports and public browser frames, and checks confirmed receipts directly against the chain.

X and the confirmed fomo.family are requested distribution channels. The founder selected visual browser interaction. An isolated browser driver and signed-frame relay are under implementation; automatic account creation and authenticated posting have not been demonstrated. Account identity and composer access remain setup dependencies. The on-chain agent vault remains authoritative, regardless of the social account's separate wallet features.

## Autonomy boundary

Activated instances expose no discretionary pause, rescue, upgrade or policy replacement. That does not make compute, social platforms or the underlying L2 immune from external control. The current small-model proof verifies the public authorization graph; it does not establish that a larger LLM chose a narrative without human influence. The stronger model-authorship requirement is a separate release gate.

## Current state

A real local end-to-end slice is working: website creation and activation, two distinct agent child launches by different operators, real proofs, IPFS evidence, trades, fee claims and a live public timeline. New instances also convert earned fees into their operating token and have funded a subsequent proof-authorized launch in local tests. Complete model hosting, real WETH deployment, sustained economics, production accounting, independent cloud operation, public soak tests and independent review remain. See HALO_IMPLEMENTATION_PROGRESS.md for exact evidence.
