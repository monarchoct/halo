import fs from 'node:fs';
import path from 'node:path';
import {z} from 'zod';
import {createPublicClient,http} from 'viem';
import {openDatabase} from '../persistence/database.mjs';
import {createOperationsApi} from './server.mjs';

const configPath=path.resolve(process.argv[2]),directory=path.dirname(configPath);
const config=z.object({deploymentFile:z.string(),credentialEnvironment:z.string().regex(/^[A-Z][A-Z0-9_]+$/),
  caFile:z.string().optional(),host:z.enum(['127.0.0.1','0.0.0.0']).default('127.0.0.1'),port:z.number().int().min(1024).max(65535),
  allowedOrigins:z.array(z.string().url()).min(1).max(10)}).strict().parse(JSON.parse(fs.readFileSync(configPath)));
const deployment=JSON.parse(fs.readFileSync(path.resolve(directory,config.deploymentFile)));
const local=process.argv.includes('--local-test');
if(local!==(deployment.environment==='local')||(local&&config.host!=='127.0.0.1'))throw new Error('Disposable local service must remain loopback');
const credential=process.env[config.credentialEnvironment];delete process.env[config.credentialEnvironment];
if(!credential)throw new Error('A dedicated operations-reader credential is required');
const database=openDatabase({url:credential,local,ca:config.caFile?fs.readFileSync(path.resolve(directory,config.caFile)):undefined,maxConnections:4});
let app;
try{
  const artifacts={AgentRegistry:JSON.parse(fs.readFileSync(new URL('../../artifacts/AgentRegistry.json',import.meta.url)))};
  app=await createOperationsApi({database,client:createPublicClient({transport:http(deployment.rpcUrl,{timeout:10000,retryCount:0})}),deployment,artifacts,allowedOrigins:config.allowedOrigins});
  await app.listen({host:config.host,port:config.port});
  console.log(JSON.stringify({service:'halo-public-operations',port:config.port,chainId:deployment.chainId,local}));
  await new Promise(resolve=>{process.once('SIGINT',resolve);process.once('SIGTERM',resolve);});
}catch{console.error('Operations service could not start or continue. Check its deployment and dedicated reader configuration.');process.exitCode=1;}
finally{await app?.close();await database.close();}
