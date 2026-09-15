# HALO — Project brief

Updated: 13 September 2026  
Status: Founder-confirmed product direction; implementation decisions remain open.

## What HALO is

HALO is the platform where people create and launch their own autonomous AI agents. Every agent has an associated token paired with $HALO. Agents can independently create additional coins, each paired with that agent's token.

HALO combines agent creation, autonomous operation, discovery and transparent performance tracking. Users connect a wallet on the website to create and activate agents/tokens. Trading happens mainly on external launchpads and exchanges. The delivery target is a working system that people can use to deploy their own agents.

## Confirmed requirements

| Area | Founder decision |
| --- | --- |
| Agent creation | People launch their own agents on HALO. |
| Platform asset | $HALO connects the agent economies. |
| Agent asset | Every agent has its own token, paired with $HALO. |
| Child assets | Coins created by an agent are paired with its agent token. |
| Holder proposition | Market exposure: HALO to the network; an agent token to that agent's ecosystem; a child token to an individual creation. |
| Trading fees | Include fees comparable to PONS; exact rates and recipients remain to be specified. |
| Networks | Robinhood Chain and Solana are the primary targets. |
| Infrastructure | Reuse existing bonding-curve platforms: Pump.fun, PONS, “stonk” and “long” are named candidates. Exact Long/Stonk projects and integration compatibility remain unverified. |
| Website wallet use | Connect for creation and activation; trading mainly happens elsewhere. |
| Autonomy | Agents may publish, launch and transact without human approval for each action. |
| Decentralization | Nobody, including the creator or HALO team, should have a discretionary pause control after activation. Hosting, signing and dependency design must support that goal. |
| Access | Anyone can launch; intended audience is everyone, without a HALO approval queue. External-service availability must be checked separately. |
| Transparency | Public agent activity, wallet activity, launches, economics and performance. Credentials remain secret. |
| Reputation | Credibility comes from managing coins well, making profit and the performance of coins the agent launches. |
| Model training | Use the founder's RTX 5090 to specialize small models for individual tasks. |
| Model modularity | Users can supply compatible models or adapters; model choice should not require rewriting HALO. |
| Runtime funding | Aim to pay compute and operating expenses from coin fees and realized profits, with initial funding and measurable runway. |
| Hosting | Target decentralized cloud operation with independently recoverable workers. |
| Marketing | Promote automated memecoin deployment as a fast opportunity. Speed and automation are product claims; profits remain outcomes to measure. |
| Delivery scope | A complete working system for public agent deployment, beyond a concept demo. |
| Visual direction | Hermes Agent is the aesthetic and atmosphere reference. |
| Functional direction | PONS is the feature and layout reference. |

These decisions supersede the corresponding unanswered questions in the earlier PDF and earlier drafts of this brief. An ongoing human approval queue, a creator pause button and a full exchange inside HALO are not required product features.

## Economic hierarchy

```text
$HALO
  |
  +-- $FRED / $HALO
  |     +-- $DOG / $FRED
  |     +-- $CAT / $FRED
  |     +-- $FROG / $FRED
  |
  +-- Another agent token / $HALO
        +-- Its creations / its agent token
```

The founder's intended effect is that demand for a child coin creates demand for its parent asset, and agent-level activity connects back to HALO.

### Translate that intent into an explicit trading route

An illustrative purchase starting outside the ecosystem could follow:

```text
Entry asset -> $HALO -> $FRED -> $DOG
```

The entry asset, router and supported markets are not selected. Each step requires an available trading venue and quote. Because trading mainly happens externally, the actual route is controlled by those venues and their routers; HALO cannot make every external trade follow this route through website design alone.

Technical interpretation: a buyer who already holds $FRED can exchange it directly for $DOG without making a fresh $FRED purchase. Pairing establishes the exchange asset; routing determines whether upstream purchases occur. Spending $FRED into the child market is not itself a buy in the $FRED / $HALO market. This distinction follows from swap mechanics. [Uniswap swap documentation](https://developers.uniswap.org/docs/get-started/concepts/traders/swaps)

Describe the proposition as market exposure through interconnected markets. No equity, redemption claim on all child assets, automatic fee entitlement or guaranteed price increase has been specified. Buying $DOG does not leave the buyer holding both $DOG and the $FRED spent to acquire it.

## Required end-to-end journey

The following translates the confirmed direction into proposed acceptance criteria:

1. A user connects a wallet and defines an agent's identity, niche and behavior.
2. The user establishes the agent's execution funding and deployment configuration.
3. Deployment creates or registers the agent and its token, with the required $HALO pairing.
4. The agent becomes discoverable and starts operating autonomously.
5. It can create and launch a child coin paired with its own token, without a human approving that individual launch.
6. Users can inspect the parent relationship, discover creations and follow verified links to trade on external venues.
7. Trading fees accrue and reach the recipients defined by the chosen economics.
8. Agent activity, transaction outcomes and operational state remain visible after a page reload or runtime restart.

All core steps need real integrations for the requested working system. The runtime and launch integrations continue to function when the creator closes the HALO website.

## Performance and transparency

Proposed reputation measures: realized trading profit, unrealized position value, creator-fee revenue, operating costs, drawdown, launch count and child-coin performance over declared periods. Keep these measures separate: a fee-earning agent does not necessarily have profitable holders.

Use public wallet addresses and transaction links, include failed launches and losing positions, and identify the price source and valuation timestamp. Deposits are funding, not revenue. Do not infer profit from market cap alone. Private keys, API credentials and signing secrets are excluded from public logs.

## Marketing direction

The founder wants a bold, opportunity-led campaign around automated memecoin deployment and fast participation. Suggested public line: **“Deploy your own memecoin agent. Let it launch. Follow every move.”**

Support the campaign with live launches and verifiable performance. “Quick money” is the desired audience appeal, not an established return characteristic. Avoid promises of guaranteed income, effortless profit or a profitable outcome for every participant.

## Runtime recommendation

Use a self-hostable Hermes-based agent worker as the starting engine, with a dedicated HALO execution layer, public activity records and separate Robinhood Chain/Solana adapters. This is a technical recommendation, not a founder-selected dependency. See `HALO_TECHNICAL_APPROACH.md` for the overall architecture and `HALO_AGENT_FRAMEWORK.md` for specialist training, user-supplied models, cloud operation and fee-to-compute funding.

## Decisions still needed

- Exact links and intended versions for “long” and “stonk,” and which launch protocol serves each target chain.
- Whether the selected protocol permits every newly created agent token to become a child coin's pairing asset without an operator approving it.
- Trading and launch fees, fee recipients, any holder distributions and operating-cost allocation.
- Execution operators, automated signing design and the funding model for inference, hosting and gas.
- Supply, initial pricing, pool or curve parameters and the source of real trading liquidity.
- Whether external venues can support the required parent pairs throughout the launch lifecycle.
- How $HALO is represented across the two chains: supply, canonical identity and any bridge. Separate tickers on separate chains do not establish one shared asset.
- What happens when an agent exhausts its funds or its execution provider becomes unavailable.
- How to prevent discretionary shutdown or strategy replacement through operator keys, runtime configuration or dependencies after activation.
- Team, budget, delivery milestones and production acceptance criteria.

## Design handoff

Read `HALO_HERMES_AESTHETIC_REFERENCE.md` for the visual direction and `HALO_PONS_FEATURE_LAYOUT_REFERENCE.md` for the application structure. Both distinguish observed reference details from proposed HALO adaptations.

Hermes is the selected visual reference and is now also recommended as a runtime starting point in response to the founder's technical question. Adopting its runtime remains a design recommendation to validate.

## Basis

- Founder clarifications in this conversation, 13 September 2026: primary source for product requirements.
- Original `HALO_Agent_Economy_Concept.pdf`: background for the agent economy and hierarchy.
- [Hermes Agent](https://hermes-agent.nousresearch.com/): requested aesthetic reference.
- [PONS launchpad](https://www.ponsfamily.com/launchpad): requested feature and layout reference.
