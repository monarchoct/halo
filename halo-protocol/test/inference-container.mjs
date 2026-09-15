import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {proposalSchema} from '../runtime/proposals.mjs';

// Linux lab only. Run after the image build and model copy; no operator/chain call.
assert.equal(process.platform,'linux');
const image='halo-inference:cpu',modelDirectory='/home/halo/lab/inference-models';
const fixture=JSON.parse(fs.readFileSync(new URL('../test-results/linux-inference-request.json',import.meta.url)));
const docker=(args,timeout=30000)=>execFileSync('docker',args,{encoding:'utf8',timeout,stdio:['ignore','pipe','pipe']});
const imageId=docker(['image','inspect',image,'--format','{{.Id}}']).trim();
const scratch=fs.mkdtempSync(path.join(os.tmpdir(),'halo-inference-test-'));
fs.chmodSync(scratch,0o755);
const key=randomBytes(32).toString('hex'),keyPath=path.join(scratch,'api-key');
fs.writeFileSync(keyPath,key,{mode:0o400});fs.chownSync(keyPath,1000,1000);
const name=`halo-inference-check-${randomBytes(5).toString('hex')}`;
const isolation=['--read-only','--cap-drop','ALL','--security-opt','no-new-privileges','--pids-limit','128'];
const passed=[];let running=false;
try {
  const version=docker(['run','--rm','--network','none','--user','1000:1000','--memory','512m',...isolation,image,'check-binary']);
  assert(version.trim());passed.push('Pinned-source server binary loads in an isolated non-root Linux container');
  assert.throws(()=>docker(['run','--rm','--network','none','--user','0:0','--memory','512m',...isolation,image,'check-binary']));
  assert.throws(()=>docker(['run','--rm','--network','none','--user','1000:1000','--memory','512m',...isolation,image]));
  passed.push('Root execution and missing model refuse startup');
  docker(['run','--detach','--rm','--name',name,'--user','1000:1000','--cpus','2','--memory','6g',...isolation,
    '--tmpfs','/tmp:rw,nosuid,nodev,noexec,size=128m,uid=1000,gid=1000','--env','HALO_REQUIRE_GPU=0',
    '--mount',`type=bind,src=${modelDirectory},dst=/models,readonly`,
    '--mount',`type=bind,src=${keyPath},dst=/run/secrets/inference-key,readonly`,
    '--publish','127.0.0.1:8083:8080',image]);running=true;
  let ready=false;
  for(let i=0;i<90;i++) {
    try{ready=(await fetch('http://127.0.0.1:8083/health',{signal:AbortSignal.timeout(3000)})).ok;}catch{}
    if(ready)break;
    assert.equal(docker(['inspect',name,'--format','{{.State.Running}}']).trim(),'true','Inference exited during startup');
    await new Promise(resolve=>setTimeout(resolve,2000));
  }
  assert(ready,'Model must become healthy within three minutes');
  const unauth=await fetch('http://127.0.0.1:8083/v1/models');assert.equal(unauth.status,401);
  const headers={Authorization:`Bearer ${key}`,'Content-Type':'application/json'};
  const models=await (await fetch('http://127.0.0.1:8083/v1/models',{headers})).json();
  assert(models.data.some(m=>m.id==='halo-qwen35-4b-v1'));
  passed.push('Real pinned model loads; unauthenticated API calls are rejected and authenticated alias matches');
  const started=Date.now();
  const response=await fetch('http://127.0.0.1:8083/v1/chat/completions',{method:'POST',headers,body:JSON.stringify(fixture),signal:AbortSignal.timeout(300000)});
  assert(response.ok,`Inference HTTP ${response.status}`);
  const body=await response.json(),elapsedSeconds=(Date.now()-started)/1000;
  assert.equal(body.model,'halo-qwen35-4b-v1');assert.equal(body.choices[0].finish_reason,'stop');
  const proposal=proposalSchema.parse(JSON.parse(body.choices[0].message.content));
  assert.equal(proposal.module,'halo-qwen35-4b-v1');
  passed.push('The Linux container generates a real structured proposal accepted by the HALO schema');
  const result={checkedAt:new Date().toISOString(),imageId,passed,elapsedSeconds,usage:body.usage,proposal,
    withinOperator90SecondDeadline:elapsedSeconds<90,scope:'Local Linux CPU diagnostic on one founder PC; no GPU/cloud capacity or new transactions'};
  fs.writeFileSync(new URL('../test-results/inference-container.json',import.meta.url),JSON.stringify(result,null,2));
  console.log(JSON.stringify(result));
}catch(error){
  console.error(error.message);
  if(running)console.error(docker(['logs','--tail','12',name]).replaceAll(key,'[redacted]'));
  throw error;
}finally{
  if(running)try{docker(['stop','--time','10',name]);}catch{}
  fs.rmSync(keyPath,{force:true});fs.rmdirSync(scratch);
}
