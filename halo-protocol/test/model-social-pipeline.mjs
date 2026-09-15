import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createPublicClient, decodeEventLog, erc20Abi, http, keccak256, toHex, verifyMessage } from 'viem';
import { openDatabase, verifySchema } from '../services/persistence/database.mjs';
import { verifySocialReceipt } from '../runtime/social.mjs';
import { browserFrameMessage, imageDigest } from '../runtime/browser/frames.mjs';
import { canonicalJson } from '../sdk/manifest.mjs';
import { parseRawCid, identify } from '../sdk/artifacts.mjs';
import { safeFetch } from '../sdk/safe-fetch.mjs';

// Read-only acceptance of a fresh live model/scheduler run and its actual browsers.
assert.equal(process.platform,'linux');
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const agent=(process.argv[2]??'').toLowerCase(); assert.match(agent,/^0x[0-9a-f]{40}$/);
const deployment=JSON.parse(fs.readFileSync(path.join(root,'test-results/browser-trading-deployment.json')));
assert.equal(deployment.chainId,31337); assert.equal(deployment.environment,'local');
const client=createPublicClient({transport:http(deployment.rpcUrl)});
const artifacts=Object.fromEntries(['AgentRegistry','AgentVault'].map(name=>[name,JSON.parse(fs.readFileSync(path.join(root,`artifacts/${name}.json`)))]));
const privateConfig=JSON.parse(fs.readFileSync('/home/halo/lab/social-runtime/acceptance-database.json'));
const database=openDatabase({url:privateConfig.url,local:true});
const get=async uri=>{
  const cid=parseRawCid(uri);
  const response=await safeFetch(`http://127.0.0.1:8793/ipfs/${cid}`,{localOrigins:['http://127.0.0.1:8793'],maxBytes:262144,timeoutMs:10000});
  assert.equal((await identify(response.bytes)).cid,cid); return response.bytes;
};
const passed=[];
try {
  await verifySchema(database);
  const job=(await database.pool.query('SELECT id,state,result,created_at,updated_at FROM halo_jobs WHERE deployment_id=$1 AND agent=$2 AND nonce=0',
    [`31337:${deployment.registry.toLowerCase()}`,agent])).rows[0];
  assert(job); assert.equal(job.state,'completed'); assert.equal(job.result.kind,'launch'); assert.notEqual(job.result.recovered,true);
  const attempts=(await database.pool.query('SELECT outcome,transaction_hash FROM halo_job_attempts WHERE job_id=$1',[job.id])).rows;
  assert(attempts.some(a=>a.outcome==='completed'&&a.transaction_hash===job.result.transactionHash));
  const receipt=await client.getTransactionReceipt({hash:job.result.transactionHash});
  assert.equal(receipt.status,'success'); assert.equal((await client.getBlock({blockNumber:receipt.blockNumber})).hash,receipt.blockHash);
  const transfers=receipt.logs.filter(l=>l.address.toLowerCase()===deployment.operatingToken.toLowerCase()).flatMap(log=>{try{return[decodeEventLog({abi:erc20Abi,...log})];}catch{return[];}});
  assert(transfers.some(t=>t.eventName==='Transfer'&&t.args.from.toLowerCase()===agent&&t.args.to.toLowerCase()===job.result.operator.toLowerCase()&&t.args.value===BigInt(job.result.workReward)));
  passed.push('The scheduled fresh launch is canonical, its attempt records the submitted hash, and the receipt contains the actual operating-token payment');
  const evidence=JSON.parse(await get(job.result.evidenceURI));
  assert.equal(evidence.agent.toLowerCase(),agent); assert.equal(evidence.nonce,'0'); assert.equal(evidence.modelMode,'public-model');
  const transcript=JSON.parse(await get(evidence.inference.transcriptURI));
  const release=await get(evidence.inference.releaseURI);
  assert.equal(createHash('sha256').update(release).digest('hex'),evidence.inference.releaseSha256);
  assert.equal(transcript.requestSha256,createHash('sha256').update(canonicalJson(transcript.request)).digest('hex'));
  assert.equal(transcript.response.model,'halo-qwen35-4b-v1');
  assert.deepEqual(JSON.parse(transcript.response.choices[0].message.content),evidence.proposal);
  assert.equal(evidence.proposal.kind,'launch'); assert(evidence.proposal.sourceIds.length>0);
  passed.push('Retrieved content hashes bind the actual public-model transcript, committed release and fresh token proposal to this launch');
  const rows=(await database.pool.query("SELECT id,state,attempts,payload,prepared_payload,last_result FROM halo_outbox WHERE deployment_id=$1 AND topic='social-post' AND payload->>'agent'=$2 AND payload->>'nonce'='0' ORDER BY payload->>'platform'",
    [`31337:${deployment.registry.toLowerCase()}`,agent])).rows;
  assert.equal(rows.length,2); assert.deepEqual(rows.map(r=>r.payload.platform),['fomo','x']);
  const allFrames=(await(await fetch(`http://127.0.0.1:8795/v1/agents/${agent}/browser`)).json()).frames;
  const executions=[];
  for(const row of rows){
    await verifySocialReceipt({client,deployment,artifacts,intent:row.payload,confirmations:1});
    assert.equal(row.payload.transactionHash,receipt.transactionHash); assert.equal(row.state,'queued');
    assert(row.attempts>0); assert(row.prepared_payload?.text.includes(agent));
    assert(['needs-account','site-unavailable'].includes(row.last_result?.status),'Wait for both actual browser workers to finish');
    assert.equal(row.last_result.externalMutationPossible,false); assert.equal(row.last_result.reportsDelivered,true);
    const id=row.last_result.executionId; assert.match(id,/^[0-9a-f-]{36}$/);
    const dir=path.join('/home/halo/lab/social-runtime/executions',id);
    const outcome=JSON.parse(fs.readFileSync(path.join(dir,'outcome.json')));
    assert.equal(outcome.containersCleaned,true); assert.equal(outcome.reportsDelivered,true);
    const journal=JSON.parse(fs.readFileSync(path.join(dir,'publisher/delivery.json')));
    const frames=allFrames.filter(r=>r.frame.sessionId===journal.sessionId);
    assert.equal(frames.length,outcome.reportCount); assert(frames.length>=2);
    let previous=`0x${'0'.repeat(64)}`,images=0;
    for(const [index,record] of frames.entries()){
      assert.equal(record.frame.agent.toLowerCase(),agent); assert.equal(record.frame.source,'local-browser-worker');
      assert.equal(record.frame.sequence,index); assert.equal(record.frame.previousHash,previous);
      const message=browserFrameMessage(record.frame);
      assert.equal(record.hash,keccak256(toHex(message)));
      assert.equal(await verifyMessage({address:record.frame.operator,message,signature:record.signature}),true);
      if(['private','needs-account','error'].includes(record.frame.state)) assert.equal(record.frame.imageHash,null);
      if(record.frame.imageHash){
        const response=await fetch(`http://127.0.0.1:8795/v1/browser/frames/${record.hash}/image`);
        assert.equal(response.status,200); assert.equal(imageDigest(Buffer.from(await response.arrayBuffer())),record.frame.imageHash); images++;
      }
      previous=record.hash;
    }
    executions.push({platform:row.payload.platform,queueId:row.id,executionId:id,sessionId:journal.sessionId,
      status:row.last_result.status,reportCount:frames.length,images,containersCleaned:outcome.containersCleaned,
      image:outcome.image,prepared:row.prepared_payload,frames});
  }
  passed.push('Both social jobs came from the fresh launch automatically; actual Linux browsers reported outcomes without falsely acknowledging publication');
  passed.push('Public screen hashes, signatures and frame ordering verify; private steps contain no screenshots and browser containers were cleaned up');
  const receiptOutbox=(await database.pool.query("SELECT state,payload,last_result FROM halo_outbox WHERE deployment_id=$1 AND topic='operator-receipt' AND dedupe_key=$2",
    [`31337:${deployment.registry.toLowerCase()}`,`${agent}:0`])).rows[0];
  assert.equal(receiptOutbox.state,'delivered'); assert.equal(receiptOutbox.last_result.replicas.length,3);
  const publicReceipt=JSON.parse(await get(receiptOutbox.last_result.uri));
  assert.equal(publicReceipt.transactionHash,receipt.transactionHash);
  passed.push('The transactional receipt outbox completed verified publication to the three configured local IPFS peers');
  const report={checkedAt:new Date().toISOString(),agent,chainId:31337,jobId:job.id,launch:job.result,
    databaseName:new URL(privateConfig.url).pathname.slice(1),executions,publicReceiptURI:receiptOutbox.last_result.uri,
    receiptPublicationMetadataRecovered:receiptOutbox.last_result.recoveredMetadata===true,passed,
    scope:'Actual local RTX 5090 inference and EVM proof/launch, Windows producer, Linux PostgreSQL, autonomous Linux browser consumer and signed website relay. The verifier sends no transactions or external posts.',
    limitations:['All services are on one physical computer','X returned site-unavailable; FOMO has no authenticated account','Hosted model/operator independence, social account creation and mainnet deployment are unfinished']};
  fs.writeFileSync(path.join(root,'test-results/model-social-pipeline.json'),JSON.stringify(report,null,2));
  console.log(`PASS ${passed.length} fresh model-to-social-pipeline checks; ${executions.reduce((n,e)=>n+e.reportCount,0)} signed browser reports`);
}finally{await database.close();}
