"use client";
import { useEffect, useRef, useState } from "react";
import { createPublicClient, decodeEventLog, http, keccak256, toHex, verifyMessage, type Abi, type Address, type Hash } from "viem";
import { Radio, ShieldCheck, ExternalLink } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { useProtocol } from "./protocol-provider";
import { shortAddress } from "@/lib/halo-types";
import vaultAbi from "@/lib/generated/AgentVault.json";
import { evidenceUri } from "@/lib/evidence-uri";
import { BrowserView } from "./browser-view";

type Step = { version: string; chainId: number; registry: Address; operator: Address; agent: Address; nonce: string;
  runId: string; index: number; previousHash: Hash; timestamp: string; stage: string; summary: string; evidenceURI?: string; transactionHash?: Hash };
type Record = { hash: Hash; signature: Hash; step: Step; verifiedReceipt?: boolean };
const stages: { [key: string]: string } = { observe: "Read chain state", research: "Research public sources", propose: "Publish the proposal", prove: "Generate decision proof", simulate: "Simulate & check costs", submit: "Submit transaction", confirm: "Confirm the outcome", skip: "Wait for eligible work", error: "Cycle interrupted" };
function canonical(value: unknown): string { if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`; if (value !== null && typeof value === "object") return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical((value as { [key: string]: unknown })[key])}`).join(",")}}`; return JSON.stringify(value); }

export function LiveActivity({ agent, onConfirmed }: { agent: Address; onConfirmed: () => void }) {
  const { deployment } = useProtocol();
  const [records, setRecords] = useState<Record[]>([]), [connection, setConnection] = useState("Connecting"), [invalid, setInvalid] = useState(false);
  const confirmed = useRef(onConfirmed);
  useEffect(() => { confirmed.current = onConfirmed; }, [onConfirmed]);
  useEffect(() => {
    setRecords([]); setInvalid(false); setConnection("Connecting to report relay");
    if (!deployment?.transparencyApiUrl) return;
    let disposed = false;
    const seen = new Set<string>();
    const client = createPublicClient({ transport: http(deployment.rpcUrl) });
    const events = new EventSource(`${deployment.transparencyApiUrl}/v1/agents/${agent}/stream`);
    events.onopen = () => setConnection("Report relay connected");
    events.onerror = () => setConnection("Report relay disconnected · reconnecting");
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
        seen.add(value.hash);
        if (seen.size > 200) seen.delete(seen.values().next().value!);
        let verifiedReceipt = false;
        if (step.stage === "confirm" && step.transactionHash) {
          const receipt = await client.getTransactionReceipt({ hash: step.transactionHash });
          const block = await client.getBlock({ blockNumber: receipt.blockNumber });
          verifiedReceipt = block.hash === receipt.blockHash && receipt.status === "success" && receipt.logs.some(log => {
            if (log.address.toLowerCase() !== agent.toLowerCase()) return false;
            try { const decoded = decodeEventLog({ abi: vaultAbi as Abi, ...log }); const args = decoded.args as unknown as { nonce: bigint; beneficiary: string; evidenceHash: Hash };
              return decoded.eventName === "ActionExecuted" && args.nonce === BigInt(step.nonce) && args.beneficiary.toLowerCase() === step.operator.toLowerCase()
                && step.evidenceURI === evidenceUri(args.evidenceHash);
            } catch { return false; }
          });
        }
        if (disposed) return;
        setRecords(current => [...current, { ...value, verifiedReceipt }].sort((a, b) => a.step.timestamp.localeCompare(b.step.timestamp) || a.step.index - b.step.index).slice(-100));
        if (verifiedReceipt) confirmed.current();
      } catch { if (!disposed) setInvalid(true); }
    };
    return () => { disposed = true; events.close(); };
  }, [agent, deployment]);
  if (!deployment?.transparencyApiUrl) return <><BrowserView agent={agent} /><p style={{ paddingBlock: 25 }}>No live operator feed is connected. Confirmed transactions remain available in Activity.</p></>;
  const latest = records.length ? records[records.length - 1].step.runId : undefined;
  const current = records.filter(record => record.step.runId === latest);
  return <section className="live-activity" aria-label="Public operator activity"><BrowserView agent={agent} /><div className="section-topline"><h2>Watch the work.</h2><span className="live-status"><Radio size={15} aria-hidden="true" />{connection}</span></div>
    <p className="small-note">The connection status describes the report relay, not whether the agent is running. Progress reports carry the operator’s signature. Confirmed receipts are checked directly against the chain in your browser. Neither a report nor a desktop video proves that a larger model ran without human involvement.</p>
    {invalid && <p className="inline-error">A report could not be verified and was excluded.</p>}
    {!current.length && <p style={{ paddingBlock: 30 }}>Waiting for an operator to report its next eligible cycle. Historical confirmed actions are in Activity.</p>}
    <ol className="live-steps" aria-live="polite" aria-relevant="additions">{current.map(record => <li key={record.hash}><span className="live-step-number">{record.verifiedReceipt ? <ShieldCheck size={17} aria-label="Receipt verified" /> : record.step.index + 1}</span>
      <div><div className="live-step-heading"><h3>{stages[record.step.stage]}</h3><Badge variant="outline">{record.verifiedReceipt ? "Receipt verified" : "Operator signed"}</Badge></div>
        <p>{record.step.summary}</p><p className="live-step-meta"><time dateTime={record.step.timestamp}>{new Date(record.step.timestamp).toLocaleTimeString()}</time> · Operator {shortAddress(record.step.operator)} · Action #{record.step.nonce}</p>
        {record.step.evidenceURI?.match(/^ipfs:\/\/b[a-z2-7]+$/) && deployment.artifactApiUrl && <a className="text-link" href={`${deployment.artifactApiUrl}/ipfs/${record.step.evidenceURI.slice(7)}`} target="_blank" rel="noreferrer">Inspect public evidence<ExternalLink size={13} /></a>}
        {record.step.transactionHash && deployment.explorerUrl && <a className="text-link" href={`${deployment.explorerUrl}/tx/${record.step.transactionHash}`} target="_blank" rel="noreferrer">Open transaction<ExternalLink size={13} /></a>}
        <details className="signature-details"><summary>Signature & record</summary><code>{record.hash}</code><code>{record.signature}</code></details>
      </div></li>)}</ol>
  </section>;
}
