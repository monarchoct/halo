// Real CPU proofs only. This does not benchmark full agents, browser work or cloud availability.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import os from 'node:os';
import {randomBytes} from 'node:crypto';
import {proveDecision} from '../../sdk/prover.mjs';
import {release} from './verify-release.mjs';

const count=Number(process.argv[2]??100),concurrency=Number(process.argv[3]??2);
if(!Number.isInteger(count)||count<1||count>1000||!Number.isInteger(concurrency)||concurrency<1||concurrency>8)throw new Error('Use count 1..1000 and concurrency 1..8');
const directory=path.resolve('/state',`proof-benchmark-${randomBytes(8).toString('hex')}`);
fs.mkdirSync(directory,{mode:0o700});
const releaseSha256=fs.readFileSync('models/core-v1/release/manifest.sha256','utf8').trim();
const started=performance.now(),samples=[];
let cursor=0;
async function worker(){
  while(cursor<count){
    const index=cursor++,begin=performance.now();
    const commitment=`0x${randomBytes(32).toString('hex')}`;
    const facts=Array(10).fill(1);if(index%5===0)facts[index%10]=0;
    const value=await proveDecision({commitment,facts,python:'/usr/local/bin/python',releaseSha256,
      outputDirectory:path.join(directory,String(index)),timeoutMs:120000});
    assert.equal(value.instances[74],facts.every(Boolean)?1n:0n);
    samples.push({index,authorization:Number(value.instances[74]),seconds:(performance.now()-begin)/1000,
      nativeSeconds:value.result.elapsedSeconds,proofSha256:value.result.proofSha256});
    if(samples.length%10===0||samples.length===count)console.log(JSON.stringify({completed:samples.length,total:count}));
  }
}
await Promise.all(Array.from({length:concurrency},worker));
const elapsedSeconds=(performance.now()-started)/1000,timings=samples.map(x=>x.seconds).sort((a,b)=>a-b);
const result={checkedAt:new Date().toISOString(),status:'passed',scope:'Real CPU decision proofs inside the portable runtime container; no full-agent or public-cloud capacity claim',
  ...release,node:process.version,cpu:os.cpus()[0]?.model,reportedHostCpus:os.cpus().length,count,concurrency,elapsedSeconds,
  proofsPerMinute:count/elapsedSeconds*60,medianSeconds:timings[Math.floor(count/2)],p95Seconds:timings[Math.ceil(count*0.95)-1],
  processMaxRssKiB:process.resourceUsage().maxRSS,
  memoryNote:'Parent Node process only; container peak must be measured independently.',samples:samples.sort((a,b)=>a.index-b.index)};
fs.writeFileSync(path.join(directory,'result.json'),JSON.stringify(result,null,2));
fs.writeFileSync('/state/latest-proof-benchmark.json',JSON.stringify(result,null,2));
console.log(JSON.stringify({...result,samples:undefined}));
