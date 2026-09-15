# HALO — PONS feature and layout reference

Primary reference: [PONS launchpad](https://www.ponsfamily.com/launchpad)  
Inspected: 13 September 2026  
Purpose: Document useful marketplace patterns and map them to HALO's agent launch platform.  
Current scope: Robinhood Chain first; Solana deferred. This document is a functional reference. The orange/violet HALO_DESIGN_SYSTEM.md governs the visual implementation.

## Inspection scope

Inspected the live desktop Explore page, launch form, advanced options, pairing selector, a graduated token detail page and public documentation. No wallet was connected, no form was submitted and no transaction was executed. Wallet-connected flows and mobile behavior remain unverified.

The web reader received a regional restriction page for some URLs; the normal local browser loaded the public pages. The app also displayed a backend performance notice, so displayed market figures were treated as interface examples, not validated analytics.

## Observed layout and features

### Explore

The header includes product navigation, a theme toggle and wallet connection. Below it sits a wide search field with paired-asset browsing and a creation action. A highlighted graduated collection appears above active launches. Desktop cards form a five-column grid with image, name, ticker, capitalization, address, timing and lifecycle badges. Active cards include graduation progress. Controls sort by buying activity, chronology, capitalization or volume; age filters and pagination narrow results. A footer links to product, profile and documentation pages. [Explore source](https://www.ponsfamily.com/launchpad)

### Create

A version selector and back action precede a two-column workspace: form left, token preview and economics right. Fields cover identity, image, description, social accounts, pairing asset and optional opening purchase. The pairing menu exposes ETH and other assets. Advanced settings expose payout wallet, creator tax, holder fee sharing and opening-tax exemptions. The preview displays launch cost, trading fee, pairing, graduation and liquidity status. The observed ETH configuration showed a 0.0005 ETH launch fee and 1.00% trade fee; these are reference values. [Create source](https://www.ponsfamily.com/launchpad/create)

### Token detail

The inspected page begins with metadata, pairing, supply, address and social links. Separate panels show creator earnings, claimable balances and holder-sharing information. Below them, a narrow swap panel sits left of a larger chart and metric panel. The chart has time-range controls. Recent trades and holders appear in tabs below; trade entries link to transactions and wallets. Connection gates wallet-specific actions. [Inspected token page](https://www.ponsfamily.com/launchpad/0x07EBB29a38Fbcb41563817e5E19f2ceC619C90D2)

### Version and mechanics notes

The v1 docs describe immediate WETH pools. [V1 documentation](https://docs.ponsfamily.com/)

V2 instead describes a curve followed by a permanently locked Uniswap v4 pool. Custom quote assets require protocol approval. Standard fees and an optional creator tax are distinct; payouts use the quote asset. Some operations retain owner or operator permissions. The docs describe launch gates that must be checked rather than assumed open. [V2 documentation](https://docs.ponsfamily.com/v2)

There is a visible configuration discrepancy: the creation UI showed a three-second opening-tax window while the v2 documentation described five seconds. Treat launch settings as versioned, live configuration. Read deployed terms before implementing or quoting them; do not mix versions. [Create UI](https://www.ponsfamily.com/launchpad/create), [V2 opening-tax documentation](https://docs.ponsfamily.com/v2#snipe-protection)

## HALO adaptation — proposed

The following is a HALO product proposal informed by the inspection and founder requirements. It does not claim these agent features exist in PONS. PONS's embedded swap interface is documented as an observed feature; HALO should prioritize deployment, discovery, performance and outbound trading links.

### Application navigation

Use **Explore**, **Agents**, **Activity**, **My agents** and **Docs**, with persistent **Deploy agent** and **Connect wallet** actions. Analytics can be a dedicated page or part of Activity. A forum is an optional later product decision.

Suggested routes are implementation proposals:

| Route | Purpose |
| --- | --- |
| `/` | Explain HALO and lead to deployment or discovery |
| `/explore` | Search agents and their creations |
| `/agents/new` | Configure and deploy an agent |
| `/agents/:id` | Agent identity, token market and child ecosystem |
| `/coins/:chain/:address` | Individual creation, performance and external trading links |
| `/activity` | Network events and market activity |
| `/my-agents` | Connected creator's agents and operating balances |
| `/docs` | Launch, pairing, autonomy and fee explanations |

### Marketplace layout

```text
HALO | Explore | Agents | Activity | My agents | Deploy agent | Wallet

Search agents, names, tickers or addresses        Chain / parent / niche filters
Agents / Creations                              Sort + age controls

Selected or active agents                       Agent card grid
Recent creations                                Child-token card grid
Pagination                                      Data freshness
```

Use a card's parent identity as a navigation link. A $DOG result must say “Created by Fred” and show `$DOG / $FRED`. An agent card must show `$FRED / $HALO`.

Proposed agent-card fields: avatar, name, ticker, chain, niche, operating state, measured profit, creation count and last agent action. Child cards use coin identity, parent agent, pair, market metrics and deployment time. Only show graduation when the selected protocol has that lifecycle.

Define time windows and units for every metric. Keep missing data distinguishable from zero and identify delayed updates.

### Agent deployment flow

Retain a form-and-preview arrangement, with HALO-specific stages:

1. **Identity:** name, ticker, avatar, description and niche.
2. **Behavior:** objectives, persona, enabled tools and connected publishing channels.
3. **Operation:** network, launch protocol, execution configuration, agent wallet and operating funding; keep provider internals behind clear defaults where possible.
4. **Economics:** agent-token launch terms, `$HALO` pairing and child-pair relationship.
5. **Deploy:** show the complete selected configuration, user setup transactions and progress.

Preview the agent card, token pair, fee recipients and estimated setup costs throughout. Human setup and wallet authorization establish the user's agent; routine agent decisions after deployment require no human approval under the founder's requirement. Do not insert a moderation or manual launch approval stage. After activation, the product must not offer a creator or HALO-admin pause control. Anyone can launch; an external protocol's access restrictions must be exposed as compatibility constraints.

### Agent detail page

```text
Agent identity | $FRED / $HALO | runtime state | creator | public links
Token metrics | chart | external trading links
Creations | autonomous activity | operating funds | fee information
Child-token grid with external venue and internal detail links
```

The agent's ongoing activity should be visible beside its market. Show actions and transaction results, with failed or pending actions distinguished from completed ones. Avoid presenting an active token market as proof that its agent runtime is online. Reputation should expose realized profit, unrealized value, fee earnings, costs and child-coin results separately, with losing periods included.

### Child-token detail page

Show the relationship `HALO / Fred / DOG` above the title. Keep a **Trade on [venue]** action near the chart; retain chain, address, parent, quote asset and launch terms. Place recent trades, holders and agent-created content in separate views. Resolve outbound links from verified chain/address records.

The external venue provides transaction quoting and execution. HALO can explain the pair and link to its market; it must not claim every external purchase traverses HALO and the agent token. See the economic interpretation in `HALO_PROJECT_BRIEF.md`. Embedded swaps are optional future scope, not part of the current primary journey.

### Fees

Fees comparable to PONS are a founder requirement. HALO's final percentage and distribution are open decisions. Record these independently:

| Parameter | HALO status |
| --- | --- |
| Agent deployment fee | To decide |
| Child-token launch fee | To decide |
| Base trading fee | To decide; inspected reference configuration shows 1.00% |
| Additional creator fee or tax | To decide whether supported |
| Agent creator / agent wallet / HALO shares | To decide |
| Holder fee distributions | Not confirmed |
| Fee asset and claiming mechanism | Depends on selected protocol and HALO policy |
| Multiple-hop cost | Must account for each executed venue and any additional charge |

Use the economics actually returned by the chosen protocol. Show setup cost and recipient rules before deployment; show sourced fee information beside external trading links. Trading elsewhere means a website-only trading fee cannot capture all activity: revenue must use supported onchain fee routing or another explicitly chosen mechanism. Do not silently copy PONS fee distributions, holder sharing or buybacks into HALO's requirements.

## Integration implications

HALO needs unrestricted creation of new agent economies and automated child launches. A protocol with an operator-approved quote-asset list may not support that requirement as deployed. This is an integration question to resolve before selection, not a reason to add human approval to HALO's product flow.

Pump.fun, PONS, “long” and “stonk” are founder-named candidates. Obtain exact Long/Stonk URLs and verify all relevant deployments before asserting support. See `HALO_TECHNICAL_APPROACH.md` for protocol compatibility and runtime recommendations. Verify:

- New agent tokens can serve as quote assets for child launches.
- Agents can invoke deployment and trading through supported contracts or APIs.
- Pair relationships survive any launch lifecycle transition.
- Fee recipients and operating funding can follow HALO's chosen policy.
- Required protocol permissions are compatible with the decentralization requirement.
- The interface can index deployments, agent relationships, swaps and fees reliably.

## Visual combination

Use the screen organization above with the HALO direction in `HALO_HERMES_AESTHETIC_REFERENCE.md`: electric blue, condensed titles, original halo imagery and readable paper-colored market panels.

PONS supplies functional reference patterns. HALO's distinguishing product elements are the agent runtime, the creator-to-creation relationship and the three-layer market structure.

## Completion criteria for the eventual product

- A user can deploy an agent and discover it in the marketplace.
- Its token is paired with HALO; its autonomous child launch is paired with that token.
- Parent and child pages link correctly in both directions.
- Fees, performance and deployment states use live protocol data; external trading links resolve to the correct asset and chain.
- Agents operate without approval for each action after setup.
- Wallet, insufficient-funds, unavailable-runtime and delayed-data states are usable; there is no post-activation admin pause control.
- Desktop and mobile workflows complete with real integrations.

These are proposed build acceptance criteria. This Markdown deliverable documents the intended system; it does not claim the system has been built.
