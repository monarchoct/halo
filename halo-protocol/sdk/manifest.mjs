import { z } from 'zod';
export const agentManifestSchema = z.object({
  version: z.literal('halo.agent.v1'), chainId: z.number().int().positive(),
  identity: z.object({ name: z.string().min(1).max(64), symbol: z.string().regex(/^[A-Z0-9]{1,12}$/), description: z.string().max(2000) }).strict(),
  models: z.object({ mode: z.enum(['public-baseline', 'custom-api', 'public-model']), core: z.literal('halo-core-v1'),
    releaseSha256: z.string().regex(/^[a-f0-9]{64}$/), proposalEndpoint: z.string().max(512),
    proposalReleaseSha256: z.string().regex(/^[a-f0-9]{64}$/).optional(),
    reproducibility: z.enum(['public-rules', 'external-provider', 'public-weights']) }).strict().superRefine((value, context) => {
      if (value.mode === 'public-model' ? !value.proposalReleaseSha256 || value.proposalEndpoint !== '' || value.reproducibility !== 'public-weights'
        : value.proposalReleaseSha256 !== undefined || value.reproducibility !== (value.mode === 'custom-api' ? 'external-provider' : 'public-rules'))
        context.addIssue({ code: 'custom', message: 'Model release, endpoint and reproducibility must match the selected mode' });
    }),
  policy: z.object({ maxPositionBps: z.number().int().min(1).max(2500), maxDailyDebitBps: z.number().int().min(1).max(5000),
    maxLaunchesPerDay: z.number().int().min(1).max(10), maxSlippageBps: z.number().int().min(1).max(500),
    intervalSeconds: z.number().int().min(900).max(86400), workReward: z.string().regex(/^[1-9][0-9]{0,18}$/),
    childGraduationTarget: z.string().regex(/^[1-9][0-9]{5,36}$/) }).strict(),
  fees: z.object({ tradingBps: z.number().int().min(25).max(200), operationsBps: z.number().int().min(5000).max(9000),
    haloBps: z.number().int().min(1000).max(3000), creator: z.string().regex(/^0x[0-9a-fA-F]{40}$/) }).strict(),
  graduationTarget: z.string().regex(/^[1-9][0-9]{5,36}$/),
}).strict().refine(value => value.fees.operationsBps + value.fees.haloBps <= 10000, 'Fee allocations exceed 100%');

export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}
