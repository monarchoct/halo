import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {spawnSync} from 'node:child_process';
assert.equal(process.platform,'linux');assert.equal(process.getuid(),0,'Use sudo for Docker; the runtime remains UID 1000');
const image=process.argv[2];assert.match(image??'',/^sha256:[a-f0-9]{64}$/);
const name=`halo-runtime-check-${randomBytes(6).toString('hex')}`,directory=fs.mkdtempSync(path.join(os.tmpdir(),name));
fs.chmodSync(directory,0o755);
const state=path.join(directory,'state');fs.mkdirSync(state);fs.chownSync(state,1000,1000);
const passed=[];
function docker(args,{fail=false,env=process.env}={}){
  const r=spawnSync('docker',args,{encoding:'utf8',env,timeout:120000,maxBuffer:1024*1024});
  if(!fail)assert.equal(r.status,0,r.stderr||r.stdout||r.error?.message);return r;
}
const limits=['--network','none','--read-only','--cap-drop','ALL','--security-opt','no-new-privileges','--pids-limit','128',
  '--memory','3g','--cpus','2','--tmpfs','/tmp:rw,nosuid,nodev,size=256m','--mount',`type=bind,src=${state},dst=/state`];
let actual,source;
try{
  const checked=docker(['run','--name',name,...limits,image,'check']);source=JSON.parse(checked.stdout.trim());
  const inspected=JSON.parse(docker(['inspect',name]).stdout)[0];
  assert.equal(inspected.Config.User,'1000:1000');assert.equal(inspected.HostConfig.ReadonlyRootfs,true);
  assert.deepEqual(inspected.HostConfig.CapDrop,['ALL']);assert.equal(inspected.HostConfig.NetworkMode,'none');
  assert.equal(inspected.HostConfig.Memory,3*1024**3);assert.equal(inspected.HostConfig.NanoCpus,2e9);assert.equal(inspected.HostConfig.PidsLimit,128);
  actual={image:inspected.Image,user:inspected.Config.User,readOnly:true,network:'none',memoryLimitBytes:inspected.HostConfig.Memory,cpuLimit:2,pidLimit:128};
  passed.push('Actual immutable image starts as UID 1000 with read-only root, no network, dropped capabilities and bounded resources');
  assert.notEqual(docker(['run','--rm',...limits,'--user','0:0',image,'check'],{fail:true}).status,0);
  passed.push('Root execution is refused by the runtime entry point');
  const changed=path.join(directory,'changed.md');fs.writeFileSync(changed,'Altered public release');fs.chmodSync(changed,0o644);
  const rejected=docker(['run','--rm',...limits,'--mount',`type=bind,src=${changed},dst=/opt/halo/runtime/prompts/narrative.md,readonly`,image,'check'],{fail:true});
  assert.notEqual(rejected.status,0);assert.match(rejected.stderr,/checksum failed/);
  passed.push('Changing a bundled source file is rejected before an operator can start');
  const probe=`import assert from 'node:assert/strict';import fs from 'node:fs';import {publicPythonEnvironment} from './sdk/python-process.mjs';
    assert.throws(()=>fs.writeFileSync('/opt/halo/forbidden','x'),e=>['EROFS','EACCES'].includes(e.code));
    assert.equal(publicPythonEnvironment().HALO_TEST_CREDENTIAL,undefined);assert.equal(fs.existsSync('/var/run/docker.sock'),false);console.log('boundary-ok');`;
  assert.match(docker(['run','--rm',...limits,'--env','HALO_TEST_CREDENTIAL=nonsecret-test-marker','--entrypoint','node',image,'--input-type=module','--eval',probe]).stdout,/boundary-ok/);
  passed.push('Runtime cannot rewrite its source or access Docker; prover environment excludes service credentials');
  docker(['run','--rm',...limits,image,'proof-benchmark','2','1']);
  const benchmark=JSON.parse(fs.readFileSync(path.join(state,'latest-proof-benchmark.json')));
  assert.equal(benchmark.count,2);assert.deepEqual(benchmark.samples.map(s=>s.authorization),[0,1]);
  passed.push('Packaged CPU prover verifies fresh denied and permitted outputs with all network access removed');
  const env={...process.env,HALO_RUNTIME_IMAGE:image};
  for(const key of ['HALO_API_CONFIG','HALO_OPERATIONS_CONFIG','HALO_OPERATOR_CONFIG'])env[key]=directory;
  const empty=path.join(directory,'empty.env');fs.writeFileSync(empty,'');
  env.HALO_OPERATIONS_ENV=empty;env.HALO_OPERATOR_ENV=empty;env.HALO_OPERATOR_KEY=empty;env.HALO_OPERATOR_STATE=state;
  docker(['compose','-f',new URL('../deploy/runtime/compose.yaml',import.meta.url).pathname,'--profile','execute','config','--quiet'],{env});
  passed.push('Runtime Compose schema resolves read services and the opt-in execution profile without starting them');
  const report={checkedAt:new Date().toISOString(),status:'passed',scope:'Actual local Linux runtime image; no provider lease, public chain, cloud GPU or social publication',actual,source,passed};
  fs.writeFileSync(new URL('../test-results/runtime-container.json',import.meta.url),JSON.stringify(report,null,2));
  console.log(`PASS ${passed.length} portable runtime container checks`);
}finally{
  docker(['rm','-f',name],{fail:true});
  // This directory is an exclusively created temporary acceptance workspace.
  fs.rmSync(directory,{recursive:true,force:true});
}
