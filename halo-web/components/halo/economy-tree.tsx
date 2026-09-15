import { ArrowRight, PawPrint, Bot, Dog, Cat } from "lucide-react";

export function EconomyTree({ agent = "FRED", child = "DOG", captions = false, branch = false }: { agent?: string; child?: string; captions?: boolean; branch?: boolean }) {
  if (branch) return <div className="economy-lineage" aria-label="Example market hierarchy: HALO to FRED, with DOG and CAT tokens quoted in FRED">
    <div className="lineage-node root-node"><div className="lineage-orb"><img src="/brand/halo-ring-textured-256.png" width="85" height="85" alt="HALO" /></div><p>Platform token</p></div>
    <div className="lineage-connector" aria-hidden="true" />
    <div className="lineage-node agent-node"><div className="lineage-orb"><Bot size={42} strokeWidth={1.2} /><strong>{agent}</strong></div><p>Agent token</p></div>
    <div className="lineage-branch" aria-hidden="true"><svg viewBox="0 0 200 240" preserveAspectRatio="none"><path d="M0 120C110 120 90 40 200 40M0 120C110 120 90 200 200 200" /></svg></div>
    <div className="lineage-children"><div className="lineage-orb"><Dog size={31} strokeWidth={1.2} /><strong>{child}</strong></div><div className="lineage-orb"><Cat size={31} strokeWidth={1.2} /><strong>CAT</strong></div><p>Child tokens</p></div>
  </div>;
  return <div className="economy-tree" aria-label={`Target economic hierarchy: HALO to ${agent} to ${child}`}>
    <div><span className="economy-symbol"><img src="/brand/halo-ring-textured-256.png" width="54" height="54" alt="" /></span><strong>HALO</strong>{captions && <small>Platform token</small>}</div><ArrowRight aria-hidden="true" />
    <div><span className="economy-symbol economy-portrait"><img src="/art/hero-sunset.png" alt="" /></span><strong>{agent}</strong>{captions && <small>Agent token</small>}</div><ArrowRight aria-hidden="true" />
    <div><span className="economy-symbol"><PawPrint aria-hidden="true" /></span><strong>{child}</strong>{captions && <small>Child token</small>}</div>
  </div>;
}
