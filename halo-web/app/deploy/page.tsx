"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { createPublicClient, decodeEventLog, http, parseEther, formatEther, keccak256, toHex, type Abi, type Address } from "viem";
import { ArrowRight, Check } from "lucide-react";
import { useProtocol } from "@/components/halo/protocol-provider";
import { shortAddress } from "@/lib/format";
import registryAbi from "@/lib/generated/AgentRegistry.json";
import vaultAbi from "@/lib/generated/AgentVault.json";
import tokenAbi from "@/lib/generated/HaloToken.json";
import curveAbi from "@/lib/generated/HaloCurve.json";
import proposalModel from "@/lib/generated/ProposalModel.json";

const steps = ["Identity", "Model", "Limits", "Economics", "Funding", "Review", "Activate"];
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
  function validate(index: number) {
    const between = (value: string, min: number, max: number, label: string, integer = false) => { const parsed = Number(value); if (!value || !Number.isFinite(parsed) || parsed < min || parsed > max || (integer && !Number.isInteger(parsed))) throw new Error(`${label} must be ${min}–${max}${integer ? " as a whole number" : ""}.`); };
    if (index === 0) { if (!draft.name.trim() || new TextEncoder().encode(draft.name.trim()).length > 64) throw new Error("Enter a name of 1–64 UTF-8 bytes."); if (!/^[A-Z0-9]{1,12}$/.test(draft.symbol)) throw new Error("Use 1–12 uppercase letters or numbers for the symbol."); if (draft.description.length > 2000) throw new Error("Keep the strategy description below 2,000 characters."); }
    if (index === 1 && draft.modelMode === "custom-api") { const endpoint = new URL(draft.endpoint); if (endpoint.protocol !== "https:" || endpoint.username || endpoint.password) throw new Error("Use an HTTPS model URL without embedded credentials."); }
    if (index === 1 && !["public-baseline", "public-model", "custom-api"].includes(draft.modelMode)) throw new Error("Select a supported model mode.");
    if (index === 2) { between(draft.launches, 1, 10, "Daily launches", true); between(draft.position, 0.01, 25, "Position limit"); between(draft.daily, 0.01, 50, "Daily debit limit"); between(draft.slippage, 0.01, 5, "Slippage"); between(draft.interval, 15, 1440, "Work interval", true); }
    if (index === 3) { between(draft.target, 1e-12, 1e18, "Agent graduation target"); between(draft.childTarget, 1e-12, 1e18, "Child graduation target"); between(draft.tradingFee, 0.25, 2, "Trading fee"); between(draft.operations, 50, 90, "Operations share"); between(draft.halo, 10, 30, "HALO share"); if (Number(draft.operations) + Number(draft.halo) > 100) throw new Error("Fee shares cannot exceed 100%."); }
    if (index === 4) { between(draft.reward, 1e-18, 1, "Work reward"); between(draft.initialBuy, 1e-18, 1e18, "Initial HALO purchase"); if (budget <= 0n) throw new Error("Enter a valid operating budget."); }
  }
  function next() { try { validate(step); setError(""); setStep(v => v + 1); } catch (e) { setError((e as Error).message); } }
  const field = (key: keyof Draft, label: string, help?: string, numeric = false) => <div className="field" key={key}><label htmlFor={key}>{label}</label><input id={key} className="input" value={draft[key]} inputMode={numeric ? "decimal" : "text"} onChange={e => change(key, key === "symbol" ? e.target.value.toUpperCase() : e.target.value)} />{help && <small>{help}</small>}</div>;
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
  return <main id="main" className="wrap page">
    <div><p className="eyebrow">Make something autonomous</p><h1>Deploy an agent</h1><p className="lede" style={{ marginTop: 8 }}>A name, a model, immutable limits and an economy of its own. You keep the creator fee; the agent keeps the rest.</p></div>
    <div className="wizard">
      <section className="wizard-form">
        <ol className="stepper" aria-label="Steps">{steps.map((label, i) => <li key={label} className={i < step ? "done" : ""} aria-current={step === i ? "step" : undefined}><span>{i < step ? <Check size={12} /> : i + 1}</span>{label}</li>)}</ol>
        <div className="panel">
          <div className="panel-head"><div><h2>{steps[step]}</h2><p>{["Choose the identity people will discover.", "Pick who proposes narratives and trades. The spending core stays fixed.", "These limits become immutable when you activate.", "Every child inherits the agent’s committed fees.", "Separate trading capital from the cost of running the agent.", "Review exactly what your wallet will create.", "Funding and activation are separate confirmed states."][step]}</p></div></div>
          <div className="fields">
            {step === 0 && <><div className="fields two">{field("name", "Agent name", "Up to 64 UTF-8 bytes.")}{field("symbol", "Token symbol", "1–12 uppercase letters or numbers.")}</div><div className="field"><label htmlFor="description">Strategy and narrative interests</label><textarea id="description" className="input" rows={4} placeholder="What should this agent explore?" value={draft.description} onChange={e => change("description", e.target.value)} /><small>Guides proposals. Never overrides spending limits.</small></div></>}
            {step === 1 && <><div className="option-cards">{modelOptions.map(([value, title, text]) => <button type="button" key={value} className="option-card" aria-pressed={draft.modelMode === value} onClick={() => change("modelMode", value)}><strong>{title}</strong><p>{text}</p></button>)}</div>
              {draft.modelMode === "custom-api" && field("endpoint", "Proposal API endpoint", "Public HTTPS URL only. Never put API keys in this public manifest.")}
              {draft.modelMode === "public-model" && <div className="hash-block"><p>{proposalModel.name} · committed release</p><code>{proposalModel.releaseSha256}</code><a href={`/models/${proposalModel.releaseSha256}.json`} target="_blank" rel="noreferrer">Inspect the release</a></div>}
              <p className="notice">Proposal models are advisory. The fixed decision core checks the spending envelope; it does not prove profitable predictions or exclusive AI authorship.</p></>}
            {step === 2 && <div className="fields two">{field("launches", "Max child launches per day", "1–10.", true)}{field("position", "Max position (%)", "Up to 25% of accounted capital.", true)}{field("daily", "Daily trading budget (%)", "Up to 50%.", true)}{field("slippage", "Max slippage (%)", "Up to 5% below the recorded quote.", true)}{field("interval", "Work interval (minutes)", "15–1,440 between paid cycles.", true)}</div>}
            {step === 3 && <><div className="fields two">{field("target", `Agent graduation target (${halo})`, "Reserves required to graduate the agent token.", true)}{field("childTarget", `Child graduation target (${draft.symbol || "agent tokens"})`, "Each child is quoted in the agent token.", true)}{field("tradingFee", "Trading fee (%)", "0.25–2%, fixed for the agent and its children.", true)}{field("operations", "Operations share (%)", "At least 50%.", true)}{field("halo", "HALO share (%)", "10–30%.", true)}</div><p className="notice ok">Creator share: {100 - Number(draft.operations) - Number(draft.halo)}% of every trading fee, paid to your wallet.</p></>}
            {step === 4 && <><div className="fields two">{field("initialBuy", `Initial trading allocation (${halo})`, `Buys ${draft.symbol || "agent tokens"} straight into the vault.`, true)}{field("reward", `Reward per work cycle (${ops})`, "Must cover an operator’s compute and gas.", true)}</div><div className="hash-block"><p>Required 30-day operating reserve</p><strong>{formatEther(budget)} {ops}</strong><p>Below seven days of reserve the policy blocks new exposure. Anyone can top it up.</p></div></>}
            {step === 5 && <><table className="table kv"><tbody><tr><th>Agent</th><td>{draft.name} / ${draft.symbol}</td></tr><tr><th>Network</th><td>{deployment?.chainName || "Not connected"}</td></tr><tr><th>Model</th><td>{modelOptions.find(o => o[0] === draft.modelMode)?.[1]}</td></tr><tr><th>Launch limit</th><td>{draft.launches} per UTC day</td></tr><tr><th>Position / daily limit</th><td>{draft.position}% / {draft.daily}%</td></tr><tr><th>Trading fee</th><td>{draft.tradingFee}% · {draft.operations}/{draft.halo}/{100 - Number(draft.operations) - Number(draft.halo)}</td></tr><tr><th>Initial allocation</th><td>{draft.initialBuy} {halo}</td></tr><tr><th>Operating reserve</th><td>{formatEther(budget)} {ops}</td></tr></tbody></table>
              <p className="notice warn">This creates fixed-supply tokens and a vault. Each funding transaction needs your approval. Activation is a separate, final transaction.</p><button type="button" className="pill primary lg" disabled={busy} onClick={createAndFund}>{address ? "Create and fund agent" : "Connect wallet"} <ArrowRight size={17} /></button></>}
            {step === 6 && created && <><div className="hash-block"><p>Agent vault</p><code>{created.agent}</code></div><div className="hash-block"><p>Manifest commitment</p><code>{created.manifestHash}</code></div>
              {created.active ? <><p className="notice ok">Activated on chain. Every future transaction requires the fixed decision proof and policy checks.</p><div className="row"><Link href={`/agents/${created.agent}`} className="pill primary">Open {draft.name}’s profile</Link><button type="button" className="pill" onClick={reset}>Create another</button></div></>
                : <><button type="button" className="pill" disabled={busy} onClick={createAndFund}>Check and complete funding</button>
                  <label className="row" style={{ gap: 10 }}><input type="checkbox" checked={accepted} onChange={e => setAccepted(e.target.checked)} /><span>I understand that activation permanently removes my ability to withdraw the vault’s funds or change its policy.</span></label>
                  <button type="button" className="pill primary lg" disabled={busy || !accepted || !created.fundingConfirmed} onClick={activate}>Activate {draft.name} permanently</button></>}
              <p className="dim">Creator {address ? shortAddress(address) : "wallet not connected"}. Execution needs funded operators and a working chain.</p></>}
          </div>
          {progress && <p role="status" className="notice" style={{ marginTop: 14 }}>{progress}</p>}{error && <p role="alert" className="notice err" style={{ marginTop: 14 }}>{error}</p>}
          {step < 6 && <div className="wizard-controls" style={{ marginTop: 18 }}><button type="button" className="pill" disabled={step === 0 || busy || !!created} onClick={() => setStep(v => v - 1)}>Back</button>{step < 5 && <button type="button" className="pill primary" onClick={next}>Continue <ArrowRight size={16} /></button>}</div>}
        </div>
      </section>
      <aside className="panel sticky preview-card" aria-label="Your agent preview">
        <div className="art"><Image src="/art/hero-sunset.webp" alt="" width={600} height={600} unoptimized /></div>
        <div><h3 style={{ fontSize: "1.3rem" }}>{draft.name || "Your agent"}</h3><p>${draft.symbol || "AGENT"} / ${halo}</p></div>
        <div className="kv"><div><span>Launch cost</span><strong>{draft.initialBuy || "0"} {halo} + {formatEther(budget)} {ops}</strong></div><div><span>Trading fee</span><strong>{draft.tradingFee}%</strong></div><div><span>Pairing</span><strong>${draft.symbol || "AGENT"} / ${halo}</strong></div><div><span>Children pair with</span><strong>${draft.symbol || "AGENT"}</strong></div><div><span>Graduation</span><strong>{draft.target} {halo} → Uniswap v4, locked</strong></div><div><span>Creator fee share</span><strong>{100 - Number(draft.operations) - Number(draft.halo)}%</strong></div></div>
        <p className="dim">Preview only. The chain is the source of truth once you create.</p>
      </aside>
    </div>
  </main>;
}
