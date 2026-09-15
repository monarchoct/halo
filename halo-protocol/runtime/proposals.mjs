import { z } from 'zod';
import { safeFetch } from '../sdk/safe-fetch.mjs';
import { canonicalJson } from '../sdk/manifest.mjs';

export const proposalSchema = z.object({
  version: z.literal('halo.proposal.v1'), module: z.string().min(1).max(80), kind: z.enum(['launch', 'hold', 'buy', 'sell']),
  name: z.string().max(64), symbol: z.string().max(12), sourceIds: z.array(z.string().regex(/^[a-f0-9]{64}$/)).max(3),
  rationale: z.string().max(2000),
  child: z.string().regex(/^0x[0-9a-fA-F]{40}$/).optional(),
  amount: z.string().regex(/^[1-9][0-9]{0,37}$/).optional(),
}).strict().superRefine((value, context) => {
  if (value.kind === 'launch' && (!value.name.trim() || Buffer.byteLength(value.name) > 64 || !/^[A-Z0-9]{1,12}$/.test(value.symbol) || value.sourceIds.length === 0)) context.addIssue({ code: 'custom', message: 'Launch identity and source references are required' });
  if (value.kind === 'hold' && (value.name || value.symbol || value.sourceIds.length)) context.addIssue({ code: 'custom', message: 'Hold must not contain a launch payload' });
  if (['buy', 'sell'].includes(value.kind)) {
    if (!value.child || !value.amount || value.name || value.symbol || !value.sourceIds.length)
      context.addIssue({ code: 'custom', message: 'Trade requires an owned child, integer amount and public sources, without launch metadata' });
  } else if (value.child !== undefined || value.amount !== undefined) {
    context.addIssue({ code: 'custom', message: 'Only a trade may contain an asset or amount' });
  }
});

/** Provider credentials belong to a separately configured service; manifests and this request are public. */
export async function customProposal(endpoint, input, { transport = safeFetch } = {}) {
  const url = new URL(endpoint);
  if (url.protocol !== 'https:' || url.username || url.password) throw new Error('Custom model endpoint must be public HTTPS without credentials');
  const body = Buffer.from(canonicalJson({ version: 'halo.proposal-request.v1', ...input }));
  if (body.length > 262144) throw new Error('Model input exceeds 256 KiB');
  const response = await transport(url.href, { method: 'POST', body, maxBytes: 16384, timeoutMs: 45000,
    headers: { 'Content-Type': 'application/json', 'Content-Length': String(body.length) } });
  return proposalSchema.parse(JSON.parse(response.bytes));
}
