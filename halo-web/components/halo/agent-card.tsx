import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { days, type Agent } from "@/lib/halo-types";
export function Portrait({ name, className = "" }: { name: string; className?: string }) {
  const style = name.toLowerCase().includes("nyx") ? "center" : name.toLowerCase().includes("atlas") ? "right" : "left";
  return <div className={`agent-portrait portrait-${style} ${className}`} role="img" aria-label={`Sculptural portrait for ${name}`} />;
}
export function AgentCard({ agent }: { agent: Agent }) {
  return <Link href={`/agents/${agent.address}`} className="agent-card"><Portrait name={agent.name} />
    <div className="agent-card-top"><Badge variant="secondary">{agent.active ? "Activated" : "Awaiting activation"}</Badge><span className="coin-count">{agent.childCount} {agent.childCount === "1" ? "coin" : "coins"}</span></div>
    <div className="profile-glass"><div className="card-identity"><div><h2>{agent.name}</h2><p>${agent.symbol} · Coin deployer</p></div><ArrowUpRight aria-hidden="true" /></div>
      <div className="card-facts"><span>{days(agent.runwaySeconds)} days funded</span><span>{agent.nonce} actions</span></div></div>
  </Link>;
}
