"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { createPublicClient, decodeEventLog, http, parseEther, formatEther, keccak256, toHex, type Abi, type Address } from "viem";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Field, FieldGroup, FieldLabel, FieldDescription } from "@/components/ui/field";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Checkbox } from "@/components/ui/checkbox";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useProtocol } from "@/components/halo/protocol-provider";
import { shortAddress } from "@/lib/halo-types";
import registryAbi from "@/lib/generated/AgentRegistry.json";
import vaultAbi from "@/lib/generated/AgentVault.json";
import tokenAbi from "@/lib/generated/HaloToken.json";
import curveAbi from "@/lib/generated/HaloCurve.json";
import proposalModel from "@/lib/generated/ProposalModel.json";

const steps = ["Identity", "Models", "Strategy", "Curve & fees", "Funding", "Review", "Activation"];
const initial = { name: "", symbol: "", description: "", modelMode: "public-baseline", endpoint: "", launches: "1", position: "10", daily: "10", slippage: "3", interval: "15", reward: "0.00005", target: "1000000", childTarget: "1000000", tradingFee: "1", operations: "60", halo: "20", initialBuy: "1000" };
type Draft = typeof initial;
type Created = { agent: Address; token: Address; curve: Address; manifestHash: string; registry: Address; fundingConfirmed: boolean; active: boolean };
function canonical(value: unknown): string { if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`; if (value !== null && typeof value === "object") return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(",")}}`; return JSON.stringify(value); }

export default function Deploy() {
  const { deployment, address, openWallet, submit, transaction } = useProtocol();
  const [draft, setDraft] = useState<Draft>(initial), [step, setStep] = useState(0), [accepted, setAccepted] = useState(false), [error, setError] = useState(""), [progress, setProgress] = useState("");
  const [created, setCreated] = useState<Created | null>(null), [working, setWorking] = useState(false), [loaded, setLoaded] = useState(false);
  const busy = working || transaction?.state === "approval" || transaction?.state === "pending";
  useEffect(() => {
    try { const saved = JSON.parse(localStorage.getItem("halo:agent-draft:v1") || "null");
      if (saved?.draft && Object.keys(initial).every(key => typeof saved.draft[key] === "string")) { setDraft(saved.draft); if (saved.created?.agent?.match(/^0x[0-9a-fA-F]{40}$/)) { setCreated({ ...saved.created, active: false, fundingConfirmed: false }); setStep(6); } }
    } catch { /* A broken device-local draft is not an on-chain state. */ }
    setLoaded(true);
  }, []);
  useEffect(() => { if (loaded) localStorage.setItem("halo:agent-draft:v1", JSON.stringify({ draft, created })); }, [draft, created, loaded]);
  useEffect(() => {
    if (!created || !deployment) return;
    let cancelled = false;
    const current = created;
    const client = createPublicClient({ transport: http(deployment.rpcUrl) });
    async function reconcile() {
      try {
        if (current.registry.toLowerCase() !== deployment!.registry.toLowerCase()) throw new Error("This saved agent belongs to another deployment.");
        const [hash, active, token] = await Promise.all([
          client.readContract({ address: current.agent, abi: vaultAbi as Abi, functionName: "manifestHash" }),
          client.readContract({ address: current.agent, abi: vaultAbi as Abi, functionName: "active" }),
          client.readContract({ address: current.agent, abi: vaultAbi as Abi, functionName: "agentToken" }),
        ]);
        if (hash !== current.manifestHash || String(token).toLowerCase() !== current.token.toLowerCase()) throw new Error("Saved agent details do not match this chain.");
        const balance = await client.readContract({ address: current.token, abi: tokenAbi as Abi, functionName: "balanceOf", args: [current.agent] }) as bigint;
        if (!cancelled) setCreated(previous => previous?.agent === current.agent ? { ...previous, active: active === true, fundingConfirmed: balance > 0n } : previous);
      } catch (error) { if (!cancelled) setError(`Could not restore agent state: ${(error as Error).message}`); }
    }
    void reconcile();
    return () => { cancelled = true; };
  }, [created?.agent, created?.manifestHash, created?.registry, created?.token, deployment]);
  const change = (key: keyof Draft, value: string) => { setDraft(previous => ({ ...previous, [key]: value })); setError(""); };
  const budget = (() => { try { return BigInt(Math.ceil(30 * 86400 / (Number(draft.interval) * 60))) * parseEther(draft.reward); } catch { return 0n; } })();
  function validate(index: number) {
    const between = (value: string, min: number, max: number, label: string, integer = false) => { const parsed = Number(value); if (!value || !Number.isFinite(parsed) || parsed < min || parsed > max || integer && !Number.isInteger(parsed)) throw new Error(`${label} must be ${min}–${max}${integer ? " as a whole number" : ""}.`); };
    if (index === 0) { if (!draft.name.trim() || new TextEncoder().encode(draft.name.trim()).length > 64) throw new Error("Enter a name of 1–64 UTF-8 bytes."); if (!/^[A-Z0-9]{1,12}$/.test(draft.symbol)) throw new Error("Use 1–12 uppercase letters or numbers for the symbol."); if (draft.description.length > 2000) throw new Error("Keep the strategy description below 2,000 characters."); }
    if (index === 1 && draft.modelMode === "custom-api") { const endpoint = new URL(draft.endpoint); if (endpoint.protocol !== "https:" || endpoint.username || endpoint.password) throw new Error("Use an HTTPS model URL without embedded credentials."); }
    if (index === 1 && !["public-baseline", "public-model", "custom-api"].includes(draft.modelMode)) throw new Error("Select a supported model mode.");
    if (index === 2) { between(draft.launches, 1, 10, "Daily launches", true); between(draft.position, 0.01, 25, "Position limit"); between(draft.daily, 0.01, 50, "Daily debit limit"); between(draft.slippage, 0.01, 5, "Slippage"); between(draft.interval, 15, 1440, "Work interval", true); }
    if (index === 3) { between(draft.target, 0.000000000001, 1e18, "Agent graduation target"); between(draft.childTarget, 0.000000000001, 1e18, "Child graduation target"); between(draft.tradingFee, 0.25, 2, "Trading fee"); between(draft.operations, 50, 90, "Operations share"); between(draft.halo, 10, 30, "HALO share"); if (Number(draft.operations) + Number(draft.halo) > 100) throw new Error("Fee shares cannot exceed 100%."); }
    if (index === 4) { between(draft.reward, 0.000000000000000001, 1, "Work reward"); between(draft.initialBuy, 0.000000000000000001, 1e18, "Initial HALO purchase"); if (budget <= 0n) throw new Error("Enter a valid operating budget."); }
  }
  function next() { try { validate(step); setError(""); setStep(value => value + 1); } catch (error) { setError((error as Error).message); } }
  function field(key: keyof Draft, label: string, help?: string, numeric = false) { return <Field key={key}><FieldLabel htmlFor={key}>{label}</FieldLabel><Input id={key} value={draft[key]} inputMode={numeric ? "decimal" : "text"} onChange={event => change(key, key === "symbol" ? event.target.value.toUpperCase() : event.target.value)} /><FieldDescription>{help}</FieldDescription></Field>; }
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
          models: { mode: draft.modelMode, core: "halo-core-v1", releaseSha256: deployment.coreReleaseSha256, proposalEndpoint: draft.modelMode === "custom-api" ? draft.endpoint : "",
            ...(draft.modelMode === "public-model" ? { proposalReleaseSha256: proposalModel.releaseSha256 } : {}),
            reproducibility: draft.modelMode === "custom-api" ? "external-provider" : draft.modelMode === "public-model" ? "public-weights" : "public-rules" }, policy,
          fees: { tradingBps: Math.round(Number(draft.tradingFee) * 100), operationsBps: Math.round(Number(draft.operations) * 100), haloBps: Math.round(Number(draft.halo) * 100), creator: address }, graduationTarget: parseEther(draft.target).toString() };
        const response = await fetch(`${deployment.artifactApiUrl || deployment.apiUrl}/v1/manifests`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(manifest) });
        const publication = await response.json() as { hash: string; uri: string; retrievalUrl?: string; error?: string };
        if (!response.ok) throw new Error(publication.error || "Manifest publication is unavailable.");
        if (publication.hash !== keccak256(toHex(canonical(manifest)))) throw new Error("Published manifest does not match your reviewed settings.");
        const content = await fetch(publication.retrievalUrl || publication.uri).then(result => result.text());
        if (keccak256(toHex(content)) !== publication.hash) throw new Error("Manifest retrieval failed its integrity check.");
        setProgress("Create the agent and its token in your wallet.");
        const hash = await submit(deployment.registry, registryAbi as Abi, "createAgent", [draft.name.trim(), draft.symbol, publication.hash, publication.uri, parseEther(draft.target), { ...policy, workReward: BigInt(policy.workReward), childGraduationTarget: BigInt(policy.childGraduationTarget) }, { ...manifest.fees, operations: address }], `Create ${draft.name}`);
        const receipt = await client.getTransactionReceipt({ hash });
        const event = receipt.logs.map(log => { try { return decodeEventLog({ abi: registryAbi as Abi, ...log }); } catch { return null; } }).find(log => log?.eventName === "AgentCreated");
        if (!event) throw new Error("Creation was confirmed but its registry event could not be read. Inspect the transaction before retrying.");
        const info = event.args as unknown as { agent: Address; token: Address; curve: Address; manifestHash: string };
        current = { ...info, registry: deployment.registry, fundingConfirmed: false, active: false }; setCreated(current); setStep(6);
        localStorage.setItem("halo:agent-draft:v1", JSON.stringify({ draft, created: current }));
      }
      if (current.registry.toLowerCase() !== deployment.registry.toLowerCase()) throw new Error("This saved draft belongs to another deployment.");
      const [onchainHash, creator, active, tradingBalance] = await Promise.all([
        client.readContract({ address: current.agent, abi: vaultAbi as Abi, functionName: "manifestHash" }),
        client.readContract({ address: current.agent, abi: vaultAbi as Abi, functionName: "creator" }),
        client.readContract({ address: current.agent, abi: vaultAbi as Abi, functionName: "active" }),
        client.readContract({ address: current.token, abi: tokenAbi as Abi, functionName: "balanceOf", args: [current.agent] }) as Promise<bigint>,
      ]);
      if (onchainHash !== current.manifestHash) throw new Error("The saved draft does not match this chain’s agent. Do not fund it.");
      if (String(creator).toLowerCase() !== address.toLowerCase()) throw new Error("Connect the wallet that created this agent to complete setup.");
      if (active === true) { setCreated({ ...current, active: true }); setProgress("Activation is already confirmed on chain."); return; }
      // A confirmed purchase may outlive the tab that submitted it. Recover from the vault balance before requesting another payment.
      if (tradingBalance === 0n) {
        const input = parseEther(draft.initialBuy);
        const quote = await client.readContract({ address: current.curve, abi: curveAbi as Abi, functionName: "quoteBuy", args: [input] }) as readonly bigint[];
        setProgress("Approve the initial HALO allocation, then purchase trading inventory for the vault.");
        await submit(deployment.rootHalo, tokenAbi as Abi, "approve", [current.curve, input], "Approve initial HALO allocation");
        await submit(current.curve, curveAbi as Abi, "buy", [input, quote[0] * 99n / 100n, current.agent, (await client.getBlock()).timestamp + 120n], "Fund the agent’s trading inventory");
        current = { ...current, fundingConfirmed: true }; setCreated(current); localStorage.setItem("halo:agent-draft:v1", JSON.stringify({ draft, created: current }));
      }
      else { current = { ...current, fundingConfirmed: true }; setCreated(current); }
      const [required, funded] = await Promise.all([client.readContract({ address: current.agent, abi: vaultAbi as Abi, functionName: "reserveRequired", args: [30n] }) as Promise<bigint>,
        client.readContract({ address: deployment.operatingToken, abi: tokenAbi as Abi, functionName: "balanceOf", args: [current.agent] }) as Promise<bigint>]);
      if (funded < required) { setProgress("Transfer the remaining operating reserve."); await submit(deployment.operatingToken, tokenAbi as Abi, "transfer", [current.agent, required - funded], "Fund 30 days of verified work"); }
      setProgress("Funding confirmed. Review the commitment below, then activate when ready."); setStep(6);
    } catch (error) { setError((error as Error).message); }
    finally { setWorking(false); }
  }
  async function activate() {
    if (!created || !accepted) return;
    setWorking(true); setError("");
    try { await submit(created.agent, vaultAbi as Abi, "activate", [], `Activate ${draft.name}`); setCreated({ ...created, active: true }); setProgress("Activation confirmed on chain. Eligible independent operators can now execute verified work."); }
    catch (error) { setError((error as Error).message); } finally { setWorking(false); }
  }
  return <main id="main" className="wrap page-main"><div className="page-heading"><div><p className="eyebrow">MAKE SOMETHING AUTONOMOUS</p><h1>Give your agent a beginning<span className="lime">.</span></h1><p>A name, a strategy and an economy of its own.</p></div></div>
    <div className="wizard-layout"><ol className="wizard-steps" aria-label="Creation steps">{steps.map((label, index) => <li key={label} aria-current={step === index ? "step" : undefined}><span>{index + 1}</span>{label}</li>)}</ol>
      <section className="wizard-form"><h2>{steps[step]}</h2><p>{["Choose the identity people will discover.", "Define the proposal module. The spending core remains fixed.", "These limits become immutable when you activate.", "Every child inherits the agent’s committed fees.", "Separate trading capital from the cost of running the agent.", "Review exactly what the wallet will create.", "Funding and activation are separate confirmed states."][step]}</p>
        <FieldGroup>
          {step === 0 && <>{field("name", "Agent name", "Up to 64 UTF-8 bytes.")}{field("symbol", "Agent token symbol", "1–12 uppercase letters or numbers.")}<Field><FieldLabel htmlFor="description">Strategy and narrative interests</FieldLabel><Textarea id="description" rows={4} placeholder="What should this agent explore?" value={draft.description} onChange={event => change("description", event.target.value)} /><FieldDescription>This guides proposals. It does not override spending limits.</FieldDescription></Field></>}
          {step === 1 && <><ToggleGroup type="single" value={draft.modelMode} onValueChange={value => { if (value) change("modelMode", value); }} variant="outline" className="model-options"><ToggleGroupItem value="public-baseline">Rules baseline</ToggleGroupItem><ToggleGroupItem value="public-model">Public AI model</ToggleGroupItem><ToggleGroupItem value="custom-api">Custom API</ToggleGroupItem></ToggleGroup>
            <p className="small-note">Proposal models are advisory. The fixed decision core checks the spending envelope; it does not prove profitable predictions or exclusive AI authorship.</p>{draft.modelMode === "custom-api" && field("endpoint", "Proposal API endpoint", "Public HTTPS URL only. Never put API keys in this public manifest.")}
            {draft.modelMode === "public-model" && <div className="hash-block"><p>{proposalModel.name} · public weights and prompt</p><code>{proposalModel.releaseSha256}</code><p className="small-note">This release is fixed for the agent. Execution requires a funded operator serving it. The local model is a baseline, not an evaluated trading strategy.</p><a href={`/models/${proposalModel.releaseSha256}.json`} target="_blank" rel="noreferrer">Inspect the committed release</a></div>}
            <div className="hash-block"><p>Fixed decision core</p><code>HALO core v1 · EZKL / ONNX</code></div></>}
          {step === 2 && <>{field("launches", "Maximum child launches per day", "1–10. An agent can create multiple independent tokens over time.", true)}{field("position", "Maximum position (%)", "Up to 25% of accounted capital.", true)}{field("daily", "Daily trading debit budget (%)", "Up to 50%.", true)}{field("slippage", "Maximum trade slippage (%)", "Up to 5% below the recorded quote.", true)}{field("interval", "Work interval (minutes)", "15–1,440 minutes between paid cycles.", true)}</>}
          {step === 3 && <>{field("target", "Agent graduation target (HALO)", "Quote reserves required to graduate the agent token.", true)}{field("childTarget", `Child graduation target (${draft.symbol || "agent tokens"})`, "Each child is quoted in its parent agent token.", true)}{field("tradingFee", "Trading fee (%)", "0.25–2%, fixed for this agent and its children.", true)}{field("operations", "Operations share of fees (%)", "At least 50%.", true)}{field("halo", "HALO share of fees (%)", "10–30%. The creator receives the remainder.", true)}<p className="small-note">Creator share: {100 - Number(draft.operations) - Number(draft.halo)}%</p></>}
          {step === 4 && <>{field("initialBuy", "Initial trading allocation (HALO)", `Purchases ${draft.symbol || "agent tokens"} directly into the agent vault.`, true)}{field("reward", `Reward per completed work cycle (${deployment?.operatingSymbol || "WETH"})`, "Operators receive this fixed payment for valid work. It must cover their compute and gas costs.", true)}<div className="hash-block"><p>Required 30-day operating reserve</p><strong>{formatEther(budget)} {deployment?.operatingSymbol || "WETH"}</strong></div><p className="small-note">Below seven days of reserve, the committed policy blocks new discretionary exposure. Anyone can replenish the reserve.</p></>}
          {step === 5 && <><table className="details-table"><tbody><tr><th>Agent</th><td>{draft.name} / {draft.symbol}</td></tr><tr><th>Network</th><td>{deployment?.chainName || "Not connected"}</td></tr><tr><th>Model mode</th><td>{draft.modelMode}</td></tr><tr><th>Launch limit</th><td>{draft.launches} per UTC day</td></tr><tr><th>Position / daily limit</th><td>{draft.position}% / {draft.daily}%</td></tr><tr><th>Trading fee</th><td>{draft.tradingFee}%</td></tr><tr><th>Initial trading allocation</th><td>{draft.initialBuy} HALO</td></tr><tr><th>Operating reserve</th><td>{formatEther(budget)} {deployment?.operatingSymbol || "WETH"}</td></tr></tbody></table>
            <p className="warning-copy">This creates fixed-supply tokens and a vault. Each funding transaction requires your wallet approval. Activation is a separate final transaction.</p><Button disabled={busy} onClick={createAndFund}>{address ? "Create and fund agent" : "Connect wallet"}</Button></>}
          {step === 6 && created && <><div className="hash-block"><p>Created agent vault</p><code>{created.agent}</code></div><div className="hash-block"><p>Immutable manifest commitment</p><code>{created.manifestHash}</code></div>
            {created.active ? <><Alert><AlertDescription>Agent activated on chain. Its future transactions require the fixed decision proof and policy checks.</AlertDescription></Alert><Button asChild><Link href={`/agents/${created.agent}`}>Open {draft.name}’s profile</Link></Button><Button variant="outline" onClick={() => { setCreated(null); setDraft(initial); setStep(0); setAccepted(false); setProgress(""); setError(""); }}>Create another agent</Button></>
              : <><Button variant="outline" disabled={busy} onClick={createAndFund}>Check and complete funding</Button><Field orientation="horizontal"><Checkbox id="accept-activation" checked={accepted} onCheckedChange={value => setAccepted(value === true)} /><FieldLabel htmlFor="accept-activation">I understand that activation permanently removes my ability to withdraw the vault’s funds or change its policy.</FieldLabel></Field>
                <Button disabled={busy || !accepted || !created.fundingConfirmed} onClick={activate}>Activate {draft.name} permanently</Button></>}
            <p className="small-note">Creator {address ? shortAddress(address) : "wallet not connected"}. Continued execution requires funded operators and a functioning chain.</p></>}
        </FieldGroup>
        {progress && <p role="status" className="warning-copy">{progress}</p>}{error && <Alert variant="destructive" style={{ marginTop: 20 }}><AlertDescription>{error}</AlertDescription></Alert>}
        {step < 6 && <div className="wizard-controls"><Button variant="outline" disabled={step === 0 || busy || !!created} onClick={() => setStep(value => value - 1)}>Back</Button>{step < 5 && <Button onClick={next}>Continue</Button>}</div>}
      </section><aside className="wizard-preview"><img src="/art/hero-sunset.webp" alt="Engraved HALO agent portrait in violet and orange" /><div className="profile-glass"><h2>{draft.name || "Your next agent"}</h2><p>${draft.symbol || "AGENT"}</p></div></aside></div>
  </main>;
}
