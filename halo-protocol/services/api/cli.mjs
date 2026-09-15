import fs from 'node:fs';
import path from 'node:path';
import {z} from 'zod';
import {createPublicClient,http} from 'viem';
import {assertSupportedDeployment} from '../../sdk/networks.mjs';
import {createApi} from './server.mjs';
import {openDatabase} from '../persistence/database.mjs';
import {createLogJournal} from '../history/journal.mjs';

if(!process.argv[2])throw new Error('Usage: api /config/api.json');
const configPath=path.resolve(process.argv[2]);
const config=z.object({deploymentFile:z.string(),host:z.enum(['127.0.0.1','0.0.0.0']).default('127.0.0.1'),
  port:z.number().int().min(1024).max(65535),historyDatabaseFile:z.string().optional(),allowedOrigins:z.array(z.string().url()).min(1).max(10)}).strict().parse(JSON.parse(fs.readFileSync(configPath)));
const deployment=JSON.parse(fs.readFileSync(path.resolve(path.dirname(configPath),config.deploymentFile)));
assertSupportedDeployment(deployment);
if(deployment.environment==='local')throw new Error('Use the isolated development stack for local chains');
const client=createPublicClient({transport:http(deployment.rpcUrl,{timeout:10000,retryCount:1})});
if(await client.getChainId()!==deployment.chainId)throw new Error('RPC chain differs from deployment');
const artifacts=Object.fromEntries(fs.readdirSync(new URL('../../artifacts/',import.meta.url)).filter(n=>n.endsWith('.json'))
  .map(name=>[name.slice(0,-5),JSON.parse(fs.readFileSync(new URL(`../../artifacts/${name}`,import.meta.url)))]));
let app,database;
try{
  let historyJournal;
  if(config.historyDatabaseFile){
    const privatePath=path.resolve(path.dirname(configPath),config.historyDatabaseFile);
    const dbConfig=z.object({url:z.string().url(),caFile:z.string().optional()}).strict().parse(JSON.parse(fs.readFileSync(privatePath)));
    database=openDatabase({url:dbConfig.url,ca:dbConfig.caFile?fs.readFileSync(path.resolve(path.dirname(privatePath),dbConfig.caFile),'utf8'):undefined});
    await database.pool.query('SELECT id FROM halo_history_streams LIMIT 0');
    const genesis=await client.getBlock({blockNumber:0n});
    historyJournal=createLogJournal({database,client,identity:`${deployment.chainId}:${deployment.registry}:${genesis.hash}`});
  }
  app=await createApi({client,deployment,artifacts,historyJournal,allowedOrigins:config.allowedOrigins});
  await app.listen({host:config.host,port:config.port});
  console.log(JSON.stringify({service:'halo-public-api',chainId:deployment.chainId,port:config.port}));
  await new Promise(resolve=>{process.once('SIGINT',resolve);process.once('SIGTERM',resolve);});
}finally{await app?.close();await database?.close();}
