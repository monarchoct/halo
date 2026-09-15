import { z } from "zod";

const date = z.string().datetime();
const hash = z.string().regex(/^0x[0-9a-f]{64}$/);
const address = z.string().regex(/^0x[0-9a-f]{40}$/);
const nonce = z.string().regex(/^(0|[1-9][0-9]{0,77})$/);
const job = z.object({ id: z.string().uuid(), nonce, state: z.enum(["queued", "leased", "lease-expired", "completed", "cancelled"]),
  attempts: z.number().int().nonnegative(), availableAt: date, leaseUntil: date.nullable(), updatedAt: date,
  transactionHash: hash.nullable(), kind: z.enum(["launch", "hold", "buy", "sell"]).nullable(), outcome: z.string().max(80).nullable() });
const publication = z.object({ id: z.string().uuid(), nonce, platform: z.enum(["x", "fomo"]),
  state: z.enum(["queued", "leased", "lease-expired", "delivered", "cancelled"]), attempts: z.number().int().nonnegative(),
  availableAt: date, deliveredAt: date.nullable(), transactionHash: hash, outcome: z.string().max(80).nullable(),
  thesis: z.string().max(2000).nullable(), postUrl: z.string().url().max(2048).nullable() });
export const operationsSchema = z.object({ version: z.literal("halo.public-operations.v1"), chainId: z.number().int(), registry: address, agent: address,
  observedAt: date, source: z.literal("operator-database"), confirmation: z.string().max(150),
  mail: z.object({ state: z.enum(["provisioned", "pending", "not-configured"]), lastCheckedAt: date.nullable(), stale: z.boolean() }),
  jobs: z.array(job).max(20), publications: z.array(publication).max(20), hasMoreJobs: z.boolean(), hasMorePublications: z.boolean() });
export type Operations = z.infer<typeof operationsSchema>;

export function publicPostUrl(item: Operations["publications"][number]) {
  if (item.state !== "delivered" || item.outcome !== "posted" || !item.postUrl) return null;
  const url = new URL(item.postUrl), origin = item.platform === "x" ? "https://x.com" : "https://fomo.family";
  return url.origin === origin && !url.username && !url.password && !url.search && !url.hash && url.pathname !== "/" ? url.href : null;
}
