import type { Address } from "viem";
export type FeeAccounting = { treasury: Address; totalOperatingReceived: string; totalKeeperPaid: string; settlement: Address;
  balances: { address: Address; symbol: string; decimals: number; pending: string; claimable: string }[];
  completeSources: boolean; sourceCount: number; excludesUncollectedLiquidityFees: boolean };
export type Deployment = { nativeBuyRouter?: Address; historyApiUrl?: string; operationsApiUrl?: string; tradeRouter?: Address; chainId: number; chainName: string; environment: "local" | "testnet" | "mainnet"; rpcUrl: string; apiUrl: string; feeSettlement?: Address; rootReferenceMarket?: Address; artifactApiUrl?: string; transparencyApiUrl?: string; browserApiUrl?: string; explorerUrl?: string; registry: Address; curveFactory: Address; decisionVerifier: Address; operatingToken: Address; rootHalo: Address; deploymentBlock: string; operatingSymbol: string; haloSymbol: string; coreReleaseSha256: string };
export type ProtocolStatus = { available: boolean; chainId: number; chainName: string; environment: string; blockNumber: string; blockTimestamp: string; agentCount: string; deployment: Deployment };
export type Market = { address: Address; name: string; symbol: string; decimals: number; totalSupply: string; curve: Address; quote: Address; quoteSymbol: string; quoteDecimals: number; sold: string; target: string; graduated: boolean; liquidityVault: Address; tradingFeeBps: number; feeSplitter: Address; totalFees: string };
export type Policy = { maxPositionBps: number; maxDailyDebitBps: number; maxLaunchesPerDay: number; maxSlippageBps: number; intervalSeconds: number; workReward: string; childGraduationTarget: string };
export type Agent = { tradeRouter?: Address; feeAccounting?: FeeAccounting | null; address: Address; creator: Address; agentToken: Address; active: boolean; nonce: string; name: string; symbol: string; market: Market; policy: Policy; manifestHash: string; policyHash: string; coreId: string; fees: { tradingBps: number; operationsBps: number; haloBps: number; operations: Address; creator: Address }; operatingBalance: string; tradingBalance: string; capitalBasis: string; realizedPnl: string; totalWorkPaid: string; runwaySeconds: string; reserveRequired: string; childCount: string; children: (Market & { balance: string; costBasis: string })[] };
export type ActionRecord = { nonce: string; kind: number; actionCommitment: string; child: Address; amount: string; result: string; beneficiary: Address; workReward: string; evidenceHash: string; transactionHash: string; blockNumber: string };
export const shortAddress = (value: string) => `${value.slice(0, 6)}…${value.slice(-4)}`;
export const days = (seconds: string) => (Number(seconds) / 86400).toFixed(1);


