import {createHash} from 'node:crypto';
import {z} from 'zod';
import {canonicalJson} from '../../sdk/manifest.mjs';
import {assertSupportedDeployment} from '../../sdk/networks.mjs';

export const views=['halo_public_deployments','halo_public_jobs','halo_public_social','halo_public_mail'];
const privateTables=['halo_deployments','halo_jobs','halo_job_attempts','halo_outbox','halo_mail_providers','halo_agent_inboxes'];
const address=z.string().regex(/^0x[0-9a-fA-F]{40}$/).transform(value=>value.toLowerCase());
const uint=z.string().regex(/^(0|[1-9][0-9]{0,77})$/);
const hash=z.string().regex(/^0x[0-9a-f]{64}$/);
const timestamp=value=>value ? new Date(value).toISOString() : null;
const known=(value,allowed)=>allowed.includes(value)?value:null;

/** Refuse an operator/admin connection, including inherited or column-level private access. */
export async function assertOperationsReader(database) {
  const role=(await database.pool.query('SELECT rolsuper,rolcreaterole,rolcreatedb,rolreplication,rolbypassrls FROM pg_roles WHERE rolname=current_user')).rows[0];
  if(!role||Object.values(role).some(Boolean))throw new Error('Operations API requires a dedicated restricted reader');
  for(const table of [...views,...privateTables]) {
    const row=(await database.pool.query(`SELECT has_any_column_privilege(current_user,$1,'SELECT') AS readable,
      has_table_privilege(current_user,$1,'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') AS writable,
      has_any_column_privilege(current_user,$1,'INSERT,UPDATE,REFERENCES') AS column_writable`,[`public.${table}`])).rows[0];
    if(row.writable||row.column_writable||row.readable!==views.includes(table))throw new Error('Operations reader privileges exceed the public projection');
  }
}

function postLink(platform,post,profile) {
  try{
    const p=new URL(post),author=new URL(profile),origin=platform==='x'?'https://x.com':'https://fomo.family';
    if([p,author].some(url=>url.origin!==origin||url.username||url.password||url.search||url.hash||url.pathname==='/'||url.href.length>2048))return null;
    if(p.href===author.href)return null;
    if(platform==='x'&&(!/^\/[A-Za-z0-9_]{1,15}$/.test(author.pathname)||!p.pathname.startsWith(`${author.pathname}/status/`)||!/^\/[A-Za-z0-9_]{1,15}\/status\/\d+$/.test(p.pathname)))return null;
    return p.href;
  }catch{return null;}
}

export async function createOperationsReader({database,deployment}) {
  assertSupportedDeployment(deployment);await assertOperationsReader(database);
  const registry=address.parse(deployment.registry),deploymentId=`${deployment.chainId}:${registry}`;
  const identity={chainId:deployment.chainId,registry,decisionVerifier:address.parse(deployment.decisionVerifier),rootHalo:address.parse(deployment.rootHalo),
    operatingToken:address.parse(deployment.operatingToken),coreReleaseSha256:deployment.coreReleaseSha256};
  const saved=(await database.pool.query('SELECT identity_hash FROM public.halo_public_deployments WHERE id=$1',[deploymentId])).rows[0];
  if(saved?.identity_hash!==createHash('sha256').update(canonicalJson(identity)).digest('hex'))throw new Error('Operations database belongs to a different deployment');
  return {async agent(value,{limit=20}={}) {
    const agent=address.parse(value);z.number().int().min(1).max(20).parse(limit);
    const connection=await database.pool.connect();
    let rows;
    try {
      await connection.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
      const observedAt=(await connection.query('SELECT transaction_timestamp() AS observed_at')).rows[0].observed_at;
      const jobs=(await connection.query('SELECT * FROM public.halo_public_jobs WHERE deployment_id=$1 AND agent=$2 ORDER BY nonce DESC LIMIT $3',[deploymentId,agent,limit+1])).rows;
      const social=(await connection.query('SELECT * FROM public.halo_public_social WHERE deployment_id=$1 AND agent=$2 ORDER BY created_at DESC,id DESC LIMIT $3',[deploymentId,agent,limit+1])).rows;
      const mail=(await connection.query('SELECT state,verified_at FROM public.halo_public_mail WHERE deployment_id=$1 AND agent=$2',[deploymentId,agent])).rows[0];
      rows={observedAt,jobs,social,mail};await connection.query('COMMIT');
    }catch(error){await connection.query('ROLLBACK');throw error;}finally{connection.release();}
    const now=new Date(rows.observedAt).getTime();
    const queueState=row=>row.state==='leased'&&new Date(row.lease_until).getTime()<=now?'lease-expired':row.state;
    return {version:'halo.public-operations.v1',chainId:deployment.chainId,registry,agent,observedAt:timestamp(rows.observedAt),
      source:'operator-database',confirmation:'Operator reports; verify completed actions against chain receipts.',
      mail:{state:rows.mail?.state==='ready'?'provisioned':rows.mail?'pending':'not-configured',lastCheckedAt:timestamp(rows.mail?.verified_at),
        stale:!!rows.mail?.verified_at&&now-new Date(rows.mail.verified_at).getTime()>86400000},
      jobs:rows.jobs.slice(0,limit).map(row=>({id:z.uuid().parse(row.id),nonce:uint.parse(row.nonce),state:queueState(row),attempts:row.attempts,
        availableAt:timestamp(row.available_at),leaseUntil:timestamp(row.lease_until),updatedAt:timestamp(row.updated_at),
        transactionHash:hash.safeParse(row.transaction_hash).success?row.transaction_hash:null,
        kind:known(row.action_kind,['launch','hold','buy','sell']),outcome:row.outcome})),
      publications:rows.social.slice(0,limit).map(row=>({id:z.uuid().parse(row.id),nonce:uint.parse(row.nonce),platform:z.enum(['x','fomo']).parse(row.platform),
        state:queueState(row),attempts:row.attempts,availableAt:timestamp(row.available_at),deliveredAt:timestamp(row.delivered_at),
        transactionHash:hash.parse(row.transaction_hash),outcome:row.outcome,
        thesis:typeof row.thesis==='string'?row.thesis.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f\u202a-\u202e\u2066-\u2069]/g,'').slice(0,2000):null,
        postUrl:row.state==='delivered'&&row.outcome==='posted'?postLink(row.platform,row.post_url,row.profile_url):null})),
      hasMoreJobs:rows.jobs.length>limit,hasMorePublications:rows.social.length>limit};
  }};
}
