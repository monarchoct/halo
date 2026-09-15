"use client";
import {useEffect,useState} from "react";
import {RefreshCw,ArrowUpRight,Inbox,Radio,Clock3} from "lucide-react";
import {Button} from "@/components/ui/button";
import {Badge} from "@/components/ui/badge";
import {Alert,AlertDescription} from "@/components/ui/alert";
import {useProtocol} from "./protocol-provider";
import {operationsSchema,publicPostUrl,type Operations} from "@/lib/operations";
import {shortAddress} from "@/lib/halo-types";

const at=(value:string|null)=>value?new Date(value).toLocaleString([], {month:"short",day:"numeric",hour:"2-digit",minute:"2-digit",second:"2-digit"}):"Not recorded";
const states:Record<string,string>={queued:"Waiting for work",leased:"Worker lease active","lease-expired":"Awaiting replacement worker",completed:"Completion recorded",cancelled:"Cancelled",
  "needs-account":"Account setup needed","account-mismatch":"Account mismatch","site-unavailable":"Site unavailable","site-not-ready":"Site not ready",
  "composer-unconfigured":"Posting setup needed","browser-started":"Browser attempt started",drafted:"Draft prepared",failed:"Attempt failed"};
const jobTitle:Record<string,string>={launch:"Launch token",hold:"Hold decision",buy:"Buy position",sell:"Sell position"};

export function AgentOperations({agent}:{agent:string}) {
  const {deployment}=useProtocol(), endpoint=deployment?.operationsApiUrl;
  const [snapshot,setSnapshot]=useState<{key:string;data:Operations}|null>(null),[error,setError]=useState("");
  const [refresh,setRefresh]=useState(0),[loading,setLoading]=useState(false),[now,setNow]=useState(Date.now());
  useEffect(()=>{const timer=setInterval(()=>setNow(Date.now()),5000);return()=>clearInterval(timer);},[]);
  const key=`${endpoint}:${deployment?.chainId}:${deployment?.registry}:${agent.toLowerCase()}`;
  const data=snapshot?.key===key?snapshot.data:null;
  const stale=!!data&&(!!error||now-Date.parse(data.observedAt)>45000||Date.parse(data.observedAt)-now>5000);
  const jobState=(job:Operations["jobs"][number])=>job.state==="leased"
    ? stale?"Lease recorded · current status unknown":job.leaseUntil&&Date.parse(job.leaseUntil)<=now?"Recorded lease expired":"Worker lease reported"
    :states[job.state];
  useEffect(()=>{
    if(!endpoint||!deployment)return;
    const abort=new AbortController();let timer:ReturnType<typeof setTimeout>|undefined;
    setError("");
    async function update(){
      if(abort.signal.aborted)return;
      setLoading(true);
      try{
        const response=await fetch(`${endpoint}/v1/agents/${agent}/operations`,{cache:"no-store",credentials:"omit",signal:AbortSignal.any([abort.signal,AbortSignal.timeout(12000)])});
        if(!response.ok)throw new Error("Operator status is temporarily unavailable. The last successful snapshot may be out of date.");
        const value=operationsSchema.parse(await response.json());
        if(value.chainId!==deployment!.chainId||value.registry!==deployment!.registry.toLowerCase()||value.agent!==agent.toLowerCase())throw new Error("The operations service returned a different agent or deployment.");
        if(!abort.signal.aborted){setSnapshot({key,data:value});setError("");}
      }catch(error){if(!abort.signal.aborted)setError(error instanceof Error&&!(error.name==="ZodError")?error.message:"Operator status has an invalid response.");}
      finally{if(!abort.signal.aborted){setLoading(false);timer=setTimeout(()=>void update(),15000);}}
    }
    void update();return()=>{abort.abort();if(timer)clearTimeout(timer);};
  },[endpoint,deployment,agent,key,refresh]);
  if(!endpoint)return <section className="operations-empty"><h2>Operator status unavailable</h2><p>This deployment has no connected operations service. Confirmed transactions remain available in Activity.</p></section>;
  const publicationState=(item:Operations["publications"][number])=>{
    if(item.state==="cancelled")return "Cancelled";
    if(item.state==="delivered")return publicPostUrl(item)?"Publication reported":"Delivery needs verification";
    if(item.state==="lease-expired")return states[item.state];
    if(item.state==="leased")return stale?"Lease recorded · current status unknown":"Worker lease reported";
    return states[item.outcome??""]??"Publication queued";
  };
  return <section className="agent-operations" aria-label="Agent operations">
    <div className="section-topline"><div><h2>Behind each decision.</h2><p className="small-note">{data?`Snapshot ${at(data.observedAt)} · refreshes every 15 seconds`:"Loading operator records…"}</p></div>
      <Button variant="outline" size="sm" disabled={loading} onClick={()=>setRefresh(value=>value+1)}><RefreshCw aria-hidden="true"/>Refresh status</Button></div>
    {error&&<Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
    {stale&&<p role="status" className="warning-copy">Historical snapshot · current worker and publication status cannot be confirmed. Confirmed chain activity can be checked independently in Activity.</p>}
    {!data&&!error&&<p role="status">Loading jobs and account setup…</p>}
    {data&&<>
      <p className="operations-boundary">Records from this operator group. Completion and publication labels are reports; use Activity for chain receipts and post links to inspect publication.</p>
      <div className="operations-accounts">
        <article><Inbox aria-hidden="true"/><h3>Agent inbox</h3><Badge variant="outline">{data.mail.state==="provisioned"?"Inbox provisioned":data.mail.state==="pending"?"Provisioning pending":"Not configured"}</Badge>
          <p>{data.mail.state==="provisioned"?"A separate mailbox is assigned to this vault. This does not confirm social signup or message delivery.":"An operator must provide an inbox before email-based signup can continue."}</p>
          <small>{data.mail.stale?"Last check is over 24 hours old. ":""}Last checked: {at(data.mail.lastCheckedAt)}</small></article>
        {(["x","fomo"] as const).map(platform=>{
          const latest=data.publications.find(item=>item.platform===platform);
          return <article key={platform}><Radio aria-hidden="true"/><h3>{platform==="x"?"X / Twitter":"FOMO"}</h3><Badge variant="outline">{latest?publicationState(latest):"No publication attempt"}</Badge>
            <p>{platform==="fomo"&&latest?.outcome==="needs-account"?"The observed signup requires a Google or Apple identity. An inbox alone does not complete this step.":latest?`Latest record belongs to action #${latest.nonce}.` :"No account or successful publication is established by these records."}</p>
            {latest&&<small>{latest.attempts} attempts recorded</small>}</article>;
        })}
      </div>
      <section aria-label="Operator jobs"><div className="section-topline"><h3><Clock3 aria-hidden="true"/>Operator jobs</h3><span className="small-note">Newest {data.jobs.length}</span></div>
        {!data.jobs.length&&<p className="operations-empty">No jobs recorded for this agent by this operator group.</p>}
        <div className="operations-jobs">{data.jobs.map(job=><article key={job.id}>
          <div><strong>Action #{job.nonce} · {job.kind?jobTitle[job.kind]:"Agent cycle"}</strong><p>{job.attempts} attempts · Updated {at(job.updatedAt)}</p>
            {job.state==="queued"&&<p>Eligible to retry {at(job.availableAt)}</p>}
            {job.state==="leased"&&<p>Lease expires {at(job.leaseUntil)}. A lease alone does not prove the worker is running.</p>}
            {job.transactionHash&&(deployment?.explorerUrl?<a href={`${deployment.explorerUrl}/tx/${job.transactionHash}`} target="_blank" rel="noreferrer">Transaction {shortAddress(job.transactionHash)}<ArrowUpRight aria-hidden="true"/></a>:<code title={job.transactionHash}>{shortAddress(job.transactionHash)}</code>)}
          </div><Badge variant={job.state==="completed"?"secondary":"outline"}>{jobState(job)}</Badge></article>)}</div>
        {data.hasMoreJobs&&<p className="small-note">Showing the newest 20 jobs. Older executions can be checked through Activity or the chain.</p>}
      </section>
      <section aria-label="Social publication records"><div className="section-topline"><h3>Theses & publication</h3></div>
        {!data.publications.length&&<p className="operations-empty">No publication intents recorded. Confirmed child launches create publication jobs.</p>}
        {data.publications.map(item=>{const url=publicPostUrl(item);return <article className="operations-publication" key={item.id}>
          <div><h4>{item.platform==="x"?"X / Twitter":"FOMO"} · Action #{item.nonce}</h4><Badge variant={url?"secondary":"outline"}>{publicationState(item)}</Badge></div>
          <p>{item.attempts} attempts{item.deliveredAt?` · Reported delivery ${at(item.deliveredAt)}`:item.state==="queued"?` · Retry eligible ${at(item.availableAt)}`:""}</p>
          {item.thesis?<details><summary>Read prepared thesis</summary><p className="operations-thesis">{item.thesis}</p></details>:<p className="small-note">No prepared thesis is available yet.</p>}
          {url&&<a href={url} target="_blank" rel="noreferrer">Inspect public post<ArrowUpRight aria-hidden="true"/></a>}
        </article>;})}
        {data.hasMorePublications&&<p className="small-note">Showing the newest 20 publication records.</p>}
      </section>
    </>}
  </section>;
}
