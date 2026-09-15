# HALO — Sunset design system

13 September 2026. Supersedes the lime-green and neutral-card design. The founder requested Hermes and Eliza inspiration, the orange/violet palette, selective glass profile cards and an original ring logo with inward-facing points.

## Direction

An open purple canvas, oversized condensed headings, original engraved portraits, orange actions and restrained violet glass around agent identity. Hermes informs the engraving and editorial scale. Eliza informs the saturated canvas and direct presentation. PONS informs discovery and creation functions, not the visual template.

References observed in the browser:
- [Hermes](https://hermes-agent.nousresearch.com/): electric-blue full-bleed opening, narrow light headline, detailed mythic figure and compact navigation.
- [Eliza](https://elizaresearch.ai/): saturated orange, oversized bold sans-serif heading, spare navigation and particle/pixel figure.
- [Founder palette](https://coolors.co/palette/ff6d00-ff7900-ff8500-ff9100-ff9e00-240046-3c096c-5a189a-7b2cbf-9d4edd).

## Tokens

| Role | Value |
| --- | --- |
| Background | #240046 |
| Primary action / emphasis | #FF8500 |
| Hot orange / amber | #FF6D00 / #FF9E00 |
| Purple progression | #3C096C, #5A189A, #7B2CBF, #9D4EDD |
| Main text | #F4EAFE |
| Supporting text | #C5AED8 |
| Borders / rules | #795299 / #805D9C |
| Solid form surface | #2D0C4C |
| Primary button text | #240046 |

Big Shoulders supplies light uppercase display headings; Manrope supplies readable body copy, navigation and controls. Both are hosted locally with OFL licenses. Addresses and network details may use monospace.

Spacing: 8/12/16/24/32/48/64/96px. Container maximum 1560px; gutters 64px desktop, 30px tablet, 22px phone. Buttons and fields use 4px corners; portraits 12px; browser frame 6px. Keep form fields solid; reserve glass for portrait information.

## Logo and assets

The production mark is the founder's supplied orange-gold textured ring with eight inward points and an open center. Its purple background has been removed, including the center, using actual PNG transparency. Header, footer and hierarchy use the 256px export; the browser icon uses the 64px export. See halo-brand/README.md for the source and processing record.

Concepts: halo-design/hero-concept.png, economy-concept.png, profile-concept.png, halo-logo-concept.png.
Production art: halo-web/public/art/hero-sunset.png and agents-sunset.png.
Production logos: halo-brand/halo-ring-textured.png and its 256px and 64px exports. Earlier SVGs remain historical assets and are excluded from the current downloadable pack.

## Component inventory

| Surface | Implementation |
| --- | --- |
| Shell | SiteShell: ring and wordmark, Explore, Portfolio, Docs, wallet control and compact footer. |
| Landing | Three-line heading beside unframed engraving, two actions and real deployment status. |
| Economy | EconomyTree: HALO → FRED → DOG/CAT with thin connectors on an open canvas. |
| Explore | Search, creation-order sorting, purple portrait cards and actual local-chain records. |
| Profile | Glass portrait sidebar, open metrics, ruled tabs and real token rows. |
| Live | BrowserView and LiveActivity: signed public frames, pause/latest controls and receipt verification. |
| Creation | Existing seven steps: Identity, Models, Strategy, Curve & fees, Funding, Review, Activation. |
| Tokens / portfolio / docs | Existing information architecture with purple surfaces and orange controls. |

All interface copy and controls remain React. Images contain artwork only. Reuse accessible Radix/shadcn primitives and Lucide outline icons. Color is never the only transaction-state signal.

## Copy lock and deliberate adaptations

Landing heading: “Agents build / the next / economy.”
Supporting copy: “Create an autonomous coin deployer. It finds narratives, launches tokens and builds its own economy on HALO.”
Actions: “Deploy an agent” and “Explore agents”.
Navigation: “Explore”, “Portfolio”, “Docs”, “Connect wallet”.
Status is actual deployment state, currently “Local development”.

Economy: “One platform. / Many economies.” and “HALO powers agent creation. Each agent can launch multiple tokens, paired to its own coin.”
Keep: “Pairing connects markets. It does not guarantee appreciation.”
Final section: “Watch the work.” / “Explore agents, inspect their decisions and see their public activity.”

The profile concept's empty browser is replaced by available recorded frames and actual receipts. Preserve local-test labels, costs, addresses and provenance. The new ring replaces generated letter-H placeholders. A single shell and licensed local fonts apply consistently across routes.

## Responsive and interaction rules

At 760px and below, stack content and keep navigation in a second header row. Artwork must fit the content width. Use compact economic nodes, short captions and horizontally scrollable profile tabs only when needed. The seven-step rail scrolls on phones. No page overflow. Keep keyboard focus visible, inputs labelled and validation next to the form.

The current preview connects to a disposable local chain. This redesign does not imply public deployment, profitable agents or completion of the full production system. Verification details are in HALO_SUNSET_QA.md.
