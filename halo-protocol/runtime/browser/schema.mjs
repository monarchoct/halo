import { z } from 'zod';

export const socialControlSchema = z.object({
  role: z.enum(['link', 'button', 'textbox', 'article']), name: z.string().min(1).max(120).optional(),
}).strict();
const namedLink = socialControlSchema.extend({ role: z.literal('link'), name: z.string().min(1).max(120) });
export const socialBindingSchema = z.object({
  profileUrl: z.string().url(), identity: namedLink,
  openComposer: socialControlSchema.optional(), editor: socialControlSchema.optional(),
  submit: socialControlSchema.optional(), postContainer: socialControlSchema.optional(),
  postLink: socialControlSchema.optional(), postAuthor: namedLink.optional(),
}).strict();
export const browserJobSchema = z.object({
  id: z.string().regex(/^[a-f0-9]{64}$/), platform: z.enum(['x', 'fomo']),
  task: z.enum(['observe', 'publish']), chainId: z.number().int(),
  text: z.string().max(2000).optional(), publish: z.boolean().default(false),
  reconcileOnly: z.boolean().default(false),
  display: z.enum(['browser','desktop']).default('browser'),
  profileDirectory: z.string().min(1), outputDirectory: z.string().min(1), egressProxy: z.string().url(),
  captureIntervalMs: z.number().int().min(2000).max(30000).default(3000),
  maxRunSeconds: z.number().int().min(30).max(900).default(180),
  binding: socialBindingSchema.optional(),
}).strict();
export const browserReportSchema = z.object({
  version: z.literal('halo.browser-report.v1'), jobId: z.string().regex(/^[a-f0-9]{64}$/),
  sequence: z.number().int().min(0).max(1000000), timestamp: z.string().datetime(),
  siteOrigin: z.string().url(), activity: z.string().min(1).max(240),
  state: z.enum(['viewing', 'working', 'private', 'needs-account', 'complete', 'error']),
  width: z.number().int().min(0).max(1920), height: z.number().int().min(0).max(1200),
  imageFile: z.string().regex(/^\d{6}\.(jpg|png)$/).optional(),
  surface: z.enum(['browser','desktop']).optional(),
  // 'container-only' means HALO_BROWSER_UNSANDBOXED disabled Chromium's own kernel sandbox for
  // this session (see runtime/browser/worker.mjs); viewers can see the isolation was weakened.
  sandbox: z.enum(['kernel', 'container-only']).optional(),
}).strict().superRefine((value, ctx) => {
  if (['private', 'needs-account', 'error'].includes(value.state) && value.imageFile)
    ctx.addIssue({ code: 'custom', message: 'Private states cannot carry images' });
  if (value.imageFile ? value.width === 0 || value.height === 0 : value.width !== 0 || value.height !== 0)
    ctx.addIssue({ code: 'custom', message: 'Image dimensions must agree with image presence' });
  if (value.imageFile && value.imageFile.split('.')[0] !== String(value.sequence).padStart(6, '0'))
    ctx.addIssue({ code: 'custom', message: 'Image belongs to another report' });
});
