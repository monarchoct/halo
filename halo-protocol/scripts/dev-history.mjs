import fs from 'node:fs';
import {createPublicClient,http} from 'viem';
import {createApi} from '../services/api/server.mjs';
import {openDatabase} from '../services/persistence/database.mjs';
import {createLogJournal} from '../services/history/journal.mjs';
const artifacts=Object.fromEntries(fs.readdirSync(new URL('../artifacts/',import.meta.url)).filter(n=>n.endsWith('.json')).map(n=>[n.slice(0,-5),JSON.parse(fs.readFileSync(new URL(`../artifacts/${n}`,import.meta.url)))]));
const apps=[];
const database=process.env.HALO_HISTORY_DATABASE_URL?openDatabase({url:process.env.HALO_HISTORY_DATABASE_URL,local:true}):null;
try {
  for(const [name,port] of [['deployment.json',8797],['deployment-settlement.json',8798],['deployment-trading.json',8799]]) {
    const deployment=JSON.parse(fs.readFileSync(new URL(`../../halo-web/public/${name}`,import.meta.url)));
    if(deployment.environment!=='local')throw new Error('Development history service only supports disposable local chains');
    const client=createPublicClient({transport:http(deployment.rpcUrl,{timeout:10000,retryCount:1})});
    if(await client.getChainId()!==deployment.chainId)throw new Error('Chain mismatch');
    const genesis=await client.getBlock({blockNumber:0n});
    const historyJournal=database?createLogJournal({database,client,identity:`${deployment.chainId}:${deployment.registry}:${genesis.hash}`}):undefined;
    const app=await createApi({client,deployment,artifacts,historyJournal});apps.push(app);
    await app.listen({host:'127.0.0.1',port});console.log(JSON.stringify({service:'local-market-history',name,port}));
  }
  await new Promise(resolve=>{process.once('SIGINT',resolve);process.once('SIGTERM',resolve);});
} finally {await Promise.all(apps.map(app=>app.close()));await database?.close();}
