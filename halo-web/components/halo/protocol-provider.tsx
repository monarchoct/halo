"use client";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { createPublicClient, createWalletClient, custom, defineChain, http, type Abi, type Address, type EIP1193Provider, type Hash } from "viem";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { shortAddress, type Deployment, type ProtocolStatus } from "@/lib/halo-types";

type Wallet = { info: { uuid: string; name: string }; provider: EIP1193Provider };
type Transaction = { label: string; state: "approval" | "pending" | "confirmed" | "failed"; hash?: Hash; message?: string };
type Context = {
  deployment: Deployment | null; status: ProtocolStatus | null; statusError: string; address: Address | null; chainId: number | null;
  openWallet: () => void; switchNetwork: () => Promise<void>; disconnect: () => void;
  transaction: Transaction | null; clearTransaction: () => void; refreshStatus: () => void;
  submit: (address: Address, abi: Abi, functionName: string, args: readonly unknown[], label: string, value?: bigint) => Promise<Hash>;
};
const ProtocolContext = createContext<Context | null>(null);
export function useProtocol() { const value = useContext(ProtocolContext); if (!value) throw new Error("Protocol provider missing"); return value; }

export function ProtocolProvider({ children }: { children: React.ReactNode }) {
  const [deployment, setDeployment] = useState<Deployment | null>(null);
  const [status, setStatus] = useState<ProtocolStatus | null>(null);
  const [statusError, setStatusError] = useState("");
  const [statusVersion, setStatusVersion] = useState(0);
  const [wallets, setWallets] = useState<Wallet[]>([]);
  const [provider, setProvider] = useState<EIP1193Provider | null>(null);
  const [address, setAddress] = useState<Address | null>(null);
  const [chainId, setChainId] = useState<number | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [walletError, setWalletError] = useState("");
  const [transaction, setTransaction] = useState<Transaction | null>(null);
  useEffect(() => {
    const abort = new AbortController();
    let deploymentPath = "/deployment.json";
    if (process.env.NODE_ENV === "development" && ["localhost", "127.0.0.1"].includes(window.location.hostname)) {
      const preview = new URLSearchParams(window.location.search).get("preview");
      if (preview === "settlement" || preview === "trading" || preview === "legacy") sessionStorage.setItem("halo:local-preview", preview);
      if (sessionStorage.getItem("halo:local-preview") === "settlement") deploymentPath = "/deployment-settlement.json";
      if (sessionStorage.getItem("halo:local-preview") === "trading") deploymentPath = "/deployment-trading.json";
    }
    fetch(deploymentPath, { signal: abort.signal, cache: "no-store" }).then(async response => {
      if (!response.ok) throw new Error("This site has no connected deployment yet.");
      const value = await response.json() as Deployment;
      if (!value.registry || !value.apiUrl || !value.rpcUrl) throw new Error("This site has no connected deployment yet.");
      setDeployment(value);
    }).catch(error => { if (error.name !== "AbortError") setStatusError(error.message); });
    return () => abort.abort();
  }, []);
  useEffect(() => {
    if (!deployment) return;
    const abort = new AbortController();
    async function update() {
      try {
        const response = await fetch(`${deployment!.apiUrl}/v1/status`, { signal: abort.signal, cache: "no-store" });
        if (!response.ok) throw new Error("Public data is unavailable. Wallet transactions can still use the chain RPC.");
        const value: ProtocolStatus = await response.json();
        if (value.chainId !== deployment!.chainId || value.deployment.registry.toLowerCase() !== deployment!.registry.toLowerCase()) throw new Error("The API and deployment configuration do not match.");
        setStatus(value); setStatusError("");
      } catch (error) { if (error instanceof Error && error.name !== "AbortError") { setStatus(null); setStatusError(error.message); } }
    }
    void update(); const interval = setInterval(update, 15000);
    return () => { clearInterval(interval); abort.abort(); };
  }, [deployment, statusVersion]);
  useEffect(() => {
    if (process.env.NODE_ENV === "development" && ["localhost", "127.0.0.1"].includes(window.location.hostname)
      && new URLSearchParams(window.location.search).get("testWallet") === "1") {
      import("./local-test-wallet").then(({ localTestWallet }) => setWallets(current => current.some(wallet => wallet.info.uuid === "halo-local-test")
        ? current : [...current, { info: { uuid: "halo-local-test", name: "Local test wallet · disposable assets" }, provider: localTestWallet() }]));
    }
    const announce = (event: Event) => {
      const detail = (event as CustomEvent<Wallet>).detail;
      if (!detail?.provider?.request || !detail.info?.uuid) return;
      setWallets(current => current.some(wallet => wallet.provider === detail.provider) ? current : [...current, detail]);
    };
    window.addEventListener("eip6963:announceProvider", announce);
    window.dispatchEvent(new Event("eip6963:requestProvider"));
    const injected = (window as Window & { ethereum?: EIP1193Provider }).ethereum;
    // Deferred so discovery joins the same tick as EIP-6963 announcements instead of forcing a synchronous re-render.
    const discover = injected ? setTimeout(() => setWallets(current => current.some(wallet => wallet.provider === injected) ? current : [...current, { info: { uuid: "injected", name: "Browser wallet" }, provider: injected }]), 0) : undefined;
    return () => { window.removeEventListener("eip6963:announceProvider", announce); if (discover) clearTimeout(discover); };
  }, []);
  useEffect(() => {
    if (!provider) return;
    const accountsChanged = (accounts: string[]) => setAddress(accounts[0] as Address || null);
    const chainChanged = (value: string) => setChainId(Number(value));
    provider.on?.("accountsChanged", accountsChanged); provider.on?.("chainChanged", chainChanged);
    return () => { provider.removeListener?.("accountsChanged", accountsChanged); provider.removeListener?.("chainChanged", chainChanged); };
  }, [provider]);
  async function connect(wallet: Wallet) {
    setBusy(true); setWalletError("");
    try {
      const accounts = await wallet.provider.request({ method: "eth_requestAccounts" });
      if (!accounts[0]) throw new Error("The wallet did not share an account.");
      setProvider(wallet.provider); setAddress(accounts[0]);
      setChainId(Number(await wallet.provider.request({ method: "eth_chainId" }))); setOpen(false);
    } catch (error) { setWalletError(error instanceof Error ? error.message : "Wallet connection was declined."); }
    finally { setBusy(false); }
  }
  const network = useMemo(() => deployment ? defineChain({ id: deployment.chainId, name: deployment.chainName,
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [deployment.rpcUrl] } } }) : null, [deployment]);
  async function switchNetwork() {
    if (!provider || !deployment) { setOpen(true); return; }
    try { await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: `0x${deployment.chainId.toString(16)}` }] }); }
    catch (error) {
      if ((error as { code?: number }).code !== 4902) throw error;
      await provider.request({ method: "wallet_addEthereumChain", params: [{ chainId: `0x${deployment.chainId.toString(16)}`,
        chainName: deployment.chainName, nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, rpcUrls: [deployment.rpcUrl],
        ...(deployment.explorerUrl ? { blockExplorerUrls: [deployment.explorerUrl] } : {}) }] });
    }
    setChainId(Number(await provider.request({ method: "eth_chainId" })));
  }
  async function submit(target: Address, abi: Abi, functionName: string, args: readonly unknown[], label: string, value = 0n) {
    if (!address || !provider) { setOpen(true); throw new Error("Connect a wallet to continue."); }
    if (!deployment || !network) throw new Error("A deployment configuration is required.");
    let hash: Hash | undefined;
    try {
      if (Number(await provider.request({ method: "eth_chainId" })) !== deployment.chainId) throw new Error(`Switch your wallet to ${deployment.chainName}.`);
      setTransaction({ state: "approval", label });
      const publicClient = createPublicClient({ chain: network, transport: http(deployment.rpcUrl) });
      if (await publicClient.getChainId() !== deployment.chainId) throw new Error("The RPC returned the wrong network.");
      const walletClient = createWalletClient({ account: address, chain: network, transport: custom(provider) });
      const { request } = await publicClient.simulateContract({ address: target, abi, functionName, args, account: address, value });
      const estimatedGas = await publicClient.estimateContractGas(request);
      const gas = (estimatedGas * 125n + 99n) / 100n + 100_000n;
      hash = await walletClient.writeContract({ ...request, gas }); setTransaction({ state: "pending", label, hash });
      const receipt = await publicClient.waitForTransactionReceipt({ hash, confirmations: deployment.environment === "local" ? 1 : 2 });
      if (receipt.status !== "success") throw new Error("The transaction reverted. Nothing was confirmed.");
      setTransaction({ state: "confirmed", label, hash }); setStatusVersion(value => value + 1); return hash;
    } catch (error) {
      const message = (error as { code?: number }).code === 4001 ? "You declined the wallet request. Nothing was submitted."
        : error instanceof Error ? error.message.split("\n")[0] : "Transaction failed. Check your wallet and try again.";
      setTransaction({ state: "failed", label, hash, message }); throw new Error(message);
    }
  }
  return <ProtocolContext.Provider value={{ deployment, status, statusError, address, chainId, openWallet: () => setOpen(true), switchNetwork,
    disconnect: () => { setAddress(null); setProvider(null); setChainId(null); }, transaction, clearTransaction: () => setTransaction(null), submit,
    refreshStatus: () => setStatusVersion(value => value + 1) }}>
    {children}
    <Dialog open={open} onOpenChange={setOpen}><DialogContent><DialogHeader><DialogTitle>Connect your wallet</DialogTitle>
      <DialogDescription>Use an Ethereum-compatible wallet to create and fund agents on {deployment?.chainName || "Robinhood Chain"}.</DialogDescription></DialogHeader>
      {wallets.length ? <div className="wallet-options">{wallets.map(wallet => <Button variant="outline" key={wallet.info.uuid} disabled={busy} onClick={() => connect(wallet)}>{wallet.info.name}</Button>)}</div>
        : <p>No wallet was detected. Open HALO in your wallet’s browser or install an Ethereum-compatible browser wallet.</p>}
      {walletError && <Alert variant="destructive"><AlertDescription>{walletError}</AlertDescription></Alert>}
      <p className="small-note">Connecting shares your public address. Every creation or funding transaction still requires your wallet’s signature.</p>
    </DialogContent></Dialog>
    {transaction && <aside className="transaction-notice" role="status" aria-live="polite"><div><strong>{transaction.label}</strong>
      <p>{({ approval: "Review the request in your wallet", pending: "Submitted · waiting for confirmation", confirmed: "Confirmed on chain", failed: transaction.message })[transaction.state]}</p>
      {transaction.hash && (deployment?.explorerUrl ? <a href={`${deployment.explorerUrl}/tx/${transaction.hash}`} target="_blank" rel="noreferrer">{shortAddress(transaction.hash)}</a> : <code>{shortAddress(transaction.hash)}</code>)}
      </div>{!["approval", "pending"].includes(transaction.state) && <Button variant="ghost" size="sm" onClick={() => setTransaction(null)}>Dismiss</Button>}</aside>}
  </ProtocolContext.Provider>;
}

export function useApi<T>(endpoint: string | null) {
  const { deployment } = useProtocol();
  const [version, setVersion] = useState(0);
  const key = deployment && endpoint ? `${deployment.apiUrl}${endpoint}#${version}` : "";
  const [result, setResult] = useState<{ key: string; data: T | null; error: string }>({ key: "", data: null, error: "" });
  const refresh = useCallback(() => setVersion(value => value + 1), []);
  useEffect(() => {
    if (!key) return;
    const abort = new AbortController();
    fetch(key.slice(0, key.lastIndexOf("#")), { signal: abort.signal, cache: "no-store" }).then(async response => {
      const value = await response.json() as T & { error?: string }; if (!response.ok) throw new Error(value.error || "Data could not be loaded."); setResult({ key, data: value, error: "" });
    }).catch(error => { if (error.name !== "AbortError") setResult({ key, data: null, error: error.message }); });
    return () => abort.abort();
  }, [key]);
  const current = result.key === key;
  // Keep the previous payload visible while a refresh for the same endpoint is in flight.
  const previous = result.key.slice(0, result.key.lastIndexOf("#")) === key.slice(0, key.lastIndexOf("#"));
  return { data: current || previous ? result.data : null, error: current ? result.error : "", loading: !!key && !current, refresh };
}
