import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createPublicClient,http,decodeEventLog} from 'viem';
import {verifiedActionCosts} from '../sdk/action-costs.mjs';
const deployment=JSON.parse(fs.readFileSync(new URL('../test-results/trading-deployment.json',import.meta.url)));
assert.equal(deployment.environment,'local');assert.equal(deployment.rpcUrl,'http://127.0.0.1:8547');assert.equal(deployment.chainId,31337);
const {agent}=JSON.parse(fs.readFileSync(new URL('../test-results/trading-preview.json',import.meta.url)));
const abi=JSON.parse(fs.readFileSync(new URL('../artifacts/AgentVault.json',import.meta.url))).abi;
const client=createPublicClient({transport:http(deployment.rpcUrl)});
const head=await client.getBlockNumber(),results=[];
const events=await client.getContractEvents({address:agent,abi,eventName:'ActionExecuted',fromBlock:BigInt(deployment.deploymentBlock),toBlock:head,strict:true});
for(const event of events){
  const receipt=await client.getTransactionReceipt({hash:event.transactionHash});
  assert.equal(receipt.status,'success');assert.equal((await client.getBlock({blockNumber:receipt.blockNumber})).hash,receipt.blockHash);
  const executed=receipt.logs.filter(l=>l.address.toLowerCase()===agent.toLowerCase()).map(l=>{try{return decodeEventLog({abi,...l});}catch{return null;}})
    .find(l=>l?.eventName==='ActionExecuted'&&l.args.nonce===event.args.nonce);
  const result=await verifiedActionCosts({client,agent,abi,receipt,executed,deploymentBlock:deployment.deploymentBlock});
  assert.equal(result.costAccounting,'canonical-action-transactions');
  assert.equal(result.gasCostWei,result.executionTransactionGasCostWei+result.observationGasCostWei);
  if([2,3].includes(Number(event.args.kind)))assert(result.observationGasCostWei>0n);
  results.push({nonce:event.args.nonce,kind:event.args.kind,transactionHash:event.transactionHash,...result});
}
assert(results.some(r=>r.kind===2));assert(results.some(r=>r.kind===3));
const report={checkedAt:new Date().toISOString(),agent,observedBlock:head,newTransactions:0,scope:'Read-only recomputation of existing local curve and graduated trades; no cloud or public-chain execution',results};
fs.writeFileSync(new URL('../test-results/action-costs-live.json',import.meta.url),JSON.stringify(report,(_,v)=>typeof v==='bigint'?v.toString():v,2));
console.log(`PASS ${results.length} existing action receipts with canonical full transaction costs`);
