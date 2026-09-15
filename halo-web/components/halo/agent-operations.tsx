"use client";
import Link from "next/link";
import { useEffect, useState, type CSSProperties } from "react";
import { RefreshCw, ExternalLink, Inbox, Radio, Clock3 } from "lucide-react";
import { useProtocol } from "./protocol-provider";
import { operationsSchema, publicPostUrl, type Operations } from "@/lib/operations";
import { shortAddress } from "@/lib/format";

const at = (value: string | null) => value ? new Date(value).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "Not recorded";
const states: Record<string, string> = { queued: "Waiting for work", leased: "Worker lease active", "lease-expired": "Awaiting replacement worker", completed: "Completion recorded", cancelled: "Cancelled",
  "needs-account": "Account setup needed", "needs-connection": "Account not connected", "account-mismatch": "Account mismatch", "credentials-expired": "Reconnect needed", "site-unavailable": "Site unavailable", "site-not-ready": "Site not ready",
  "composer-unconfigured": "Posting setup needed", "browser-started": "Browser attempt started", drafted: "Draft prepared", posted: "Posted", failed: "Attempt failed" };
const jobTitle: Record<string, string> = { launch: "Launch token", hold: "Hold decision", buy: "Buy position", sell: "Sell position" };
const platformName = (platform: string) => platform === "x" ? "X" : "FOMO";
const stagger = (i: number) => ({ "--i": i % 8 } as CSSProperties);

/** Sanitized operator-side records for one agent: jobs, inbox, publication attempts. Reports, not chain truth — Actions holds the receipts. */
export function AgentOperations({ agent }: { agent: string }) {
  const { deployment } = useProtocol(), endpoint = deployment?.operationsApiUrl, explorer = deployment?.explorerUrl;
  const key = `${endpoint}:${deployment?.chainId}:${deployment?.registry}:${agent.toLowerCase()}`;
  const [snapshot, setSnapshot] = useState<{ key: string; data?: Operations; error?: string; loading: boolean }>({ key: "", loading: false });
  const [refresh, setRefresh] = useState(0), [now, setNow] = useState(0);
  const data = snapshot.key === key ? snapshot.data : undefined, error = snapshot.key === key ? snapshot.error : "", loading = snapshot.key === key && snapshot.loading;
  const stale = !!data && !!now && (!!error || now - Date.parse(data.observedAt) > 45000 || Date.parse(data.observedAt) - now > 5000);
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 5000); return () => clearInterval(timer); }, []);
  useEffect(() => {
    if (!endpoint || !deployment) return;
    const abort = new AbortController(); let timer: ReturnType<typeof setTimeout> | undefined;
    async function update() {
      if (abort.signal.aborted) return;
      setSnapshot(s => ({ ...(s.key === key ? s : { key, loading: false }), key, loading: true }));
      try {
        const response = await fetch(`${endpoint}/v1/agents/${agent}/operations`, { cache: "no-store", credentials: "omit", signal: AbortSignal.any([abort.signal, AbortSignal.timeout(12000)]) });
        if (!response.ok) throw new Error("Operator status is temporarily unavailable. The last successful snapshot may be out of date.");
        const value = operationsSchema.parse(await response.json());
        if (value.chainId !== deployment!.chainId || value.registry !== deployment!.registry.toLowerCase() || value.agent !== agent.toLowerCase()) throw new Error("The operations service returned a different agent or deployment.");
        if (!abort.signal.aborted) setSnapshot({ key, data: value, loading: false });
      } catch (e) { if (!abort.signal.aborted) setSnapshot(s => ({ key, data: s.key === key ? s.data : undefined, loading: false, error: e instanceof Error && e.name !== "ZodError" ? e.message : "Operator status has an invalid response." })); }
      finally { if (!abort.signal.aborted) timer = setTimeout(() => void update(), 15000); }
    }
    void update(); return () => { abort.abort(); if (timer) clearTimeout(timer); };
  }, [endpoint, deployment, agent, key, refresh]);
  if (!endpoint) return <div className="empty reveal-up"><h3>Operator status unavailable</h3><p>This deployment has no connected operations service. Confirmed transactions remain available under Actions.</p><Link href="#actions" className="pill sm">Confirmed actions</Link></div>;
  const jobState = (job: Operations["jobs"][number]) => job.state === "leased" ? (stale ? "Lease recorded · status unknown" : job.leaseUntil && Date.parse(job.leaseUntil) <= now ? "Recorded lease expired" : "Worker lease reported") : states[job.state];
  const publicationState = (item: Operations["publications"][number]) => item.state === "cancelled" ? "Cancelled" : item.state === "delivered" ? (publicPostUrl(item) ? "Posted" : "Delivery needs verification") : item.state === "lease-expired" ? states[item.state] : item.state === "leased" ? (stale ? "Lease recorded · status unknown" : "Worker lease reported") : states[item.outcome ?? ""] ?? "Publication queued";
  return <div className="stack" aria-label="Agent operations">
    <div className="row between reveal-up"><div><h3>Behind each decision</h3><p className="dim">{data ? `Snapshot ${at(data.observedAt)} · refreshes every 15 seconds` : "Loading operator records…"}</p></div><button type="button" className="pill sm" disabled={loading} onClick={() => setRefresh(v => v + 1)}><RefreshCw size={14} /> Refresh operator status</button></div>
    {error && <p className="notice err reveal-up" role="alert">{error}</p>}
    {stale && <p className="notice warn reveal-up" role="status">Historical snapshot · current worker and publication status cannot be confirmed. Chain activity can be checked independently under <Link href="#actions" className="tap">Actions</Link>.</p>}
    {!data && !error && <p className="dim" role="status">Loading jobs and account setup…</p>}
    {data && <>
      <div className="fee-panels">
        <div className="panel reveal-up" style={stagger(0)}><div className="row" style={{ gap: 8 }}><Inbox size={16} /><h3>Agent inbox</h3></div><p style={{ marginTop: 6 }}><span className={`chip ${data.mail.state === "provisioned" ? "green" : ""}`}>{data.mail.state === "provisioned" ? "Provisioned" : data.mail.state === "pending" ? "Pending" : "Not configured"}</span></p><p className="dim" style={{ marginTop: 8 }}>{data.mail.state === "provisioned" ? "A separate mailbox is assigned to this vault." : "An operator must provide an inbox before email-based flows continue."} Last checked {at(data.mail.lastCheckedAt)}.</p></div>
        {(["x", "fomo"] as const).map((platform, i) => { const latest = data.publications.find(item => item.platform === platform), url = latest ? publicPostUrl(latest) : null; return <div className="panel reveal-up" key={platform} style={stagger(i + 1)}><div className="row" style={{ gap: 8 }}><Radio size={16} /><h3>{platformName(platform)}</h3></div>
          <p style={{ marginTop: 6 }}>{url ? <a className="chip green" href={url} target="_blank" rel="noreferrer" title="Open the latest post">{publicationState(latest!)} ↗</a> : <Link href="#social" className="chip" title="Account connection">{latest ? publicationState(latest) : "No publication yet"}</Link>}</p>
          <p className="dim" style={{ marginTop: 8 }}>{latest ? <>Latest record belongs to <Link href="#actions" className="tap">action #{latest.nonce}</Link> · {latest.attempts} attempts.</> : "The creator connects this account once; the agent posts from it afterwards."}</p></div>; })}
      </div>
      <div className="panel reveal-up"><div className="panel-head"><div><h2><Clock3 size={18} /> Operator jobs <span className="count">{data.jobs.length}</span></h2><p>Each job is one agent cycle claimed by a worker.</p></div><Link href="#runtime" className="pill sm ghost">Runtime</Link></div>
        {!data.jobs.length ? <p className="dim">No jobs recorded for this agent by this operator group.</p> : <div className="list">{data.jobs.map((job, i) => { const receipt = job.transactionHash && explorer ? `${explorer}/tx/${job.transactionHash}` : null; return <article className="list-row hover reveal-up" key={job.id} style={stagger(i)} data-sfx="click"><Link className="glyph" href="#actions" title={`Cycle ${job.nonce}`}>#{job.nonce}</Link>
          <div className="info"><strong>{job.kind ? jobTitle[job.kind] : "Agent cycle"}</strong><p className="dim">{job.attempts} attempts · updated {at(job.updatedAt)}{job.state === "queued" && ` · retry ${at(job.availableAt)}`}{job.state === "leased" && ` · lease until ${at(job.leaseUntil)}`}</p>
            {job.transactionHash && (receipt ? <a className="tap hash" href={receipt} target="_blank" rel="noreferrer" title="Open the transaction in the explorer">{shortAddress(job.transactionHash)} <ExternalLink size={12} /></a> : <code className="hash" title={job.transactionHash}>{shortAddress(job.transactionHash)}</code>)}</div>
          <div className="stack" style={{ gap: 6, justifyItems: "end" }}><span className={`chip ${job.state === "completed" ? "green" : job.state === "leased" ? "bronze" : ""}`}>{jobState(job)}</span>{receipt && <a className="pill sm ghost" href={receipt} target="_blank" rel="noreferrer">Receipt <ExternalLink size={13} /></a>}</div></article>; })}</div>}
        {data.hasMoreJobs && <p className="dim" style={{ marginTop: 10 }}>Newest 20 jobs shown.</p>}</div>
      <div className="panel reveal-up"><div className="panel-head"><div><h2>Theses &amp; publication <span className="count">{data.publications.length}</span></h2><p>What the agent prepared to say, and whether it got posted.</p></div><Link href="#social" className="pill sm ghost">Accounts</Link></div>
        {!data.publications.length ? <p className="dim">No publication intents recorded. Confirmed launches create publication jobs.</p> : <div className="list">{data.publications.map((item, i) => { const url = publicPostUrl(item); return <article className="list-row hover reveal-up" key={item.id} style={stagger(i)} data-sfx="click"><Link className="glyph" href="#social" title={`${platformName(item.platform)} account`}>{item.platform === "x" ? "X" : "F"}</Link>
          <div className="info"><strong>{platformName(item.platform)} · <Link href="#actions" className="tap">action #{item.nonce}</Link></strong><p className="dim">{item.attempts} attempts{item.deliveredAt ? ` · delivered ${at(item.deliveredAt)}` : item.state === "queued" ? ` · retry ${at(item.availableAt)}` : ""}</p>
            {item.thesis ? <details className="disclosure"><summary>Read the prepared thesis</summary><p style={{ marginTop: 6, whiteSpace: "pre-wrap" }}>{item.thesis}</p></details> : <p className="dim">No prepared thesis yet.</p>}</div>
          {url ? <a className="pill sm" href={url} target="_blank" rel="noreferrer">Open post <ExternalLink size={13} /></a> : <span className="chip">{publicationState(item)}</span>}</article>; })}</div>}
        {data.hasMorePublications && <p className="dim" style={{ marginTop: 10 }}>Newest 20 records shown.</p>}</div>
      <p className="dim">Records from this operator group. Completion and publication labels are reports; <Link href="#actions" className="tap">Actions</Link> holds the chain receipts.</p>
    </>}
  </div>;
}
