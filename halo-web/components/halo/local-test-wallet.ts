import type { EIP1193Provider } from "viem";

/** Development-only wallet harness. Production bundles exclude the only import of this module. */
export function localTestWallet(): EIP1193Provider {
  if (process.env.NODE_ENV !== "development" || !["localhost", "127.0.0.1"].includes(window.location.hostname)) throw new Error("Local test wallet is unavailable");
  let id = 0;
  const preview = sessionStorage.getItem("halo:local-preview");
  const rpcUrl = preview === "trading" ? "http://127.0.0.1:8547" : preview === "settlement" ? "http://127.0.0.1:8546" : "http://127.0.0.1:8545";
  async function rpc(method: string, params: unknown[] = []): Promise<unknown> {
    const response = await fetch(rpcUrl, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params }) });
    const result = await response.json() as { result?: unknown; error?: { message: string; code: number } };
    if (result.error) throw Object.assign(new Error(result.error.message), { code: result.error.code });
    return result.result;
  }
  return {
    request: async ({ method, params }: { method: string; params?: unknown[] }) => {
      if (await rpc("eth_chainId") !== "0x7a69") throw new Error("Test wallet refuses every chain except local Anvil 31337");
      const accounts = await rpc("eth_accounts") as string[];
      const account = accounts[2];
      if (method === "eth_requestAccounts" || method === "eth_accounts") return [account];
      if (method === "wallet_switchEthereumChain") { if ((params?.[0] as { chainId: string }).chainId !== "0x7a69") throw new Error("Test wallet cannot switch networks"); return null; }
      if (method === "eth_sendTransaction") {
        if ((params?.[0] as { from: string }).from.toLowerCase() !== account.toLowerCase()) throw new Error("Wrong disposable test account");
        if (!window.confirm("LOCAL TEST TRANSACTION\nOnly disposable Anvil assets are used.\nApprove this request?")) throw Object.assign(new Error("You declined the test wallet request. Nothing was submitted."), { code: 4001 });
      } else if (!["eth_chainId", "eth_estimateGas", "eth_getTransactionReceipt", "eth_getTransactionByHash", "eth_blockNumber"].includes(method)) throw new Error(`Unsupported test wallet method: ${method}`);
      return rpc(method, params);
    },
    on: () => {}, removeListener: () => {},
  } as unknown as EIP1193Provider;
}
