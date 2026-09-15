import { z } from 'zod';
import { safeFetch, SafeFetchHttpError } from '../../sdk/safe-fetch.mjs';

const identifier = z.string().min(1).max(320).regex(/^[A-Za-z0-9@._+~-]+$/);
export const inboxSchema = z.object({ inbox_id: identifier, email: z.email().max(254).optional(),
  pod_id: identifier, client_id: z.string().min(1).max(256).optional(),
  display_name: z.string().max(200).optional(), metadata: z.record(z.string(), z.union([z.string(),z.number(),z.boolean()])).optional(),
}).transform(value => ({ ...value, email: z.email().max(254).parse(value.email ?? value.inbox_id).toLowerCase() }));
export const inboxRequestSchema = z.object({ username: z.string().regex(/^[a-z0-9-]{1,64}$/),
  domain: z.string().regex(/^[a-z0-9]+(?:[.-][a-z0-9]+)*\.[a-z]{2,}$/).max(253),
  display_name: z.string().min(1).max(100), client_id: z.string().regex(/^halo-inbox-v1-[a-f0-9]{64}$/),
  metadata: z.object({ halo_chain: z.string().regex(/^\d+$/), halo_registry: z.string().regex(/^0x[a-f0-9]{40}$/),
    halo_agent: z.string().regex(/^0x[a-f0-9]{40}$/) }).strict(),
}).strict();
export class MailProviderError extends Error {
  constructor(code, httpStatus) { super(`Mail provider: ${code}`); this.name='MailProviderError'; this.code=code; this.httpStatus=httpStatus; }
}

/** Provider keys never leave this adapter. No send, delete, signup or key-rotation method is exposed. */
export function createAgentMail({ apiKey, organizationId, transport = safeFetch }) {
  if (typeof apiKey !== 'string' || apiKey.length < 16 || apiKey.length > 4096 || /[\s\x00-\x1f]/.test(apiKey)) throw new MailProviderError('credential-invalid');
  organizationId=z.uuid().parse(organizationId);
  async function request(route, { body, signal } = {}) {
    signal?.throwIfAborted();
    try {
      const response=await transport(`https://api.agentmail.to/v0${route}`, { method:body ? 'POST':'GET',
        headers:{Authorization:`Bearer ${apiKey}`, ...(body ? {'Content-Type':'application/json'}:{})},
        ...(body ? {body:JSON.stringify(body)}:{}), maxBytes:524288, timeoutMs:10000 });
      signal?.throwIfAborted();
      return JSON.parse(response.bytes);
    } catch(error) {
      if (signal?.aborted) throw new MailProviderError('interrupted');
      const status=error instanceof SafeFetchHttpError ? error.statusCode : undefined;
      throw new MailProviderError(status===401 || status===403 ? 'access-restricted' : status===429 ? 'rate-limited'
        : status===404 ? 'not-found' : status ? 'request-rejected' : 'transport-unavailable',status);
    }
  }
  return {
    async verifyAccess({signal}={}) {
      const raw=await request('/auth/me',{signal});
      const value=z.object({scope_type:z.enum(['organization','pod','inbox']),organization_id:z.string(),scope_id:z.string()}).parse(raw);
      if(value.organization_id!==organizationId || value.scope_type!=='organization' || value.scope_id!==organizationId) throw new MailProviderError('organization-mismatch');
      return {organizationId,scope:'organization'};
    },
    async listInboxes({signal,maxPages=20}={}) {
      z.number().int().min(1).max(100).parse(maxPages);
      const result=[],seen=new Set(); let page;
      for(let i=0;i<maxPages;i++) {
        const query=new URLSearchParams({limit:'100',...(page ? {page_token:page}:{})});
        const value=z.object({inboxes:z.array(inboxSchema).max(100),next_page_token:z.string().min(1).max(2048).nullish()}).parse(await request(`/inboxes?${query}`,{signal}));
        result.push(...value.inboxes);
        if(!value.next_page_token) {
          if(new Set(result.map(inbox=>inbox.inbox_id)).size!==result.length) throw new MailProviderError('inconsistent-pagination');
          return result;
        }
        if(seen.has(value.next_page_token)) throw new MailProviderError('inconsistent-pagination');
        page=value.next_page_token; seen.add(page);
      }
      throw new MailProviderError('pagination-limit');
    },
    async getInbox(id,{signal}={}) {
      id=identifier.parse(id);
      const value=inboxSchema.parse(await request(`/inboxes/${encodeURIComponent(id)}`,{signal}));
      if(value.inbox_id!==id) throw new MailProviderError('inbox-mismatch');
      return value;
    },
    async createInbox(input,{signal}={}) {
      const body=inboxRequestSchema.parse(input),value=inboxSchema.parse(await request('/inboxes',{body,signal}));
      if(value.client_id!==body.client_id || value.email!==`${body.username}@${body.domain}`
        || Object.entries(body.metadata).some(([key,expected])=>value.metadata?.[key]!==expected)) throw new MailProviderError('inbox-mismatch');
      return value;
    },
  };
}
