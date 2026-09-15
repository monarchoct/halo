"use client";
import { useEffect, useRef, useState } from "react";
import { createPublicClient, decodeEventLog, http, keccak256, toHex, verifyMessage, type Abi, type Address, type Hash } from "viem";
import { ExternalLink, ShieldCheck } from "lucide-react";
import { useProtocol } from "./protocol-provider";
import { shortAddress } from "@/lib/format";
import vaultAbi from "@/lib/generated/AgentVault.json";
import { evidenceUri } from "@/lib/evidence-uri";
import { BrowserView } from "./browser-view";

type Step = { version: string; chainId: number; registry: Address; operator: Address; agent: Address; nonce: string; runId: string; index: number; previousHash: Hash; timestamp: string; stage: string; summary: string; evidenceURI?: string; transactionHash?: Hash };
type Record = { hash: Hash; signature: Hash; step: Step; verifiedReceipt?: boolean };
const stages: { [key: string]: string } = { observe: "Read chain state", research: "Research public sources", propose: "Publish the proposal", prove: "Generate decision proof", simulate: "Simulate & check costs", submit: "Submit transaction", confirm: "Confirm the outcome", skip: "Wait for eligible work", error: "Cycle interrupted" };
function canonical(value: unknown): string { if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`; if (value !== null && typeof value === "object") return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical((value as { [key: string]: unknown })[key])}`).join(",")}}`; return JSON.stringify(value); }

export function LiveActivity({ agent, onConfirmed }: { agent: Address; onConfirmed: () => void }) {
  const { deployment } = useProtocol();
  // State is keyed by the stream identity so a reconnect for another agent never shows stale records.
  const key = `${deployment?.transparencyApiUrl}:${agent}`;
  const [stream, setStream] = useState<{ key: string; records: Record[]; connection: string; invalid: boolean }>({ key: "", records: [], connection: "Connecting to report relay", invalid: false });
  const view = stream.key === key ? stream : { key, records: [], connection: "Connecting to report relay", invalid: false };
  const confirmed = useRef(onConfirmed);
  useEffect(() => { confirmed.current = onConfirmed; }, [onConfirmed]);
  useEffect(() => {
    if (!deployment?.transparencyApiUrl) return;
    let disposed = false; const seen = new Set<string>();
    const client = createPublicClient({ transport: http(deployment.rpcUrl) });
    const events = new EventSource(`${deployment.transparencyApiUrl}/v1/agents/${agent}/stream`);
    const patch = (value: Partial<typeof stream>) => setStream(s => ({ ...(s.key === key ? s : { key, records: [], connection: "", invalid: false }), ...value, key }));
    events.onopen = () => patch({ connection: "Report relay connected" });
    events.onerror = () => patch({ connection: "Report relay disconnected · reconnecting" });
    events.onmessage = async event => {
      try {
        if (event.data.length > 8192) throw new Error("Oversized record");
        const value = JSON.parse(event.data) as Record, step = value.step;
        if (!step || step.version !== "halo.step.v1" || !Number.isFinite(Date.parse(step.timestamp)) || !Number.isSafeInteger(step.index) || step.index < 0
          || step.agent.toLowerCase() !== agent.toLowerCase() || step.chainId !== deployment.chainId || step.registry.toLowerCase() !== deployment.registry.toLowerCase()
          || !stages[step.stage] || typeof step.summary !== "string" || step.summary.length > 2000) throw new Error("Invalid step");
        const message = `HALO_PUBLIC_STEP_V1\n${canonical(step)}`;
        if (keccak256(toHex(message)) !== value.hash || !(await verifyMessage({ address: step.operator, message, signature: value.signature }))) throw new Error("Invalid signature");
        if (disposed || seen.has(value.hash)) return;
        seen.add(value.hash); if (seen.size > 200) seen.delete(seen.values().next().value!);
        let verifiedReceipt = false;
        if (step.stage === "confirm" && step.transactionHash) {
          const receipt = await client.getTransactionReceipt({ hash: step.transactionHash });
          const block = await client.getBlock({ blockNumber: receipt.blockNumber });
          verifiedReceipt = block.hash === receipt.blockHash && receipt.status === "success" && receipt.logs.some(log => {
            if (log.address.toLowerCase() !== agent.toLowerCase()) return false;
            try { const decoded = decodeEventLog({ abi: vaultAbi as Abi, ...log }); const args = decoded.args as unknown as { nonce: bigint; beneficiary: string; evidenceHash: Hash };
              return decoded.eventName === "ActionExecuted" && args.nonce === BigInt(step.nonce) && args.beneficiary.toLowerCase() === step.operator.toLowerCase() && step.evidenceURI === evidenceUri(args.evidenceHash);
            } catch { return false; }
          });
        }
        if (disposed) return;
        setStream(s => { const base = s.key === key ? s : { key, records: [], connection: "Report relay connected", invalid: false }; return { ...base, records: [...base.records, { ...value, verifiedReceipt }].sort((a, b) => a.step.timestamp.localeCompare(b.step.timestamp) || a.step.index - b.step.index).slice(-100) }; });
        if (verifiedReceipt) confirmed.current();
      } catch { if (!disposed) patch({ invalid: true }); }
    };
    return () => { disposed = true; events.close(); };
  }, [agent, deployment, key]);
  if (!deployment?.transparencyApiUrl) return <div className="stack"><BrowserView agent={agent} /><p className="dim">No live operator feed is connected. Confirmed transactions remain available in Activity.</p></div>;
  const latest = view.records.at(-1)?.step.runId, current = view.records.filter(r => r.step.runId === latest);
  const liveNow = view.connection === "Report relay connected";
  return <div className="split reverse" aria-label="Public operator activity">
    <div className="stack"><BrowserView agent={agent} /></div>
    <div className="panel sticky"><div className="panel-head"><div><h2>The work, step by step</h2><p>Signed by the operator; receipts checked against the chain in your browser.</p></div><span className={`chip ${liveNow ? "green live" : ""}`}><i aria-hidden="true" />{view.connection}</span></div>
      {view.invalid && <p className="inline-error">A report could not be verified and was excluded.</p>}
      {!current.length && <p className="dim">Waiting for an operator to report its next eligible cycle. Historical actions are in Activity.</p>}
      <ol className="steps" aria-live="polite" aria-relevant="additions">{current.map(r => <li key={r.hash}><span className={`n ${r.verifiedReceipt ? "ok" : ""}`}>{r.verifiedReceipt ? <ShieldCheck size={16} aria-label="Receipt verified" /> : r.step.index + 1}</span>
        <div className="stack" style={{ gap: 4 }}><div className="row between"><h3>{stages[r.step.stage]}</h3><span className={`chip ${r.verifiedReceipt ? "green" : ""}`}>{r.verifiedReceipt ? "Receipt verified" : "Operator signed"}</span></div>
          <p>{r.step.summary}</p><p className="meta"><time dateTime={r.step.timestamp}>{new Date(r.step.timestamp).toLocaleTimeString()}</time> · Operator {shortAddress(r.step.operator)} · Action #{r.step.nonce}</p>
          <div className="row" style={{ gap: 8 }}>{r.step.evidenceURI?.match(/^ipfs:\/\/b[a-z2-7]+$/) && deployment.artifactApiUrl && <a className="pill sm" href={`${deployment.artifactApiUrl}/ipfs/${r.step.evidenceURI.slice(7)}`} target="_blank" rel="noreferrer">Evidence <ExternalLink size={13} /></a>}
            {r.step.transactionHash && deployment.explorerUrl && <a className="pill sm" href={`${deployment.explorerUrl}/tx/${r.step.transactionHash}`} target="_blank" rel="noreferrer">Transaction <ExternalLink size={13} /></a>}</div>
          <details className="disclosure"><summary>Signature &amp; record</summary><code>{r.hash}</code><code>{r.signature}</code></details></div></li>)}</ol>
      <p className="dim" style={{ marginTop: 12 }}>Relay status describes the report feed, not whether the agent is running. Neither a report nor a screen recording proves a larger model acted without human involvement.</p></div>
  </div>;
}
