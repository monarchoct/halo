import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {z} from 'zod';
import {createPublicClient,http} from 'viem';
import {openDatabase,verifySchema} from '../../services/persistence/database.mjs';
import {createInboxStore} from '../../services/persistence/inboxes.mjs';
import {createAgentMail} from './agentmail.mjs';
import {mailConfigurationSchema,createInboxProvisioner} from './provision.mjs';
import {assertSupportedDeployment} from '../../sdk/networks.mjs';

if(!process.argv[2])throw new Error('Usage: node runtime/identity/cli.mjs identity.json [--once] [--local-test]');
const file=path.resolve(process.argv[2]),resolve=value=>path.resolve(path.dirname(file),value);
const config=z.object({deploymentFile:z.string(),mail:mailConfigurationSchema,
  credentialEnvironment:z.string().regex(/^[A-Z][A-Z0-9_]*$/),
  database:z.object({connectionEnvironment:z.string().regex(/^[A-Z][A-Z0-9_]*$/),caFile:z.string().optional()}).strict(),
  pollSeconds:z.number().int().min(30).max(3600).default(300),
}).strict().parse(JSON.parse(fs.readFileSync(file)));
const deployment=JSON.parse(fs.readFileSync(resolve(config.deploymentFile))),local=process.argv.includes('--local-test');
assertSupportedDeployment(deployment);
if(local ? deployment.environment!=='local':deployment.environment==='local')throw new Error('Local identity provisioning requires --local-test');
const key=process.env[config.credentialEnvironment],url=process.env[config.database.connectionEnvironment];
if(!key||!url)throw new Error('Private mail or database configuration is missing');
const provider=createAgentMail({apiKey:key,organizationId:config.mail.organizationId});
const database=openDatabase({url,local,...(config.database.caFile?{ca:fs.readFileSync(resolve(config.database.caFile),'utf8')}:{})});
const client=createPublicClient({transport:http(deployment.rpcUrl,{timeout:15000,retryCount:1})});
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const artifacts=Object.fromEntries(['AgentRegistry','AgentVault'].map(name=>[name,JSON.parse(fs.readFileSync(path.join(root,`artifacts/${name}.json`)))]));
const abort=new AbortController();process.once('SIGINT',()=>abort.abort());process.once('SIGTERM',()=>abort.abort());
try {
  await verifySchema(database);
  const store=await createInboxStore({database,deployment,providerId:config.mail.organizationId,
    configuration:{domain:config.mail.domain,maxInboxes:config.mail.maxInboxes}});
  const provisioner=createInboxProvisioner({client,deployment,artifacts,store,provider,configuration:config.mail});
  console.log(JSON.stringify({service:'halo-agent-identity',chainId:deployment.chainId,assignedAgents:config.mail.agents.length,local}));
  while(!abort.signal.aborted){
    let incomplete=false;
    for(const entry of config.mail.agents){
      if(abort.signal.aborted)break;
      try{
        const result=await provisioner.ensure(entry.agent,{signal:abort.signal});
        incomplete ||= result.status!=='mail-ready';
        // Addresses and provider identifiers stay in the private identity store.
        console.log(JSON.stringify({service:'halo-agent-identity',agent:result.agent,status:result.status}));
      }catch(error){incomplete=true;if(!abort.signal.aborted)console.log(JSON.stringify({service:'halo-agent-identity',agent:entry.agent,status:error.code??'identity-unavailable'}));}
    }
    if(process.argv.includes('--once')){if(incomplete)process.exitCode=1;break;}
    await new Promise(resolve=>{
      const done=()=>{clearTimeout(timer);abort.signal.removeEventListener('abort',done);resolve();};
      const timer=setTimeout(done,config.pollSeconds*1000);abort.signal.addEventListener('abort',done,{once:true});if(abort.signal.aborted)done();
    });
  }
}finally{await database.close();}
