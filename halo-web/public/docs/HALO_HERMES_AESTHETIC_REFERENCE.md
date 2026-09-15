# HALO — Hermes aesthetic reference

> Latest founder update, 13 September 2026: use the supplied orange/violet palette and renewed Hermes/Eliza inspiration with an original inward-pointed HALO ring. HALO_DESIGN_SYSTEM.md supersedes earlier green and blue proposals below. Those observations remain reference history.

Reference: [Hermes Agent](https://hermes-agent.nousresearch.com/)  
Inspected: 13 September 2026  
Purpose: Translate the reference's visual character into a usable HALO design direction.  
Current engineering scope: Robinhood Chain first; Solana and bridging deferred. Creation on HALO, trading mainly elsewhere.

## Observed reference

Desktop inspection showed an electric-blue opening, off-white text, a tall condensed headline on the left and large mythological artwork on the right. Metallic figures, radial geometry and grain give it an esoteric, technical character. The navigation surrounds a central identity; CTAs are compact rectangles.

Lower sections transition to off-white with blue text. Three-column compositions use numbered labels, compressed headings and textured monochrome illustrations. A pinned navigation remains available while scrolling.

Computed styles exposed blue `#0000F2` and off-white `#F2F2F2`. The desktop hero used Rules Gothic Condensed at approximately 105px, weight 200 and -2.1px tracking. Other headings used Rules Gothic Compressed; body and controls referenced Rules Variable and Rules Condensed. These are observed family names, not bundled font assets. [Source](https://hermes-agent.nousresearch.com/)

## HALO creative direction — proposed

HALO should feel like an autonomous digital civilization with a live economy. Its identity should carry agent portraits, deployment flows, ecosystem pages and transparent performance records.

Use three visual ideas:

- **The halo:** a luminous ring that marks the platform and connects agent identities.
- **The creator:** an individual portrait or emblem for each agent.
- **The constellation:** smaller creation tokens arranged around their parent agent, with clear paths back to HALO.

Commission or generate original HALO imagery around those ideas. The reference provides the mood; HALO needs its own symbols, portraits and compositions.

## Proposed design tokens

Values below are HALO starting choices, not a complete extraction of the reference stylesheet.

| Role | Starting choice | Use |
| --- | --- | --- |
| Brand blue | `#0000F2` | Brand areas, primary actions, active navigation |
| Paper | `#F2F2F2` | App background and reversed text |
| Surface | `#FFFFFF` | Forms, charts and performance panels |
| Ink | `#11112B` | Body copy and financial values |
| Muted ink | `#626278` | Secondary labels |
| Divider | `#DADAE7` | Table rules and panel boundaries |
| Deep blue | `#08083A` | Selected dark panels and image depth |
| Positive / negative | `#16824B` / `#BD3447` | Market movement with explicit signs and labels |
| Space scale | 4, 8, 12, 16, 24, 32, 48, 72, 96px | Consistent rhythm |
| Corners | 2–6px brand controls; 8–12px app panels | Strong identity with practical controls |

Use blue for identity and selection. Market movement should remain independently legible with a sign, number and label.

## Typography

- Hero: very narrow display face, light weight, approximately 80–112px on wide screens and 44–60px on phones.
- Page and section titles: condensed display face, approximately 40–64px.
- Navigation and small section labels: condensed uppercase, approximately 12–14px with deliberate tracking.
- Body and forms: readable sans serif, 15–17px with comfortable line height.
- Prices, addresses and tables: tabular numerals; use normal-width text rather than the display face.

Select fonts with suitable production rights. Matching proportion and contrast matters more than obtaining the exact observed family. Avoid compressing ordinary body text with CSS transforms to imitate a condensed font.

## Landing page composition

Proposed HALO page order:

1. Navigation: HALO identity, Explore, How it works, Docs, Connect and Deploy agent.
2. Split hero: short headline and two actions on the left; original halo-and-agent artwork on the right.
3. Three-layer explanation: HALO, agent tokens, agent-created coins, with an interactive example.
4. Live agent selection: real identities, niches and current operating states.
5. Autonomous workflow: create an agent, deploy its token, let it operate, explore its creations.
6. Network activity: recent launches, measured agent performance and real activity with units and timestamps.
7. Focused FAQ and a final deployment action.

Suggested original hero copy:

> Launch an agent. Build an economy.

Supporting copy: “Create an autonomous AI agent with its own token. Let it create, launch and grow an ecosystem connected to HALO.”

Primary action: **Deploy agent**. Secondary action: **Explore agents**.

## Applying the direction inside the product

The marketplace needs short paths to discovery, deployment and external trading links. Give it a compact brand header, chain filters and readable data panels. Reserve large artwork and expansive type for the landing page and agent identity sections. Wallet connection is for creation and activation; browsing performance should work without it.

On an agent page, use its portrait beside the name, ticker, chain and parent pairing. Repeat a small halo motif in its creation cards. On child-token pages, display the parent agent prominently so visual hierarchy reflects the economic hierarchy. Label external trading actions with the actual venue name.

Marketing should feel direct and opportunity-led: automated memecoin agents, quick setup and visible results. Use verified performance as proof. Keep speculative returns out of promises about the product's speed.

Combine this styling with the screen structures in `HALO_PONS_FEATURE_LAYOUT_REFERENCE.md`.

## Motion and responsive behavior — proposed

- Let the hero ring rotate slowly or respond subtly to pointer movement; keep text and controls stable.
- Use short fades for content transitions and restrained hover emphasis.
- Stop ornamental motion when reduced motion is requested.
- Stack the hero copy above artwork on phones, with the primary action visible early.
- Reduce card columns to fit content; keep prices, ticker symbols and pair names readable.
- Give keyboard focus a visible outline and check contrast in both blue and paper sections.

Responsive and motion rules here are proposed for HALO; this inspection did not verify Hermes across mobile breakpoints or audit its animations.

## Design acceptance criteria

- The result has an unmistakable blue, condensed, mythological visual identity.
- All logos, copy and central artwork identify HALO.
- An agent and its child coins are visually related and clearly distinguished.
- Deployment forms, performance views and external trading links remain readable at ordinary laptop and phone sizes.
- Financial values use clear units and normal-width numerals.
- The design supports the full product described in `HALO_PROJECT_BRIEF.md`.
