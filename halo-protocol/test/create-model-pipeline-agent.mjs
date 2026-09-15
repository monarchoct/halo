import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createPublicClient, createWalletClient, decodeEventLog, defineChain, http, keccak256, parseEther, toHex } from 'viem';
import { root } from '../scripts/compile.mjs';
import { agentManifestSchema, canonicalJson } from '../sdk/manifest.mjs';
import { kuboReplica, replicatedArtifacts } from '../sdk/artifacts.mjs';
import { gasWithHeadroom } from '../sdk/transaction-gas.mjs';

// One actual disposable agent for the model -> scheduler -> browser acceptance.
// This file creates/funds/activates it; only the normal model worker may launch children.
const deployment=JSON.parse(fs.readFileSync(path.join(root,'../halo-web/public/deployment-trading.json')));
assert.equal(deployment.environment,'local'); assert.equal(deployment.chainId,31337);
assert.equal(deployment.rpcUrl,'http://127.0.0.1:8547');
const chain=defineChain({id:31337,name:deployment.chainName,nativeCurrency:{name:'Test Ether',symbol:'ETH',decimals:18},rpcUrls:{default:{http:[deployment.rpcUrl]}}});
const client=createPublicClient({chain,transport:http(deployment.rpcUrl)}), wallet=createWalletClient({chain,transport:http(deployment.rpcUrl)});
assert.equal(await client.getChainId(),31337);
const [funder,creator]=await wallet.getAddresses();
const artifacts=Object.fromEntries(['AgentRegistry','AgentVault','HaloToken','HaloCurve'].map(name=>[name,JSON.parse(fs.readFileSync(path.join(root,`artifacts/${name}.json`)))]));
const read=(address,name,functionName,args=[])=>client.readContract({address,abi:artifacts[name].abi,functionName,args});
const peers=JSON.parse(fs.readFileSync(path.join(root,'test-results/local-ipfs.json'))).peers;
const store=replicatedArtifacts({replicas:peers.map(apiUrl=>kuboReplica({apiUrl}))});
const release=fs.readFileSync(path.join(root,'models/proposal-qwen35-4b/release.json'));
const manifest=agentManifestSchema.parse({version:'halo.agent.v1',chainId:31337,
  identity:{name:'Lyra',symbol:'LYRA',description:'Autonomous narrative scout exploring space discoveries and open-source AI culture. Local test assets; public Qwen baseline, not a trained profit strategy.'},
  models:{mode:'public-model',core:'halo-core-v1',releaseSha256:deployment.coreReleaseSha256,proposalEndpoint:'',
    proposalReleaseSha256:createHash('sha256').update(release).digest('hex'),reproducibility:'public-weights'},
  policy:{maxPositionBps:1000,maxDailyDebitBps:1000,maxLaunchesPerDay:2,maxSlippageBps:300,intervalSeconds:900,
    workReward:parseEther('0.01').toString(),childGraduationTarget:parseEther('1000000').toString()},
  fees:{tradingBps:100,operationsBps:6000,haloBps:2000,creator},graduationTarget:parseEther('1000000').toString()});
const publication=await store.putBytes(Buffer.from(canonicalJson(manifest)));
const reportFile=path.join(root,'test-results/model-pipeline-agent.json');
fs.writeFileSync(reportFile,JSON.stringify({state:'creation-started',manifest,manifestURI:publication.uri,chainId:31337},null,2),{flag:'wx'});
let report=JSON.parse(fs.readFileSync(reportFile));
const checkpoint=()=>fs.writeFileSync(reportFile,JSON.stringify(report,null,2));
async function send(address,name,functionName,args,account) {
  const {request}=await client.simulateContract({address,abi:artifacts[name].abi,functionName,args,account});
  const hash=await wallet.writeContract({...request,gas:gasWithHeadroom(await client.estimateContractGas(request))});
  report.pending={functionName,hash}; checkpoint();
  const receipt=await client.waitForTransactionReceipt({hash}); assert.equal(receipt.status,'success');
  (report.transactions??=[]).push({functionName,hash,blockNumber:receipt.blockNumber.toString()}); delete report.pending; checkpoint();
  return receipt;
}
const created=await send(deployment.registry,'AgentRegistry','createAgent',[manifest.identity.name,manifest.identity.symbol,
  keccak256(toHex(canonicalJson(manifest))),publication.uri,BigInt(manifest.graduationTarget),
  {...manifest.policy,workReward:BigInt(manifest.policy.workReward),childGraduationTarget:BigInt(manifest.policy.childGraduationTarget)},
  {...manifest.fees,operations:creator}],creator);
const event=created.logs.flatMap(log=>{try{const e=decodeEventLog({abi:artifacts.AgentRegistry.abi,...log});return e.eventName==='AgentCreated'?[e]:[];}catch{return[];}})[0];
assert(event);
report={...report,state:'created',agent:event.args.agent,token:event.args.token,curve:event.args.curve}; checkpoint();
const capital=parseEther('10000'),reserve=await read(report.agent,'AgentVault','reserveRequired',[30n]);
assert((await read(deployment.rootHalo,'HaloToken','balanceOf',[funder]))>=capital);
assert((await read(deployment.operatingToken,'HaloToken','balanceOf',[funder]))>=reserve);
await send(deployment.rootHalo,'HaloToken','approve',[report.curve,capital],funder);
await send(report.curve,'HaloCurve','buy',[capital,1n,report.agent,(await client.getBlock()).timestamp+600n],funder);
await send(deployment.operatingToken,'HaloToken','transfer',[report.agent,reserve],funder);
await send(report.agent,'AgentVault','activate',[],creator);
assert.equal(await read(report.agent,'AgentVault','active'),true);
assert.equal(await read(report.agent,'AgentVault','nonce'),0n);
report={...report,state:'activated',operatingFunding:reserve.toString(),capitalInput:capital.toString(),checkedAt:new Date().toISOString(),
  scope:'Actual creation and funding on the existing disposable chain. No child launch, model inference or external social account was created by this setup.'}; checkpoint();
console.log(JSON.stringify({state:report.state,agent:report.agent,token:report.token,manifestURI:report.manifestURI,transactions:report.transactions.length}));
