import {release} from './verify-release.mjs';
import {spawn} from 'node:child_process';

const modes={operator:'runtime/cli.mjs',operations:'services/operations/cli.mjs',relays:'services/relay/cli.mjs',artifacts:'services/artifacts/cli.mjs',social:'runtime/social-cli.mjs',identity:'runtime/identity/cli.mjs',
  api:'services/api/cli.mjs',migrate:'services/persistence/migrate-cli.mjs',
  'proof-benchmark':'deploy/runtime/proof-benchmark.mjs'};
const mode=process.argv[2];
if(process.platform!=='linux'||process.getuid()!==1000)throw new Error('Runtime requires Linux UID 1000');
if(mode==='check')console.log(JSON.stringify({service:'halo-runtime',status:'verified',node:process.version,...release}));
else {
  if(!Object.hasOwn(modes,mode))throw new Error('Choose check, operator, operations, api, relays, artifacts, social, identity, migrate or proof-benchmark');
  const child=spawn(process.execPath,[modes[mode],...process.argv.slice(3)],{stdio:'inherit',shell:false});
  for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>child.kill(signal));
  child.once('error',()=>{console.error('Runtime process could not start');process.exitCode=1;});
  child.once('exit',(code,signal)=>{process.exitCode=code??(signal==='SIGTERM'?0:1);});
}
