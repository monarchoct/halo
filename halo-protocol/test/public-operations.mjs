import fs from 'node:fs';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {openDatabase,migrate} from '../services/persistence/database.mjs';
import {createJobStore} from '../services/persistence/store.mjs';
import {installOperationsProjection} from '../services/operations/install.mjs';
import {createOperationsReader,assertOperationsReader,views} from '../services/operations/reader.mjs';
import {createOperationsApi} from '../services/operations/server.mjs';

const input=new URL(process.env.HALO_TEST_DATABASE_URL),databaseName=`halo_ops_test_${randomBytes(6).toString('hex')}`;
const adminUrl=new URL(input);adminUrl.pathname='/postgres';const admin=openDatabase({url:adminUrl.href,local:true});
try{await admin.pool.query(`CREATE DATABASE "${databaseName}"`);}finally{await admin.close();}
input.pathname=`/${databaseName}`;const database=openDatabase({url:input.href,local:true});
const deployment={environment:'local',chainId:31337,rpcUrl:'http://127.0.0.1:8545',registry:`0x${'1'.repeat(40)}`,
  decisionVerifier:`0x${'2'.repeat(40)}`,rootHalo:`0x${'3'.repeat(40)}`,operatingToken:`0x${'4'.repeat(40)}`,coreReleaseSha256:'5'.repeat(64)};
const agent=`0x${'a'.repeat(40)}`,other=`0x${'b'.repeat(40)}`,tx=`0x${'c'.repeat(64)}`;
const role=`halo_public_${randomBytes(6).toString('hex')}`,password=randomBytes(32).toString('hex'),passed=[];
let readDb,app;
try{
  await migrate(database);const store=await createJobStore({database,deployment});
  await installOperationsProjection({database,role,password});
  const readUrl=new URL(input);readUrl.username=role;readUrl.password=password;readDb=openDatabase({url:readUrl.href,local:true});
  await assertOperationsReader(readDb);await assert.rejects(assertOperationsReader(database),/dedicated restricted/);
  for(const table of ['halo_jobs','halo_agent_inboxes','halo_mail_providers','halo_outbox'])await assert.rejects(readDb.pool.query(`SELECT * FROM public.${table}`),error=>error.code==='42501');
  await readDb.pool.query('SET default_transaction_read_only=off');
  for(const view of views)await assert.rejects(readDb.pool.query(`DELETE FROM public.${view}`),error=>error.code==='42501');
  await readDb.pool.query('SET default_transaction_read_only=on');
  passed.push('Dedicated role can select projections but cannot read private tables or mutate views, even after disabling its read-only default; admin startup refused');

  await database.pool.query(`GRANT SELECT(email) ON public.halo_agent_inboxes TO "${role}"`);
  await assert.rejects(assertOperationsReader(readDb),/exceed/);
  await database.pool.query(`REVOKE SELECT(email) ON public.halo_agent_inboxes FROM "${role}"`);
  passed.push('Startup detects accidental column-level access to private mailbox addresses');
  const reader=await createOperationsReader({database:readDb,deployment});
  await assert.rejects(createOperationsReader({database:readDb,deployment:{...deployment,coreReleaseSha256:'6'.repeat(64)}}),/different deployment/);
  for(let nonce=0;nonce<23;nonce++)await store.enqueue({agent,nonce:String(nonce),payload:{privateCredential:'SECRET_DO_NOT_EXPOSE'}});
  await store.enqueue({agent:other,nonce:'0',payload:{}});
  const active=await store.claim('PRIVATE_WORKER_NAME',60,{agent});
  await database.pool.query("UPDATE halo_jobs SET nonce=99,lease_until=clock_timestamp()-interval '1 second',last_error=$2 WHERE id=$1",[active.id,'RAW_PRIVATE_ERROR']);
  const provider=randomUUID();await database.pool.query('INSERT INTO halo_mail_providers(id,configuration_hash) VALUES($1,$2)',[provider,'f'.repeat(64)]);
  await database.pool.query(`INSERT INTO halo_agent_inboxes(deployment_id,agent,provider_id,client_id,request,request_hash,state,inbox_id,email,verified_at)
    VALUES($1,$2,$3,$4,'{"private":"SECRET_DO_NOT_EXPOSE"}',$5,'ready','PRIVATE_INBOX','PRIVATE_EMAIL',clock_timestamp()-interval '2 days')`,[store.deploymentId,agent,provider,`halo-inbox-v1-${'a'.repeat(64)}`,'b'.repeat(64)]);
  let page=await reader.agent(agent);assert.equal(page.jobs.length,20);assert(page.hasMoreJobs);assert.equal(page.jobs[0].nonce,'99');assert.equal(page.jobs[0].state,'lease-expired');assert.equal(page.mail.state,'provisioned');assert.equal(page.mail.stale,true);
  for(const secret of ['SECRET_DO_NOT_EXPOSE','PRIVATE_WORKER_NAME','RAW_PRIVATE_ERROR','PRIVATE_EMAIL','PRIVATE_INBOX',provider])assert(!JSON.stringify(page).includes(secret));
  assert.equal((await reader.agent(other)).jobs.length,1);assert.equal((await reader.agent(other)).mail.state,'not-configured');
  await assert.rejects(reader.agent(agent,{limit:21}));
  passed.push('Snapshot limits history to 20, scopes agents, identifies expired leases and stale mailbox checks without leaking payloads, workers, provider IDs or errors');

  const id=randomUUID(),base={agent,nonce:'1',platform:'x',transactionHash:tx};
  await database.pool.query(`INSERT INTO halo_outbox(id,deployment_id,topic,dedupe_key,stream_key,ordinal,payload,payload_hash,prepared_payload,prepared_hash,last_result,last_result_hash)
    VALUES($1,$2,'social-post','public-test','public-test',0,$3,$4,$5,$4,$6,$4)`,[id,store.deploymentId,JSON.stringify(base),'1'.repeat(64),JSON.stringify({...base,receipt:tx,text:'Unverified public thesis\nVault: '+agent}),JSON.stringify({status:'needs-account',secret:'SECRET_DO_NOT_EXPOSE'})]);
  page=await reader.agent(agent);assert.equal(page.publications[0].outcome,'needs-account');assert(page.publications[0].thesis.startsWith('Unverified'));assert.equal(page.publications[0].postUrl,null);assert(!JSON.stringify(page).includes('SECRET_DO_NOT_EXPOSE'));
  await database.pool.query("UPDATE halo_outbox SET prepared_payload=prepared_payload||'{\"agent\":\"wrong-agent\"}' WHERE id=$1",[id]);
  assert.equal((await reader.agent(agent)).publications[0].thesis,null);
  await database.pool.query("UPDATE halo_outbox SET state='delivered',last_result=$2 WHERE id=$1",[id,JSON.stringify({status:'posted',postUrl:'https://x.com/evil/status/123',profileUrl:'https://x.com/halo_agent'})]);
  assert.equal((await reader.agent(agent)).publications[0].postUrl,null);
  await database.pool.query('UPDATE halo_outbox SET last_result=$2 WHERE id=$1',[id,JSON.stringify({status:'posted',postUrl:'https://x.com/halo_agent/status/123',profileUrl:'https://x.com/halo_agent'})]);
  assert.equal((await reader.agent(agent)).publications[0].postUrl,'https://x.com/halo_agent/status/123');
  passed.push('Prepared thesis must match its intent; needs-account is not delivery; foreign-author post links are suppressed and valid reported links retained');

  let chainId=31337,registered=true,chainFailure=false;
  const client={getChainId:async()=>{if(chainFailure)throw new Error('SECRET_RPC_URL');return chainId;},readContract:async()=>registered};
  app=await createOperationsApi({database:readDb,client,deployment,artifacts:{AgentRegistry:{abi:[]}}});
  const url=`/v1/agents/${agent}/operations`;
  let reply=await app.inject({url,headers:{origin:'http://localhost:5173'}});assert.equal(reply.statusCode,200);assert.equal(reply.headers['cache-control'],'no-store');assert.equal(reply.headers['access-control-allow-origin'],'http://localhost:5173');
  assert.equal(reply.json().source,'operator-database');assert.equal(reply.json().agent,agent);
  assert.equal((await app.inject({url:`${url}?limit=21`})).statusCode,400);
  assert.equal((await app.inject({url:`${url}?private=true`})).statusCode,400);
  assert.equal((await app.inject({url:'/v1/agents/not-an-agent/operations'})).statusCode,400);
  assert.equal((await app.inject({url,method:'POST'})).statusCode,404);
  registered=false;assert.equal((await app.inject({url})).statusCode,404);registered=true;
  chainId=1;assert.equal((await app.inject({url})).statusCode,503);chainId=31337;
  chainFailure=true;reply=await app.inject({url});assert.equal(reply.statusCode,503);assert(!reply.body.includes('SECRET_RPC_URL'));chainFailure=false;
  passed.push('Real Fastify requests enforce chain/registry identity, bounded query parameters, read-only methods, CORS and redacted service failures');
  await readDb.close();reply=await app.inject({url});assert.equal(reply.statusCode,503);assert(!reply.body.includes(password));
  passed.push('Database loss returns unavailable instead of an empty success, without exposing connection credentials');
  const report={checkedAt:new Date().toISOString(),passed,scope:'Real Linux PostgreSQL 17 with dedicated database role and Fastify request injection; chain replies and data are explicit fixtures. No social posts, email or chain transactions.'};
  fs.writeFileSync(new URL('./../test-results/public-operations.json',import.meta.url),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}finally{await app?.close();await readDb?.close().catch(()=>{});await database.close();}
