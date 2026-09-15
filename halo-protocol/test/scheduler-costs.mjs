import fs from 'node:fs';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {createPublicClient,http} from 'viem';
import {createScheduler} from '../runtime/scheduler.mjs';
import {openDatabase,migrate} from '../services/persistence/database.mjs';
import {createJobStore} from '../services/persistence/store.mjs';
const deployment=JSON.parse(fs.readFileSync(new URL('../test-results/trading-deployment.json',import.meta.url)));
assert.equal(deployment.environment,'local');assert.equal(deployment.rpcUrl,'http://127.0.0.1:8547');
const evidence=JSON.parse(fs.readFileSync(new URL('../test-results/action-costs-live.json',import.meta.url)));
const artifacts=Object.fromEntries(['AgentRegistry','AgentVault'].map(n=>[n,JSON.parse(fs.readFileSync(new URL(`../artifacts/${n}.json`,import.meta.url)))]));
const client=createPublicClient({transport:http(deployment.rpcUrl)});
const base=new URL(process.env.HALO_TEST_DATABASE_URL);assert.equal(base.hostname,'127.0.0.1');
const name=`halo_cost_test_${randomBytes(6).toString('hex')}`;
base.pathname='/postgres';const admin=openDatabase({url:base.href,local:true});
try{await admin.pool.query(`CREATE DATABASE "${name}"`);}finally{await admin.close();}
base.pathname=`/${name}`;const database=openDatabase({url:base.href,local:true});
const passed=[];
try{
  await migrate(database);const store=await createJobStore({database,deployment});
  const expected=evidence.results.find(r=>r.kind===2);
  await store.enqueue({agent:evidence.agent,nonce:expected.nonce,payload:{version:'halo.agent-cycle.v1',nonce:expected.nonce}});
  const recovery=createScheduler({client,deployment,artifacts,store,workerId:'cost-recovery',confirmations:1,
    operator:{runCycle:()=>{throw new Error('Recovery must not execute');}}});
  const recovered=await recovery.workOnce();assert.equal(recovered.status,'confirmed');assert.equal(recovered.gasCostWei,expected.gasCostWei);
  assert.equal(recovered.observationGasCostWei,expected.observationGasCostWei);assert.equal(recovered.computeBudgetWei,null);
  passed.push('PostgreSQL recovery persists the full actual trade cost without executing the operator');
  const freshExpected=evidence.results.find(r=>r.kind===3);
  await store.enqueue({agent:evidence.agent,nonce:freshExpected.nonce,payload:{version:'halo.agent-cycle.v1',nonce:freshExpected.nonce}});
  // Controlled scheduler trigger only: present this already-mined nonce as pending once.
  // The result's receipts, calldata, observations and canonical blocks are real RPC reads.
  const controlled={...client,readContract:args=>args.functionName==='nonce'?Promise.resolve(BigInt(freshExpected.nonce)):client.readContract(args)};
  const realEvents=await client.getContractEvents({address:evidence.agent,abi:artifacts.AgentVault.abi,eventName:'ActionExecuted',
    args:{nonce:BigInt(freshExpected.nonce)},fromBlock:0n,toBlock:'latest',strict:true});
  let calls=0;
  const fresh=createScheduler({client:controlled,deployment,artifacts,store,workerId:'cost-fresh-result',confirmations:1,
    operator:{runCycle:async()=>{calls++;return {status:'confirmed',agent:evidence.agent,nonce:freshExpected.nonce,
      transactionHash:freshExpected.transactionHash,operator:realEvents[0].args.beneficiary,
      observationTransactionHash:freshExpected.observationTransactionHash,gasCostWei:'1',observationGasCostWei:'999999999999999999',computeBudgetWei:'123'};}}});
  const checked=await fresh.workOnce();assert.equal(calls,1);assert.equal(checked.status,'confirmed');
  assert.equal(checked.gasCostWei,freshExpected.gasCostWei);assert.equal(checked.observationGasCostWei,freshExpected.observationGasCostWei);
  passed.push('Fresh result reconciliation replaces claimed costs with both canonical receipts instead of dropping observation gas');
  const rows=await store.recentJobs(evidence.agent);assert.equal(rows.length,2);assert(rows.every(r=>r.state==='completed'));
  const saved=(await database.pool.query("SELECT payload FROM halo_outbox WHERE topic='operator-receipt'")).rows;
  assert.equal(saved.length,2);assert(saved.every(r=>r.payload.costAccounting==='canonical-action-transactions'&&BigInt(r.payload.observationGasCostWei)>0n));
  passed.push('Completed jobs and the transactional public receipt outbox retain verified observation costs');
  fs.writeFileSync(new URL('../test-results/scheduler-costs.json',import.meta.url),JSON.stringify({checkedAt:new Date().toISOString(),database:name,passed,
    newTransactions:0,scope:'Real Linux PostgreSQL and prior local trades; fresh-cycle trigger is injected, no new operator execution',recovered,checked},null,2));
  console.log(`PASS ${passed.length} persistent scheduler accounting scenarios`);
}finally{await database.close();}
