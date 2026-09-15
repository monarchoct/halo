import assert from 'node:assert/strict';
import fs from 'node:fs';
import {randomBytes,randomUUID} from 'node:crypto';
import {openDatabase,migrate} from '../services/persistence/database.mjs';
import {createInboxStore} from '../services/persistence/inboxes.mjs';
import {LeaseLostError} from '../services/persistence/store.mjs';
import {createAgentMail,MailProviderError} from '../runtime/identity/agentmail.mjs';
import {inboxRequest,createInboxProvisioner} from '../runtime/identity/provision.mjs';
import {SafeFetchHttpError} from '../sdk/safe-fetch.mjs';

const url=new URL(process.env.HALO_TEST_DATABASE_URL),name=`halo_mail_test_${randomBytes(6).toString('hex')}`;
assert.match(name,/^halo_mail_test_[a-f0-9]{12}$/);
const adminUrl=new URL(url);adminUrl.pathname='/postgres';const admin=openDatabase({url:adminUrl.href,local:true});
try{await admin.pool.query(`CREATE DATABASE "${name}"`);}finally{await admin.close();}
url.pathname=`/${name}`;let database=openDatabase({url:url.href,local:true});
const deployment={environment:'local',chainId:31337,rpcUrl:'http://127.0.0.1:8545',registry:`0x${'1'.repeat(40)}`,
  decisionVerifier:`0x${'2'.repeat(40)}`,rootHalo:`0x${'3'.repeat(40)}`,operatingToken:`0x${'4'.repeat(40)}`,coreReleaseSha256:'5'.repeat(64)};
const agent=`0x${'a'.repeat(40)}`,other=`0x${'b'.repeat(40)}`,third=`0x${'c'.repeat(40)}`,providerId=randomUUID();
const configuration={organizationId:providerId,domain:'agentmail.to',maxInboxes:3,agents:[{agent},{agent:other},{agent:third}]};
const providerConfiguration={domain:'agentmail.to',maxInboxes:3};
const passed=[],remote=new Map(),requests=[];let loseCreateAck=false,active=true;
const client={getChainId:async()=>31337,readContract:async({functionName})=>functionName==='active'?active:true};
const transport=async(url,options)=>{
  assert.equal(new URL(url).origin,'https://api.agentmail.to');assert.equal(options.headers.Authorization,'Bearer fixture-secret-never-publish');
  const route=new URL(url).pathname;requests.push({route,method:options.method});
  let value;
  if(route==='/v0/auth/me')value={organization_id:providerId,scope_type:'organization',scope_id:providerId};
  else if(route==='/v0/inboxes'&&options.method==='GET')value={inboxes:[...remote.values()]};
  else if(route==='/v0/inboxes'&&options.method==='POST'){
    const body=JSON.parse(options.body);value=[...remote.values()].find(item=>item.client_id===body.client_id);
    if(!value){value={...body,inbox_id:`${body.username}@${body.domain}`,email:`${body.username}@${body.domain}`,pod_id:providerId};remote.set(value.inbox_id,value);}
    if(loseCreateAck){loseCreateAck=false;throw new Error('fixture transport secret and private body must not be exposed');}
  }else{const id=decodeURIComponent(route.split('/').at(-1));value=remote.get(id);if(!value)throw new SafeFetchHttpError(404);}
  return{bytes:Buffer.from(JSON.stringify(value))};
};
const provider=createAgentMail({apiKey:'fixture-secret-never-publish',organizationId:providerId,transport});
const makeStore=()=>createInboxStore({database,deployment,providerId,configuration:providerConfiguration});
const makeProvisioner=store=>createInboxProvisioner({client,deployment,artifacts:{AgentRegistry:{abi:[]},AgentVault:{abi:[]}},store,provider,configuration});
try{
  await migrate(database);let store=await makeStore(),provisioner=makeProvisioner(store);
  const workers=await Promise.all(Array.from({length:12},()=>makeStore()));
  const claims=await Promise.all(workers.map(item=>item.claim()));assert.equal(claims.filter(Boolean).length,1);
  const token=claims.find(Boolean);await store.release(token);
  passed.push('Twelve pooled workers elect one provider lease without a long network transaction');

  loseCreateAck=true;
  await assert.rejects(provisioner.ensure(agent),error=>error instanceof MailProviderError&&!error.message.includes('secret')&&error.code==='transport-unavailable');
  assert.equal(remote.size,1);assert.equal((await store.find(agent)).state,'pending');
  await database.close();database=openDatabase({url:url.href,local:true});store=await makeStore();provisioner=makeProvisioner(store);
  const recovered=await provisioner.ensure(agent);assert.equal(recovered.status,'mail-ready');assert.equal(remote.size,1);
  assert.equal(requests.filter(x=>x.method==='POST').length,1);
  passed.push('A lost create acknowledgement and a new database pool recover the same inbox without another POST');

  const old=await store.claim();await store.prepare(old,{agent:other,request:inboxRequest(deployment,other)});
  await database.pool.query("UPDATE halo_mail_providers SET lease_until=clock_timestamp()-interval '1 second' WHERE id=$1",[providerId]);
  const replacement=await store.claim();await assert.rejects(store.complete(old,agent,[...remote.values()][0]),LeaseLostError);
  await store.release(old);await store.renew(replacement);await store.release(replacement);
  passed.push('Expired workers cannot complete identity records or release a replacement worker lease');

  const changed=await store.claim();
  await assert.rejects(store.prepare(changed,{agent,request:{...inboxRequest(deployment,agent),username:'changed'}}),/cannot change/);
  await store.release(changed);
  await assert.rejects(createInboxStore({database,deployment,providerId,configuration:{...providerConfiguration,maxInboxes:4}}),/differs/);
  passed.push('Prepared addresses and the saved provider capacity cannot change silently');

  remote.set('unrelated@agentmail.to',{inbox_id:'unrelated@agentmail.to',email:'unrelated@agentmail.to',pod_id:providerId});
  assert.equal((await provisioner.ensure(third)).status,'mail-capacity-exhausted');
  assert.equal(await store.find(third),undefined);
  passed.push('Provider inventory and unresolved reservations both count toward the configured inbox capacity');
  const second=await provisioner.ensure(other);assert.equal(second.status,'mail-ready');assert.equal(remote.size,3);
  assert.notEqual(second.email,recovered.email);
  passed.push('Two agents get distinct addresses while recovering one agent preserves its address');

  const before=requests.length;active=false;await assert.rejects(provisioner.ensure(third),/not activated/);active=true;
  await assert.rejects(provisioner.ensure(`0x${'d'.repeat(40)}`),/not assigned/);assert.equal(requests.length,before);
  passed.push('Unactivated and unassigned agents cannot spend provider capacity');

  remote.delete(recovered.inboxId);const posts=requests.filter(x=>x.method==='POST').length;
  await assert.rejects(provisioner.ensure(agent),error=>error.code==='not-found');
  assert.equal(requests.filter(x=>x.method==='POST').length,posts);assert.equal((await store.find(agent)).email,recovered.email);
  passed.push('A deleted external inbox is reported missing and is never silently replaced');

  const bad=createAgentMail({apiKey:'fixture-secret-never-publish',organizationId:providerId,
    transport:async()=>({bytes:Buffer.from(JSON.stringify({scope_type:'organization',organization_id:randomUUID(),scope_id:providerId}))})});
  await assert.rejects(bad.verifyAccess(),error=>error.code==='organization-mismatch');
  const forbidden=createAgentMail({apiKey:'fixture-secret-never-publish',organizationId:providerId,transport:async()=>{throw new SafeFetchHttpError(403);}});
  await assert.rejects(forbidden.verifyAccess(),error=>error.httpStatus===403&&error.code==='access-restricted');
  passed.push('Wrong organization and restricted credentials are rejected without leaking the credential or provider response');

  const identityRequests=inboxRequest(deployment,agent);
  assert.notEqual(identityRequests.client_id,inboxRequest({...deployment,chainId:46630,environment:'testnet'},agent).client_id);
  assert.notEqual(identityRequests.client_id,inboxRequest({...deployment,registry:`0x${'f'.repeat(40)}`},agent).client_id);
  const repeated=createAgentMail({apiKey:'fixture-secret-never-publish',organizationId:providerId,
    transport:async()=>({bytes:Buffer.from(JSON.stringify({inboxes:[],next_page_token:'repeat'}))})});
  await assert.rejects(repeated.listInboxes(),error=>error.code==='inconsistent-pagination');
  passed.push('Identity includes chain and registry; cyclic provider pagination fails closed');

  const adoptionStore=await makeStore(),adoptToken=await adoptionStore.claim();
  await adoptionStore.prepare(adoptToken,{agent:third,request:inboxRequest(deployment,third),adoptInboxId:second.inboxId});
  await assert.rejects(adoptionStore.complete(adoptToken,third,remote.get(second.inboxId)),error=>error.code==='23505');
  await adoptionStore.release(adoptToken);
  passed.push('Database uniqueness prevents adopting the same external inbox for a second agent');
  const report={checkedAt:new Date().toISOString(),databaseName:name,passed,
    scope:'Real PostgreSQL connections and migrations; injected AgentMail HTTP and chain responses. No actual inboxes, emails, accounts, social posts or financial transactions.'};
  fs.mkdirSync(new URL('../test-results/',import.meta.url),{recursive:true});
  fs.writeFileSync(new URL('../test-results/agent-inboxes.json',import.meta.url),JSON.stringify(report,null,2));
  console.log(`PASS ${passed.length} durable agent-inbox scenarios`);
}finally{await database.close();}
