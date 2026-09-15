import assert from 'node:assert/strict';
import fs from 'node:fs';
import {randomBytes,createHash} from 'node:crypto';
import {parseAbiItem,encodeEventTopics,encodeAbiParameters,createPublicClient,http} from 'viem';
import {openDatabase} from '../services/persistence/database.mjs';
import {createLogJournal} from '../services/history/journal.mjs';
import {marketHistory} from '../sdk/market-history.mjs';
const base=new URL(process.env.HALO_TEST_DATABASE_URL);assert.equal(base.hostname,'127.0.0.1');
const name=`halo_history_test_${randomBytes(6).toString('hex')}`;base.pathname='/postgres';
const admin=openDatabase({url:base.href,local:true});
try{await admin.pool.query(`CREATE DATABASE "${name}"`);}finally{await admin.close();}
base.pathname=`/${name}`;const database=openDatabase({url:base.href,local:true});
const passed=[];
try {
  await database.pool.query(fs.readFileSync(new URL('../services/history/schema.sql',import.meta.url),'utf8'));
  let epoch=0,logCalls=0,fail=false,mutate=false;
  const hash=n=>'0x'+createHash('sha256').update(`${n}:${n>=6n?epoch:0}`).digest('hex');
  const event=parseAbiItem('event Trade(uint256 amount)'),address='0x'+'12'.repeat(20);
  const args={address,event,fromBlock:0n,toBlock:9n,strict:true};
  const fake={getBlockNumber:async()=>30n,getBlock:async({blockNumber:n})=>{if(fail)throw new Error('RPC offline');return {number:n,hash:hash(n)};},
    getLogs:async({fromBlock,toBlock})=>{logCalls++;if(mutate)epoch++;return [1n,4n,7n].filter(n=>n>=fromBlock&&n<=toBlock).map(n=>({address,blockNumber:n,blockHash:hash(n),
      transactionHash:'0x'+'34'.repeat(32),logIndex:0,transactionIndex:0,removed:false,topics:encodeEventTopics({abi:[event],eventName:'Trade'}),
      data:encodeAbiParameters([{type:'uint256'}],[n===7n&&epoch?99n:n])}));}};
  const config={database,client:fake,identity:'disposable-fork-test',chunkSize:3n};
  let journal=createLogJournal(config);
  assert.deepEqual((await journal(args)).map(l=>l.args.amount),[1n,4n,7n]);assert.equal(logCalls,4);
  journal=createLogJournal(config);await journal(args);assert.equal(logCalls,4);
  passed.push('Restart reads persisted batches without refetching RPC logs');
  epoch=1;assert.deepEqual((await journal(args)).map(l=>l.args.amount),[1n,4n,99n]);assert.equal(logCalls,6);
  passed.push('Fork rollback removes orphan logs and replaces the affected suffix');
  const before=(await database.pool.query('SELECT count(*) FROM halo_history_logs')).rows[0].count;
  fail=true;await assert.rejects(journal(args),/offline/);fail=false;
  assert.equal((await database.pool.query('SELECT count(*) FROM halo_history_logs')).rows[0].count,before);
  passed.push('RPC failure cannot delete the previous canonical projection');
  const incremental=createLogJournal({...config,identity:'bounded-backfill',maxChunks:1});
  for(let i=0;i<3;i++)await assert.rejects(incremental(args),/backfill/);
  assert.equal((await incremental(args)).length,3);
  passed.push('Backfill progresses durably across bounded retries');
  mutate=true;await assert.rejects(createLogJournal({...config,identity:'mid-read-fork'})({...args,fromBlock:6n}),/reorganized/);mutate=false;
  passed.push('Reorganization during acquisition refuses the batch');
  const source={...fake,getLogs:async p=>{throw new Error('Injected acquisition crash');}};
  await assert.rejects(createLogJournal({...config,client:source,identity:'crash'}) (args),/crash/);
  assert.equal((await createLogJournal({...config,identity:'crash'})(args)).length,3);
  passed.push('Acquisition failure releases the stream lock for a replacement worker');
  const growth=createLogJournal({...config,client:{...fake,getBlockNumber:async()=>200n},identity:'refresh-growth',chunkSize:20n});
  for(let end=0n;end<100n;end++)await growth({...args,toBlock:end});
  const anchorCount=Number((await database.pool.query(`SELECT count(*) FROM halo_history_checkpoints c JOIN halo_history_streams s ON s.id=c.stream_id WHERE s.specification->>'identity'='refresh-growth'`)).rows[0].count);
  assert.equal(anchorCount,5,'100 advancing refreshes retain only five block-window checkpoints');
  epoch++;
  assert.deepEqual((await growth({...args,toBlock:99n})).map(l=>l.args.amount),[1n,4n,99n]);
  assert.equal((await growth({...args,toBlock:3n})).length,1,'An older snapshot still excludes later saved events');
  passed.push('100 advancing refreshes keep five anchors; compacted history still recovers forks and serves older snapshots');
  const deployment=JSON.parse(fs.readFileSync(new URL('../test-results/trading-deployment.json',import.meta.url)));
  const artifacts=Object.fromEntries(fs.readdirSync(new URL('../artifacts/',import.meta.url)).filter(n=>n.endsWith('.json')).map(n=>[n.slice(0,-5),JSON.parse(fs.readFileSync(new URL(`../artifacts/${n}`,import.meta.url)))]));
  const rpc=createPublicClient({transport:http(deployment.rpcUrl)});let realLogCalls=0;
  const counted={...rpc,getLogs:p=>{realLogCalls++;return rpc.getLogs(p);}};
  const genesis=await rpc.getBlock({blockNumber:0n});
  const journalConfig={database,client:counted,identity:`${deployment.chainId}:${deployment.registry}:${genesis.hash}`};
  const token='0xddEA3d67503164326F90F53CFD1705b90Ed1312D';
  const direct=await marketHistory({client:rpc,deployment,artifacts})(token);
  const persisted=await marketHistory({client:rpc,deployment,artifacts,journal:createLogJournal(journalConfig)})(token);
  assert.deepEqual(persisted.points,direct.points);
  const calls=realLogCalls;
  const restarted=await marketHistory({client:rpc,deployment,artifacts,journal:createLogJournal(journalConfig)})(token);
  assert.deepEqual(restarted.points,direct.points);assert(realLogCalls-calls<=5,'Only newly mined suffixes may be fetched');
  passed.push('Real curve, graduation and pool points match the original reader after process reconstruction');
  const result={checkedAt:new Date().toISOString(),database:name,passed,realEvents:persisted.points.length,initialRealLogCalls:calls,restartLogCalls:realLogCalls-calls,newTransactions:0};
  fs.writeFileSync(new URL('../test-results/history-journal.json',import.meta.url),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}finally{await database.close();}
