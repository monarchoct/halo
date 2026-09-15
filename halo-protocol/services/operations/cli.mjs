import fs from 'node:fs';
import path from 'node:path';
import {z} from 'zod';
import {createPublicClient,http} from 'viem';
import {openDatabase} from '../persistence/database.mjs';
import {createOperationsApi} from './server.mjs';
import {createSocialApi} from './social-api.mjs';
import {createXOAuth} from '../../runtime/social/x-oauth.mjs';
import {createSecretStore} from '../../runtime/identity/secret-store.mjs';

const configPath=path.resolve(process.argv[2]),directory=path.dirname(configPath);
const config=z.object({deploymentFile:z.string(),credentialEnvironment:z.string().regex(/^[A-Z][A-Z0-9_]+$/),
  caFile:z.string().optional(),host:z.enum(['127.0.0.1','0.0.0.0']).default('127.0.0.1'),port:z.number().int().min(1024).max(65535),
  allowedOrigins:z.array(z.string().url()).min(1).max(10),
  // Optional creator-signed connect/disconnect write surface. It needs a full read/write
  // database credential (never the restricted operations-reader role above) because every
  // write is itself gated on an on-chain-creator signature, not on database-level ACLs.
  social:z.object({credentialEnvironment:z.string().regex(/^[A-Z][A-Z0-9_]+$/),caFile:z.string().optional(),
    secretKeyFile:z.string(),secretDirectory:z.string(),
    x:z.object({clientIdEnvironment:z.string().regex(/^[A-Z][A-Z0-9_]+$/),clientSecretEnvironment:z.string().regex(/^[A-Z][A-Z0-9_]+$/),
      redirectUri:z.string().url()}).strict().optional()}).strict().optional(),
  }).strict().parse(JSON.parse(fs.readFileSync(configPath)));
const deployment=JSON.parse(fs.readFileSync(path.resolve(directory,config.deploymentFile)));
const local=process.argv.includes('--local-test');
if(local!==(deployment.environment==='local')||(local&&config.host!=='127.0.0.1'))throw new Error('Disposable local service must remain loopback');
const credential=process.env[config.credentialEnvironment];delete process.env[config.credentialEnvironment];
if(!credential)throw new Error('A dedicated operations-reader credential is required');
const database=openDatabase({url:credential,local,ca:config.caFile?fs.readFileSync(path.resolve(directory,config.caFile)):undefined,maxConnections:4});
const socialDatabase=config.social?openDatabase({url:(()=>{const v=process.env[config.social.credentialEnvironment];delete process.env[config.social.credentialEnvironment];if(!v)throw new Error('A dedicated social-connect write credential is required');return v;})(),
  local,ca:config.social.caFile?fs.readFileSync(path.resolve(directory,config.social.caFile)):undefined,maxConnections:4}):undefined;
let app;
try{
  const artifacts={AgentRegistry:JSON.parse(fs.readFileSync(new URL('../../artifacts/AgentRegistry.json',import.meta.url))),
    AgentVault:JSON.parse(fs.readFileSync(new URL('../../artifacts/AgentVault.json',import.meta.url)))};
  const client=createPublicClient({transport:http(deployment.rpcUrl,{timeout:10000,retryCount:0})});
  const social=config.social&&socialDatabase?await createSocialApi({database:socialDatabase,client,deployment,artifacts,
    secretStore:createSecretStore({keyFile:path.resolve(directory,config.social.secretKeyFile),directory:path.resolve(directory,config.social.secretDirectory)}),
    xOAuth:config.social.x?createXOAuth({clientId:process.env[config.social.x.clientIdEnvironment],clientSecret:process.env[config.social.x.clientSecretEnvironment],
      redirectUri:config.social.x.redirectUri}):undefined}):undefined;
  app=await createOperationsApi({database,client,deployment,artifacts,allowedOrigins:config.allowedOrigins,social});
  await app.listen({host:config.host,port:config.port});
  console.log(JSON.stringify({service:'halo-public-operations',port:config.port,chainId:deployment.chainId,local,social:!!social}));
  await new Promise(resolve=>{process.once('SIGINT',resolve);process.once('SIGTERM',resolve);});
}catch{console.error('Operations service could not start or continue. Check its deployment and dedicated reader configuration.');process.exitCode=1;}
finally{await app?.close();await database.close();await socialDatabase?.close();}
