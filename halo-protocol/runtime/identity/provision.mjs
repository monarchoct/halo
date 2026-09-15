import {createHash} from 'node:crypto';
import {z} from 'zod';
import {canonicalJson} from '../../sdk/manifest.mjs';
import {assertSupportedDeployment} from '../../sdk/networks.mjs';
import {MailProviderError,inboxRequestSchema} from './agentmail.mjs';

export const mailConfigurationSchema=z.object({organizationId:z.uuid(),domain:z.literal('agentmail.to').default('agentmail.to'),
  maxInboxes:z.number().int().min(1).max(1000).default(3),
  agents:z.array(z.object({agent:z.string().regex(/^0x[a-fA-F0-9]{40}$/).transform(v=>v.toLowerCase()),
    adoptInboxId:z.string().min(1).max(320).optional()}).strict()).min(1).max(1000),
}).strict().superRefine((value,ctx)=>{
  if(new Set(value.agents.map(x=>x.agent)).size!==value.agents.length)ctx.addIssue({code:'custom',message:'Duplicate mailbox agent'});
});
export function inboxRequest(deployment,agent) {
  assertSupportedDeployment(deployment);agent=z.string().regex(/^0x[a-f0-9]{40}$/).parse(agent);
  const identity={chainId:deployment.chainId,registry:deployment.registry.toLowerCase(),agent};
  const hash=createHash('sha256').update(canonicalJson(identity)).digest('hex');
  return inboxRequestSchema.parse({username:`halo-${hash.slice(0,32)}`,domain:'agentmail.to',display_name:`HALO agent ${agent.slice(0,10)}`,
    client_id:`halo-inbox-v1-${hash}`,metadata:{halo_chain:String(identity.chainId),halo_registry:identity.registry,halo_agent:agent}});
}

/** Called outside the chain scheduler: email outages cannot prevent vault execution. */
export function createInboxProvisioner({client,deployment,artifacts,store,provider,configuration}) {
  assertSupportedDeployment(deployment);configuration=mailConfigurationSchema.parse(configuration);
  const agents=new Map(configuration.agents.map(item=>[item.agent,item]));
  async function eligible(agent){
    const [chain,registered]=await Promise.all([client.getChainId(),client.readContract({address:deployment.registry,abi:artifacts.AgentRegistry.abi,functionName:'isAgent',args:[agent]})]);
    if(chain!==deployment.chainId || !registered)throw new Error('Mailbox agent is not in the configured deployment');
    if(!await client.readContract({address:agent,abi:artifacts.AgentVault.abi,functionName:'active'}))throw new Error('Mailbox agent is not activated');
  }
  return { async ensure(agent,{signal}={}) {
    agent=z.string().regex(/^0x[a-fA-F0-9]{40}$/).parse(agent).toLowerCase();
    const binding=agents.get(agent);if(!binding)throw new Error('Operator has not assigned mailbox capacity to this agent');
    await eligible(agent);signal?.throwIfAborted();
    const token=await store.claim();if(!token)return {status:'provider-busy',agent};
    const abort=new AbortController(),combined=signal?AbortSignal.any([signal,abort.signal]):abort.signal;
    let renewal=Promise.resolve();
    const timer=setInterval(()=>{renewal=renewal.then(()=>store.renew(token)).catch(()=>abort.abort());},20000);
    const guard=async()=>{combined.throwIfAborted();await store.renew(token);};
    try {
      await provider.verifyAccess({signal:combined});
      const request=inboxRequest(deployment,agent),saved=await store.find(agent);
      let inbox;
      if(saved?.state==='ready'){
        // A missing external inbox is an identity failure, never a request to replace it silently.
        await store.prepare(token,{agent,request,...binding});
        inbox=await provider.getInbox(saved.inbox_id,{signal:combined});
      }else if(binding.adoptInboxId){
        await store.prepare(token,{agent,request,...binding});
        inbox=await provider.getInbox(binding.adoptInboxId,{signal:combined});
      }else{
        const inventory=await provider.listInboxes({signal:combined});
        const matches=inventory.filter(value=>value.client_id===request.client_id);
        if(matches.length>1)throw new MailProviderError('duplicate-identity');
        if(matches.length) inbox=matches[0];
        else {
          const pending=await store.pending(),known=new Set(inventory.map(value=>value.client_id));
          const otherReservations=pending.filter(id=>id!==request.client_id&&!known.has(id));
          if(inventory.length+otherReservations.length>=configuration.maxInboxes) return {status:'mail-capacity-exhausted',agent};
        }
        await guard();await store.prepare(token,{agent,request});
        if(!inbox){await eligible(agent);await guard();inbox=await provider.createInbox(request,{signal:combined});}
      }
      await guard();const ready=await store.complete(token,agent,inbox);
      return {status:'mail-ready',agent,inboxId:ready.inbox_id,email:ready.email,clientId:ready.client_id};
    }finally{clearInterval(timer);await renewal;await store.release(token);}
  }};
}
