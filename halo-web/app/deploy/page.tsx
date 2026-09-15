"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { createPublicClient, decodeEventLog, http, parseEther, formatEther, keccak256, toHex, type Abi, type Address } from "viem";
import { ArrowRight, Check } from "lucide-react";
import { useProtocol } from "@/components/halo/protocol-provider";
import { AddressTap, statueFor } from "@/components/halo/market-card";
import { countUp } from "@/lib/reveal";
import { play } from "@/lib/sound";
import registryAbi from "@/lib/generated/AgentRegistry.json";
import vaultAbi from "@/lib/generated/AgentVault.json";
import tokenAbi from "@/lib/generated/HaloToken.json";
import curveAbi from "@/lib/generated/HaloCurve.json";
import proposalModel from "@/lib/generated/ProposalModel.json";

const steps = ["Identity", "Model", "Limits", "Economics", "Funding", "Review", "Activate"];
const stepIntro = ["Choose the identity people will discover.", "Pick who proposes narratives and trades. The spending core stays fixed.", "These limits become immutable when you activate.", "Every child inherits the agent’s committed fees.", "Separate trading capital from the cost of running the agent.", "Review exactly what your wallet will create.", "Funding and activation are separate confirmed states."];
const initial = { name: "", symbol: "", description: "", modelMode: "public-baseline", endpoint: "", launches: "1", position: "10", daily: "10", slippage: "3", interval: "15", reward: "0.00005", target: "1000000", childTarget: "1000000", tradingFee: "1", operations: "60", halo: "20", initialBuy: "1000" };
type Draft = typeof initial;
type Created = { agent: Address; token: Address; curve: Address; manifestHash: string; registry: Address; fundingConfirmed: boolean; active: boolean };
const DRAFT_KEY = "halo:agent-draft:v1";
function canonical(value: unknown): string { if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`; if (value !== null && typeof value === "object") return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(",")}}`; return JSON.stringify(value); }
function loadDraft(): { draft: Draft; created: Created | null; step: number } {
  try {
    const saved = JSON.parse(localStorage.getItem(DRAFT_KEY) || "null");
    if (saved?.draft && Object.keys(initial).every(key => typeof saved.draft[key] === "string")) {
      const created = saved.created?.agent?.match(/^0x[0-9a-fA-F]{40}$/) ? { ...saved.created, active: false, fundingConfirmed: false } as Created : null;
      return { draft: saved.draft, created, step: created ? 6 : 0 };
    }
  } catch { /* A broken device-local draft is not an on-chain state. */ }
  return { draft: initial, created: null, step: 0 };
}

/* Number formatters live at module level so the count-up hook can depend on them safely. */
const fmtAmount = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 4 });
const fmtInt = (n: number) => Math.round(n).toLocaleString("en-US");
const fmtPct = (n: number) => `${n.toLocaleString("en-US", { maximumFractionDigits: 2 })}%`;
const fmtReserve = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 6 });

/** Tabular headline number that counts up whenever its value changes. Visible at rest without JS. */
function Count({ value, format, className = "num" }: { value: number; format: (n: number) => string; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => { if (ref.current && Number.isFinite(value)) return countUp(ref.current, value, 900, format); }, [value, format]);
  return <span ref={ref} className={className}>{Number.isFinite(value) ? format(value) : "—"}</span>;
}

/** A 32-byte commitment: copy on click, the full hash stays visible. */
function HashTap({ hash }: { hash: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => { try { await navigator.clipboard.writeText(hash); setCopied(true); play("confirm"); setTimeout(() => setCopied(false), 2000); } catch { /* clipboard unavailable */ } };
  return <button type="button" className={`tap hash ${copied ? "copied" : ""}`} style={{ textAlign: "left" }} onClick={copy} title="Copy hash" aria-label={`Copy hash ${hash}`}>{copied ? "copied" : hash}</button>;
}

export default function Deploy() {
  const { deployment, address, openWallet, submit, transaction } = useProtocol();
  // Read the saved draft once, lazily, so no state is set inside an effect.
  const [restored] = useState(() => typeof window === "undefined" ? { draft: initial, created: null, step: 0 } : loadDraft());
  const [draft, setDraft] = useState<Draft>(restored.draft), [step, setStep] = useState(restored.step), [created, setCreated] = useState<Created | null>(restored.created);
  const [accepted, setAccepted] = useState(false), [error, setError] = useState(""), [progress, setProgress] = useState(""), [working, setWorking] = useState(false);
  const busy = working || transaction?.state === "approval" || transaction?.state === "pending";
  useEffect(() => { localStorage.setItem(DRAFT_KEY, JSON.stringify({ draft, created })); }, [draft, created]);
  useEffect(() => {
    if (!created || !deployment) return;
    let cancelled = false; const current = created;
    const client = createPublicClient({ transport: http(deployment.rpcUrl) });
    (async () => {
      try {
        if (current.registry.toLowerCase() !== deployment.registry.toLowerCase()) throw new Error("This saved agent belongs to another deployment.");
        const [hash, active, token] = await Promise.all([
          client.readContract({ address: current.agent, abi: vaultAbi as Abi, functionName: "manifestHash" }),
          client.readContract({ address: current.agent, abi: vaultAbi as Abi, functionName: "active" }),
          client.readContract({ address: current.agent, abi: vaultAbi as Abi, functionName: "agentToken" })]);
        if (hash !== current.manifestHash || String(token).toLowerCase() !== current.token.toLowerCase()) throw new Error("Saved agent details do not match this chain.");
        const balance = await client.readContract({ address: current.token, abi: tokenAbi as Abi, functionName: "balanceOf", args: [current.agent] }) as bigint;
        if (!cancelled) setCreated(previous => previous?.agent === current.agent ? { ...previous, active: active === true, fundingConfirmed: balance > 0n } : previous);
      } catch (e) { if (!cancelled) setError(`Could not restore agent state: ${(e as Error).message}`); }
    })();
    return () => { cancelled = true; };
  }, [created, deployment]);
  const change = (key: keyof Draft, value: string) => { setDraft(previous => ({ ...previous, [key]: value })); setError(""); };
  const budget = (() => { try { return BigInt(Math.ceil(30 * 86400 / (Number(draft.interval) * 60))) * parseEther(draft.reward); } catch { return 0n; } })();
  const ops = deployment?.operatingSymbol || "WETH", halo = deployment?.haloSymbol || "HALO";
  const explorerUrl = deployment?.explorerUrl;
  function validate(index: number) {
    const between = (value: string, min: number, max: number, label: string, integer = false) => { const parsed = Number(value); if (!value || !Number.isFinite(parsed) || parsed < min || parsed > max || (integer && !Number.isInteger(parsed))) throw new Error(`${label} must be ${min}–${max}${integer ? " as a whole number" : ""}.`); };
    if (index === 0) { if (!draft.name.trim() || new TextEncoder().encode(draft.name.trim()).length > 64) throw new Error("Enter a name of 1–64 UTF-8 bytes."); if (!/^[A-Z0-9]{1,12}$/.test(draft.symbol)) throw new Error("Use 1–12 uppercase letters or numbers for the symbol."); if (draft.description.length > 2000) throw new Error("Keep the strategy description below 2,000 characters."); }
    if (index === 1 && draft.modelMode === "custom-api") { const endpoint = new URL(draft.endpoint); if (endpoint.protocol !== "https:" || endpoint.username || endpoint.password) throw new Error("Use an HTTPS model URL without embedded credentials."); }
    if (index === 1 && !["public-baseline", "public-model", "custom-api"].includes(draft.modelMode)) throw new Error("Select a supported model mode.");
    if (index === 2) { between(draft.launches, 1, 10, "Daily launches", true); between(draft.position, 0.01, 25, "Position limit"); between(draft.daily, 0.01, 50, "Daily debit limit"); between(draft.slippage, 0.01, 5, "Slippage"); between(draft.interval, 15, 1440, "Work interval", true); }
    if (index === 3) { between(draft.target, 1e-12, 1e18, "Agent graduation target"); between(draft.childTarget, 1e-12, 1e18, "Child graduation target"); between(draft.tradingFee, 0.25, 2, "Trading fee"); between(draft.operations, 50, 90, "Operations share"); between(draft.halo, 10, 30, `${halo} share`); if (Number(draft.operations) + Number(draft.halo) > 100) throw new Error("Fee shares cannot exceed 100%."); }
    if (index === 4) { between(draft.reward, 1e-18, 1, "Work reward"); between(draft.initialBuy, 1e-18, 1e18, `Initial ${halo} purchase`); if (budget <= 0n) throw new Error("Enter a valid operating budget."); }
  }
  function next() { try { validate(step); setError(""); setStep(v => v + 1); } catch (e) { setError((e as Error).message); } }
  /** Stepper items jump back to any completed step; the draft locks once the agent exists on chain. */
  const jump = (index: number) => { if (index < step && !busy && !created) { setError(""); setStep(index); } };
  let fieldIndex = 0;
  const field = (key: keyof Draft, label: string, help?: string, numeric = false) => <div className="field reveal-up" style={{ "--i": fieldIndex++ % 8 } as React.CSSProperties} key={key}><label htmlFor={key}>{label}</label><input id={key} className="input" value={draft[key]} inputMode={numeric ? "decimal" : "text"} onChange={e => change(key, key === "symbol" ? e.target.value.toUpperCase() : e.target.value)} />{help && <small>{help}</small>}</div>;
  async function createAndFund() {
    if (!address) { openWallet(); return; }
    if (!deployment) { setError("No deployment is connected yet."); return; }
    setWorking(true); setError("");
    try {
      for (let i = 0; i <= 4; i++) validate(i);
      const client = createPublicClient({ transport: http(deployment.rpcUrl) });
      let current = created;
      if (!current) {
        setProgress("Publishing the exact agent manifest…");
        const policy = { maxPositionBps: Math.round(Number(draft.position) * 100), maxDailyDebitBps: Math.round(Number(draft.daily) * 100), maxLaunchesPerDay: Number(draft.launches), maxSlippageBps: Math.round(Number(draft.slippage) * 100), intervalSeconds: Number(draft.interval) * 60, workReward: parseEther(draft.reward).toString(), childGraduationTarget: parseEther(draft.childTarget).toString() };
        const manifest = { version: "halo.agent.v1", chainId: deployment.chainId, identity: { name: draft.name.trim(), symbol: draft.symbol, description: draft.description },
          models: { mode: draft.modelMode, core: "halo-core-v1", releaseSha256: deployment.coreReleaseSha256, proposalEndpoint: draft.modelMode === "custom-api" ? draft.endpoint : "", ...(draft.modelMode === "public-model" ? { proposalReleaseSha256: proposalModel.releaseSha256 } : {}),
            reproducibility: draft.modelMode === "custom-api" ? "external-provider" : draft.modelMode === "public-model" ? "public-weights" : "public-rules" }, policy,
          fees: { tradingBps: Math.round(Number(draft.tradingFee) * 100), operationsBps: Math.round(Number(draft.operations) * 100), haloBps: Math.round(Number(draft.halo) * 100), creator: address }, graduationTarget: parseEther(draft.target).toString() };
        const response = await fetch(`${deployment.artifactApiUrl || deployment.apiUrl}/v1/manifests`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(manifest) });
        const publication = await response.json() as { hash: string; uri: string; retrievalUrl?: string; error?: string };
        if (!response.ok) throw new Error(publication.error || "Manifest publication is unavailable.");
        if (publication.hash !== keccak256(toHex(canonical(manifest)))) throw new Error("Published manifest does not match your reviewed settings.");
        const content = await fetch(publication.retrievalUrl || publication.uri).then(r => r.text());
        if (keccak256(toHex(content)) !== publication.hash) throw new Error("Manifest retrieval failed its integrity check.");
        setProgress("Create the agent and its token in your wallet.");
        const hash = await submit(deployment.registry, registryAbi as Abi, "createAgent", [draft.name.trim(), draft.symbol, publication.hash, publication.uri, parseEther(draft.target), { ...policy, workReward: BigInt(policy.workReward), childGraduationTarget: BigInt(policy.childGraduationTarget) }, { ...manifest.fees, operations: address }], `Create ${draft.name}`);
        const receipt = await client.getTransactionReceipt({ hash });
        const event = receipt.logs.map(log => { try { return decodeEventLog({ abi: registryAbi as Abi, ...log }); } catch { return null; } }).find(log => log?.eventName === "AgentCreated");
        if (!event) throw new Error("Creation was confirmed but its registry event could not be read. Inspect the transaction before retrying.");
        const info = event.args as unknown as { agent: Address; token: Address; curve: Address; manifestHash: string };
        current = { ...info, registry: deployment.registry, fundingConfirmed: false, active: false }; setCreated(current); setStep(6);
      }
      if (current.registry.toLowerCase() !== deployment.registry.toLowerCase()) throw new Error("This saved draft belongs to another deployment.");
      const [onchainHash, creator, active, tradingBalance] = await Promise.all([
        client.readContract({ address: current.agent, abi: vaultAbi as Abi, functionName: "manifestHash" }),
        client.readContract({ address: current.agent, abi: vaultAbi as Abi, functionName: "creator" }),
        client.readContract({ address: current.agent, abi: vaultAbi as Abi, functionName: "active" }),
        client.readContract({ address: current.token, abi: tokenAbi as Abi, functionName: "balanceOf", args: [current.agent] }) as Promise<bigint>]);
      if (onchainHash !== current.manifestHash) throw new Error("The saved draft does not match this chain’s agent. Do not fund it.");
      if (String(creator).toLowerCase() !== address.toLowerCase()) throw new Error("Connect the wallet that created this agent to complete setup.");
      if (active === true) { setCreated({ ...current, active: true }); setProgress("Activation is already confirmed on chain."); return; }
      // A confirmed purchase may outlive the tab that submitted it. Recover from the vault balance before requesting another payment.
      if (tradingBalance === 0n) {
        const input = parseEther(draft.initialBuy);
        const quote = await client.readContract({ address: current.curve, abi: curveAbi as Abi, functionName: "quoteBuy", args: [input] }) as readonly bigint[];
        setProgress(`Approve the initial ${halo} allocation, then purchase trading inventory for the vault.`);
        await submit(deployment.rootHalo, tokenAbi as Abi, "approve", [current.curve, input], `Approve initial ${halo} allocation`);
        await submit(current.curve, curveAbi as Abi, "buy", [input, quote[0] * 99n / 100n, current.agent, (await client.getBlock()).timestamp + 120n], "Fund the agent’s trading inventory");
      }
      current = { ...current, fundingConfirmed: true }; setCreated(current);
      const [required, funded] = await Promise.all([client.readContract({ address: current.agent, abi: vaultAbi as Abi, functionName: "reserveRequired", args: [30n] }) as Promise<bigint>,
        client.readContract({ address: deployment.operatingToken, abi: tokenAbi as Abi, functionName: "balanceOf", args: [current.agent] }) as Promise<bigint>]);
      if (funded < required) { setProgress("Transfer the remaining operating reserve."); await submit(deployment.operatingToken, tokenAbi as Abi, "transfer", [current.agent, required - funded], "Fund 30 days of verified work"); }
      setProgress("Funding confirmed. Review the commitment, then activate when ready."); setStep(6);
    } catch (e) { setError((e as Error).message); } finally { setWorking(false); }
  }
  async function activate() {
    if (!created || !accepted) return;
    setWorking(true); setError("");
    try { await submit(created.agent, vaultAbi as Abi, "activate", [], `Activate ${draft.name}`); setCreated({ ...created, active: true }); setProgress("Activation confirmed on chain. Independent operators can now execute verified work."); }
    catch (e) { setError((e as Error).message); } finally { setWorking(false); }
  }
  const reset = () => { setCreated(null); setDraft(initial); setStep(0); setAccepted(false); setProgress(""); setError(""); };
  const modelOptions = [["public-baseline", "Rules baseline", "Deterministic public research rules. No model weights, fully reproducible."], ["public-model", "Public AI model", `${proposalModel.name}: committed public weights, prompt and adapter.`], ["custom-api", "Custom API", "Your own HTTPS proposal endpoint. The endpoint owner can change its answers."]] as const;

  /* Preview maths. The statue is the one the agent will actually get: seeded by its vault address once created, by the connected wallet before, by the name while drafting. */
  const seed = created?.agent || address || draft.name.trim() || "talos";
  const creatorShare = 100 - Number(draft.operations) - Number(draft.halo);
  const cyclesPerMonth = Number.isFinite(Number(draft.interval)) && Number(draft.interval) > 0 ? Math.ceil(30 * 86400 / (Number(draft.interval) * 60)) : 0;
  const reserve = Number(formatEther(budget));
  const initialBuy = Number(draft.initialBuy);
  const symbol = draft.symbol || "AGENT";

  return <main id="main" className="wrap page">
    <div className="reveal-up"><p className="eyebrow">Make something autonomous</p><h1>Deploy an agent</h1><p className="lede" style={{ marginTop: 8 }}>A name, a model, immutable limits and an economy of its own. You keep the creator fee; the agent keeps the rest.</p></div>
    <div className="wizard">
      <section className="wizard-form" aria-labelledby="wizard-step">
        <ol className="stepper reveal-up" aria-label="Steps">{steps.map((label, i) => {
          const done = i < step, reachable = done && !busy && !created;
          return <li key={label} className={done ? "done" : ""} aria-current={step === i ? "step" : undefined} style={{ "--i": i } as React.CSSProperties}>
            <button type="button" onClick={() => jump(i)} disabled={!reachable} aria-disabled={!reachable} title={reachable ? `Back to ${label}` : done ? `${label} is locked` : step === i ? `${label}, current step` : `${label}, not reached yet`} style={{ display: "inline-flex", alignItems: "center", gap: 8, color: "inherit", cursor: reachable ? "pointer" : "default" }}>
              <span>{done ? <Check size={12} /> : i + 1}</span>{label}
            </button>
          </li>; })}</ol>
        <div className="panel reveal-up" style={{ "--i": 1 } as React.CSSProperties}>
          <div className="panel-head"><div><h2 id="wizard-step">{steps[step]}</h2><p>{stepIntro[step]}</p></div><span className="count num" aria-label={`Step ${step + 1} of ${steps.length}`}>{step + 1} / {steps.length}</span></div>
          <div className="fields" key={step}>
            {step === 0 && <><div className="fields two">{field("name", "Agent name", "Up to 64 UTF-8 bytes.")}{field("symbol", "Token symbol", "1–12 uppercase letters or numbers.")}</div><div className="field reveal-up" style={{ "--i": 2 } as React.CSSProperties}><label htmlFor="description">Strategy and narrative interests</label><textarea id="description" className="input" rows={4} placeholder="What should this agent explore?" value={draft.description} onChange={e => change("description", e.target.value)} /><small>Guides proposals. Never overrides spending limits.</small></div></>}
            {step === 1 && <><div className="option-cards">{modelOptions.map(([value, title, text], i) => <button type="button" key={value} className="option-card reveal-up" style={{ "--i": i } as React.CSSProperties} data-sfx aria-pressed={draft.modelMode === value} onClick={() => change("modelMode", value)}><strong>{title}</strong><p>{text}</p></button>)}</div>
              {draft.modelMode === "custom-api" && field("endpoint", "Proposal API endpoint", "Public HTTPS URL only. Never put API keys in this public manifest.")}
              {draft.modelMode === "public-model" && <div className="hash-block reveal-up" style={{ "--i": 3 } as React.CSSProperties}><p>{proposalModel.name} · committed release</p><HashTap hash={proposalModel.releaseSha256} /><a className="pill sm" href={`/models/${proposalModel.releaseSha256}.json`} target="_blank" rel="noreferrer">Inspect the release <ArrowRight size={14} /></a></div>}
              <p className="notice reveal-up" style={{ "--i": 4 } as React.CSSProperties}>Proposal models are advisory. The fixed decision core checks the spending envelope; it does not prove profitable predictions or exclusive AI authorship.</p></>}
            {step === 2 && <div className="fields two">{field("launches", "Max child launches per day", "1–10.", true)}{field("position", "Max position (%)", "Up to 25% of accounted capital.", true)}{field("daily", "Daily trading budget (%)", "Up to 50%.", true)}{field("slippage", "Max slippage (%)", "Up to 5% below the recorded quote.", true)}{field("interval", "Work interval (minutes)", "15–1,440 between paid cycles.", true)}</div>}
            {step === 3 && <><div className="fields two">{field("target", `Agent graduation target (${halo})`, "Reserves required to graduate the agent token.", true)}{field("childTarget", `Child graduation target (${draft.symbol || "agent tokens"})`, "Each child is quoted in the agent token.", true)}{field("tradingFee", "Trading fee (%)", "0.25–2%, fixed for the agent and its children.", true)}{field("operations", "Operations share (%)", "At least 50%.", true)}{field("halo", `${halo} share (%)`, "10–30%.", true)}</div><p className="notice ok reveal-up" style={{ "--i": 5 } as React.CSSProperties}>Creator share: <Count value={creatorShare} format={fmtPct} /> of every trading fee, paid to your wallet.</p></>}
            {step === 4 && <><div className="fields two">{field("initialBuy", `Initial trading allocation (${halo})`, `Buys ${draft.symbol || "agent tokens"} straight into the vault.`, true)}{field("reward", `Reward per work cycle (${ops})`, "Must cover an operator’s compute and gas.", true)}</div>
              <dl className="metrics reveal-up" style={{ "--i": 2 } as React.CSSProperties}>
                <div className="metric"><dt>Cycles in 30 days</dt><dd><Count value={cyclesPerMonth} format={fmtInt} /></dd></div>
                <div className="metric"><dt>Reward per cycle</dt><dd><Count value={Number(draft.reward)} format={fmtReserve} /><small>{ops}</small></dd></div>
                <div className="metric"><dt>30-day operating reserve</dt><dd><Count value={reserve} format={fmtReserve} /><small>{ops}</small></dd></div>
              </dl>
              <p className="notice reveal-up" style={{ "--i": 3 } as React.CSSProperties}>Below seven days of reserve the policy blocks new exposure. Anyone can top it up.</p></>}
            {step === 5 && <><div className="table-scroll reveal-up"><table className="table kv"><tbody>
              <tr><th>Agent</th><td>{draft.name} / ${draft.symbol}</td></tr>
              <tr><th>Network</th><td>{deployment ? explorerUrl ? <a className="tap" href={explorerUrl} target="_blank" rel="noreferrer">{deployment.chainName} ↗</a> : deployment.chainName : "Not connected"}</td></tr>
              <tr><th>Model</th><td>{modelOptions.find(o => o[0] === draft.modelMode)?.[1]}{draft.modelMode === "public-model" && <> · <a className="tap" href={`/models/${proposalModel.releaseSha256}.json`} target="_blank" rel="noreferrer">release ↗</a></>}</td></tr>
              <tr><th>Launch limit</th><td className="num">{draft.launches} per UTC day</td></tr>
              <tr><th>Position / daily limit</th><td className="num">{draft.position}% / {draft.daily}%</td></tr>
              <tr><th>Trading fee</th><td className="num">{draft.tradingFee}% · {draft.operations}/{draft.halo}/{creatorShare}</td></tr>
              <tr><th>Initial allocation</th><td className="num">{draft.initialBuy} {halo}</td></tr>
              <tr><th>Operating reserve</th><td className="num">{formatEther(budget)} {ops}</td></tr>
              <tr><th>Creator</th><td>{address ? <AddressTap address={address} explorerUrl={explorerUrl} /> : <button type="button" className="tap" onClick={openWallet}>Connect wallet</button>}</td></tr>
            </tbody></table></div>
              <p className="notice warn reveal-up" style={{ "--i": 1 } as React.CSSProperties}>This creates fixed-supply tokens and a vault. Each funding transaction needs your approval. Activation is a separate, final transaction.</p>
              <div className="row reveal-up" style={{ "--i": 2 } as React.CSSProperties}><button type="button" className="pill primary lg" data-sfx="confirm" disabled={busy} onClick={createAndFund}>{address ? "Create and fund agent" : "Connect wallet"} <ArrowRight size={17} className="arrow" /></button></div></>}
            {step === 6 && created && <>
              <Link href={`/agents/${created.agent}`} className="card hover reveal-up" aria-label={`Open ${draft.name}’s agent page`}>
                <div className="card-art"><img src={statueFor(created.agent)} alt="" loading="lazy" decoding="async" /></div>
                <div className="card-badges">{created.active ? <span className="chip green live"><i />Live</span> : created.fundingConfirmed ? <span className="chip bronze">Funded</span> : <span className="chip">Created</span>}</div>
                <div className="card-body">
                  <div className="card-title"><div><strong>{draft.name}</strong><span className="ticker">${draft.symbol} / ${halo}</span></div><div className="mc"><b className="num">{draft.tradingFee}%</b><span>trading fee</span></div></div>
                  <div className="card-meta"><span className="cycle">{deployment?.chainName || "chain"}</span><span>Open agent page →</span></div>
                </div>
              </Link>
              <div className="list">
                {([["Agent vault", created.agent], ["Agent token", created.token], ["Bonding curve", created.curve]] as const).map(([label, value], i) => <div key={label} className="list-row reveal-up" style={{ "--i": i } as React.CSSProperties}><span className="mono">{label}</span><AddressTap address={value} explorerUrl={explorerUrl} /><Link className="pill sm" href={label === "Agent vault" ? `/agents/${created.agent}` : `/tokens/${created.token}`}>{label === "Agent vault" ? "Agent" : "Token"} <ArrowRight size={13} className="arrow" /></Link></div>)}
                <div className="hash-block reveal-up" style={{ "--i": 3 } as React.CSSProperties}><p>Manifest commitment</p><HashTap hash={created.manifestHash} /></div>
              </div>
              {created.active ? <><p className="notice ok reveal-up">Activated on chain. Every future transaction requires the fixed decision proof and policy checks.</p><div className="row reveal-up"><Link href={`/agents/${created.agent}`} className="pill primary" data-sfx="click">Open {draft.name}’s profile <ArrowRight size={15} className="arrow" /></Link><Link href={`/tokens/${created.token}`} className="pill">Trade ${draft.symbol}</Link><button type="button" className="pill ghost" onClick={reset}>Create another agent</button></div></>
                : <><div className="row reveal-up"><button type="button" className="pill" data-sfx="confirm" disabled={busy} onClick={createAndFund}>Check and complete funding</button>{created.fundingConfirmed && <span className="chip green">Funding confirmed</span>}</div>
                  <label className="row reveal-up" style={{ gap: 10 }}><input type="checkbox" checked={accepted} onChange={e => setAccepted(e.target.checked)} /><span>I understand that activation permanently removes my ability to withdraw the vault’s funds or change its policy.</span></label>
                  <button type="button" className="pill primary lg reveal-up" data-sfx="confirm" disabled={busy || !accepted || !created.fundingConfirmed} onClick={activate}>Activate {draft.name} permanently</button></>}
              <p className="dim">Creator {address ? <AddressTap address={address} explorerUrl={explorerUrl} /> : "wallet not connected"}. Execution needs funded operators and a working chain.</p></>}
          </div>
          {progress && <p role="status" className="notice" style={{ marginTop: 14 }}>{progress}</p>}{error && <p role="alert" className="notice err" style={{ marginTop: 14 }}>{error}</p>}
          {step < 6 && <div className="wizard-controls" style={{ marginTop: 18 }}><button type="button" className="pill" disabled={step === 0 || busy || !!created} onClick={() => setStep(v => v - 1)}>Back to {steps[Math.max(0, step - 1)]}</button>{step < 5 && <button type="button" className="pill primary" onClick={next}>Continue to {steps[step + 1]} <ArrowRight size={16} className="arrow" /></button>}</div>}
        </div>
      </section>
      <aside className="panel tint sticky preview-card reveal-up" style={{ "--i": 2 } as React.CSSProperties} aria-label="Your agent preview">
        <div className="art"><img src={statueFor(seed)} alt="" decoding="async" /></div>
        <div>
          <p className="eyebrow">{created ? "Your agent" : "Preview"}</p>
          <h3 style={{ fontFamily: "var(--font-display)", fontWeight: 500, fontSize: "1.8rem", lineHeight: 1.05 }}>{created ? <Link href={`/agents/${created.agent}`}>{draft.name}</Link> : draft.name || "Your agent"}</h3>
          <p className="mono">{created ? <Link href={`/tokens/${created.token}`}>${symbol} / ${halo}</Link> : `$${symbol} / $${halo}`}</p>
        </div>
        <dl className="metrics" style={{ gridTemplateColumns: "1fr 1fr" }}>
          <div className="metric"><dt>Trading allocation</dt><dd><Count value={initialBuy} format={fmtAmount} /><small>{halo}</small></dd></div>
          <div className="metric"><dt>Operating reserve</dt><dd><Count value={reserve} format={fmtReserve} /><small>{ops}</small></dd></div>
        </dl>
        <div className="kv">
          <div><span>Cycles in 30 days</span><strong><Count value={cyclesPerMonth} format={fmtInt} /> × <Count value={Number(draft.reward)} format={fmtReserve} /> {ops}</strong></div>
          <div><span>Trading fee</span><strong><Count value={Number(draft.tradingFee)} format={fmtPct} /></strong></div>
          <div><span>Fee split</span><strong className="num">{draft.operations} / {draft.halo} / {creatorShare}</strong></div>
          <div><span>Creator fee share</span><strong><Count value={creatorShare} format={fmtPct} /></strong></div>
          <div><span>Pairing</span><strong>${symbol} / ${halo}</strong></div>
          <div><span>Children pair with</span><strong>${symbol}</strong></div>
          <div><span>Graduation</span><strong><Count value={Number(draft.target)} format={fmtAmount} /> {halo} → Uniswap v4, locked</strong></div>
          <div><span>Network</span><strong>{deployment?.chainName || "Not connected"}</strong></div>
        </div>
        <p className="dim">{created ? "Recorded on chain. The vault address seeds the statue." : "Preview only. The chain is the source of truth once you create."}</p>
      </aside>
    </div>
  </main>;
}
