import { createHash } from 'node:crypto';
import { z } from 'zod';
import { canonicalJson } from '../../sdk/manifest.mjs';
import { createJobStore, LeaseLostError } from './store.mjs';
import { inboxSchema, inboxRequestSchema } from '../../runtime/identity/agentmail.mjs';

const digest=value=>createHash('sha256').update(canonicalJson(value)).digest('hex');
const address=value=>z.string().regex(/^0x[a-fA-F0-9]{40}$/).parse(value).toLowerCase();

export async function createInboxStore({database,deployment,providerId,configuration}) {
  providerId=z.uuid().parse(providerId);
  const {deploymentId}=await createJobStore({database,deployment});
  const configHash=digest(configuration),pool=database.pool;
  await pool.query('INSERT INTO halo_mail_providers(id,configuration_hash) VALUES($1,$2) ON CONFLICT DO NOTHING',[providerId,configHash]);
  if((await pool.query('SELECT configuration_hash FROM halo_mail_providers WHERE id=$1',[providerId])).rows[0].configuration_hash!==configHash)
    throw new Error('Mail provider configuration differs from its saved identity');
  const leaseWhere="id=$1 AND lease_token=$2 AND lease_until>clock_timestamp()";
  const check=async(client,token)=>{
    if(!(await client.query(`SELECT id FROM halo_mail_providers WHERE ${leaseWhere} FOR UPDATE`,[providerId,token])).rowCount) throw new LeaseLostError();
  };
  const transaction=async(token,action)=>{
    const client=await pool.connect();
    try{await client.query('BEGIN'); await check(client,token); const value=await action(client); await client.query('COMMIT'); return value;}
    catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
  };
  return {
    async claim(){return (await pool.query("UPDATE halo_mail_providers SET lease_token=gen_random_uuid(),lease_until=clock_timestamp()+interval '60 seconds' WHERE id=$1 AND (lease_until IS NULL OR lease_until<=clock_timestamp()) RETURNING lease_token",[providerId])).rows[0]?.lease_token;},
    async renew(token){if(!(await pool.query(`UPDATE halo_mail_providers SET lease_until=clock_timestamp()+interval '60 seconds' WHERE ${leaseWhere}`,[providerId,token])).rowCount)throw new LeaseLostError();},
    async release(token){await pool.query('UPDATE halo_mail_providers SET lease_token=NULL,lease_until=NULL WHERE id=$1 AND lease_token=$2',[providerId,token]);},
    async find(agent){return (await pool.query('SELECT * FROM halo_agent_inboxes WHERE deployment_id=$1 AND agent=$2',[deploymentId,address(agent)])).rows[0];},
    async pending(){return (await pool.query("SELECT client_id FROM halo_agent_inboxes WHERE provider_id=$1 AND state='pending'",[providerId])).rows.map(row=>row.client_id);},
    async prepare(token,{agent,request,adoptInboxId}) {
      agent=address(agent);request=inboxRequestSchema.parse(request);
      const payload={request,...(adoptInboxId?{adoptInboxId:z.string().min(1).max(320).parse(adoptInboxId)}:{})},hash=digest(payload);
      return transaction(token,async client=>{
        await client.query('INSERT INTO halo_agent_inboxes(deployment_id,agent,provider_id,client_id,request,request_hash) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING',
          [deploymentId,agent,providerId,request.client_id,payload,hash]);
        const row=(await client.query('SELECT * FROM halo_agent_inboxes WHERE deployment_id=$1 AND agent=$2',[deploymentId,agent])).rows[0];
        if(!row || row.provider_id!==providerId || row.request_hash!==hash)throw new Error('Agent email identity cannot change across retries');
        return row;
      });
    },
    async complete(token,agent,value) {
      agent=address(agent);const inbox=inboxSchema.parse(value);
      return transaction(token,async client=>{
        const row=(await client.query('SELECT * FROM halo_agent_inboxes WHERE deployment_id=$1 AND agent=$2 AND provider_id=$3 FOR UPDATE',[deploymentId,agent,providerId])).rows[0];
        if(!row)throw new Error('Inbox identity was not prepared');
        const {request,adoptInboxId}=row.request;
        if(adoptInboxId ? inbox.inbox_id!==adoptInboxId : inbox.client_id!==request.client_id || inbox.email!==`${request.username}@${request.domain}`
          || Object.entries(request.metadata).some(([key,value])=>inbox.metadata?.[key]!==value))throw new Error('Inbox response differs from the prepared identity');
        if(row.state==='ready' && (row.inbox_id!==inbox.inbox_id || row.email!==inbox.email))throw new Error('Ready inbox cannot be reassigned');
        return (await client.query("UPDATE halo_agent_inboxes SET state='ready',inbox_id=$4,email=$5,verified_at=clock_timestamp() WHERE deployment_id=$1 AND agent=$2 AND provider_id=$3 RETURNING *",[deploymentId,agent,providerId,inbox.inbox_id,inbox.email])).rows[0];
      });
    },
  };
}
