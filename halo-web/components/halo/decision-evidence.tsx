"use client";
import { useState } from "react";
import { createPublicClient, decodeEventLog, http, type Abi, type Address, type Hash } from "viem";
import { ExternalLink, ShieldCheck } from "lucide-react";
import { useProtocol } from "./protocol-provider";
import { evidenceCid, publicArtifact } from "@/lib/public-evidence";
import type { ActionRecord } from "@/lib/halo-types";
import vaultAbi from "@/lib/generated/AgentVault.json";
type Evidence = { proposal: { rationale: string; module: string; sourceIds: string[] }; inference?: { releaseSha256: string; transcriptURI: string; elapsedSeconds: number }; sources: { id: string; title: string; url: string }[] };
const cidOf = (hash: string) => { try { return evidenceCid(hash); } catch { return null; } };
export function DecisionEvidence({ agent, action }: { agent: Address; action: ActionRecord }) {
  const { deployment } = useProtocol();
  const [evidence, setEvidence] = useState<Evidence | null>(null), [open, setOpen] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const sourceIds = evidence?.proposal.sourceIds.filter(id => typeof id === "string" && /^[a-f0-9]{64}$/.test(id)).slice(0, 3) ?? [];
  const readableRationale = sourceIds.reduce((text, id, index) => text.split(id).join(`[${index + 1}]`), evidence?.proposal.rationale ?? "");
  const cid = cidOf(action.evidenceHash), gateway = deployment?.artifactApiUrl;
  async function inspect() {
    if (evidence) { setOpen(value => !value); return; }
    if (!deployment?.artifactApiUrl) { setError("No evidence gateway is configured for this deployment."); return; }
    setBusy(true); setError("");
    try {
      const client = createPublicClient({ transport: http(deployment.rpcUrl) });
      const [receipt, data] = await Promise.all([client.getTransactionReceipt({ hash: action.transactionHash as Hash }), publicArtifact(deployment.artifactApiUrl, evidenceCid(action.evidenceHash))]);
      const matched = receipt.logs.filter(log => log.address.toLowerCase() === agent.toLowerCase()).some(log => {
        try { const decoded = decodeEventLog({ abi: vaultAbi as Abi, ...log }); const args = decoded.args as unknown as { evidenceHash: string; nonce: bigint };
          return decoded.eventName === "ActionExecuted" && args.evidenceHash === action.evidenceHash && args.nonce.toString() === action.nonce;
        } catch { return false; }
      });
      if (receipt.status !== "success" || !matched || data.version !== "halo.decision-evidence.v1" || data.chainId !== deployment.chainId
        || typeof data.agent !== "string" || data.agent.toLowerCase() !== agent.toLowerCase() || data.nonce !== action.nonce
        || typeof data.proposal?.rationale !== "string" || typeof data.proposal?.module !== "string" || !Array.isArray(data.proposal?.sourceIds) || !Array.isArray(data.sources)
        || data.sources.some((source: { id?: unknown; url?: unknown; title?: unknown } | null) => !source || typeof source.id !== "string" || typeof source.url !== "string" || typeof source.title !== "string")) throw new Error("Evidence does not match the confirmed agent action.");
      if (data.inference && (!/^ipfs:\/\/bafkrei[a-z2-7]{52}$/.test(data.inference.transcriptURI)
        || !/^[a-f0-9]{64}$/.test(data.inference.releaseSha256) || !Number.isFinite(data.inference.elapsedSeconds))) throw new Error("Inference evidence is malformed.");
      setEvidence(data); setOpen(true);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Evidence could not be verified."); }
    finally { setBusy(false); }
  }
  const shown = open && !!evidence;
  return <div className="stack" style={{ gap: 8, marginTop: 4 }}>
    <div className="row" style={{ gap: 6 }}>
      <button type="button" className={`pill sm ${shown ? "" : "ghost"}`} disabled={busy} onClick={inspect} aria-expanded={shown} title="Fetch the evidence, check its content hash and match it to the receipt"><ShieldCheck size={13} /> {busy ? "Verifying evidence…" : shown ? "Hide decision" : "Verify decision"}</button>
      {gateway && cid && <a className="pill sm ghost" href={`${gateway}/ipfs/${cid}`} target="_blank" rel="noreferrer" title="Open the raw evidence artifact">Evidence <ExternalLink size={13} /></a>}
      <code className="hash dim" title={action.evidenceHash}>{action.evidenceHash.slice(0, 10)}…{action.evidenceHash.slice(-6)}</code>
    </div>
    {error && <p role="alert" className="inline-error">{error}</p>}
    {shown && <div className="hash-block reveal-up" style={{ gap: 8, background: "var(--panel)" }}>
      <div className="row between"><strong>{evidence.inference ? "Public model proposal" : "Recorded proposal"}</strong><span className="chip green"><ShieldCheck size={12} /> Hash &amp; receipt verified</span></div>
      <p style={{ whiteSpace: "pre-wrap" }}>{readableRationale}</p>
      <p className="dim">Proposal module <code>{evidence.proposal.module}</code>.{evidence.inference && <> Recorded inference: <span className="num">{evidence.inference.elapsedSeconds.toFixed(2)}</span> seconds. The transcript is an operator claim; the spending proof does not prove model authorship.</>}</p>
      <div className="row" style={{ gap: 6 }}>
        {evidence.inference && gateway && <a className="pill sm" href={`${gateway}/ipfs/${evidence.inference.transcriptURI.replace(/^ipfs:\/\//, "")}`} target="_blank" rel="noreferrer">Inference transcript <ExternalLink size={13} /></a>}
        {sourceIds.map((id, index) => { const source = evidence.sources.find(item => item.id === id); return source && /^https:\/\//.test(source.url) ? <a key={id} className="chip" href={source.url} target="_blank" rel="noreferrer" title={source.url}>[{index + 1}] {source.title}</a> : null; })}
      </div>
    </div>}
  </div>;
}
