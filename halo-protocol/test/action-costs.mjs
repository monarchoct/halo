import assert from 'node:assert/strict';
import fs from 'node:fs';
import {encodeFunctionData,encodeEventTopics,encodeAbiParameters,zeroHash} from 'viem';
import {verifiedActionCosts} from '../sdk/action-costs.mjs';
const abi=JSON.parse(fs.readFileSync(new URL('../artifacts/AgentVault.json',import.meta.url))).abi;
const agent=`0x${'1'.repeat(40)}`,child=`0x${'2'.repeat(40)}`,operator=`0x${'3'.repeat(40)}`,other=`0x${'4'.repeat(40)}`;
const executionHash=`0x${'a'.repeat(64)}`,observationHash=`0x${'b'.repeat(64)}`,snapshotId=`0x${'c'.repeat(64)}`,blockHash=`0x${'d'.repeat(64)}`;
const passed=[];
function fixture(kind=2){
  const action={nonce:3n,kind,child:kind>=2?child:`0x${'0'.repeat(40)}`,amount:kind>=2?100n:0n,
    minOutput:kind>=2?80n:0n,beneficiary:operator,evidenceHash:zeroHash,snapshotId:kind>=2?snapshotId:zeroHash,
    deadline:100000n,name:'',symbol:'',metadataURI:''};
  const executed={args:{...action}};
  const observed={snapshotId,nonce:3n,child,kind:2,amount:100n,quotedOutput:99n,sold:123n,blockNumber:10n,timestamp:999n};
  const event=abi.find(e=>e.type==='event'&&e.name==='TradeObserved');
  const log=()=>({address:agent,topics:encodeEventTopics({abi,eventName:'TradeObserved',args:observed}),
    data:encodeAbiParameters(event.inputs.filter(i=>!i.indexed),event.inputs.filter(i=>!i.indexed).map(i=>observed[i.name]))});
  const receipt={transactionHash:executionHash,status:'success',blockNumber:11n,blockHash,gasUsed:100n,effectiveGasPrice:5n};
  const observationReceipt={transactionHash:observationHash,status:'success',blockNumber:10n,blockHash,gasUsed:10n,effectiveGasPrice:3n,get logs(){return [log()];}};
  const transaction={to:agent,from:operator,input:encodeFunctionData({abi,functionName:'execute',args:[action,'0x']})};
  const observationTransaction={to:agent,from:operator,input:encodeFunctionData({abi,functionName:'snapshotTrade',args:[child,2,100n]})};
  let scans=0;
  const client={getTransaction:async({hash})=>hash===executionHash?transaction:observationTransaction,
    getTransactionReceipt:async()=>observationReceipt,getBlock:async()=>({hash:blockHash}),
    getContractEvents:async()=>{scans++;return [{transactionHash:observationHash}];}};
  return {args:{client,agent,abi,receipt,executed,deploymentBlock:0},transaction,observationTransaction,observationReceipt,observed,scans:()=>scans};
}
let f=fixture();let r=await verifiedActionCosts({...f.args,observationHash});
assert.equal(r.gasCostWei,530n);assert.equal(r.operatorGasCostWei,530n);assert.equal(r.observationGasCostWei,30n);assert.equal(f.scans(),0);
passed.push('Fresh action accounting includes independently verified observation and execution fees');
f=fixture();r=await verifiedActionCosts(f.args);assert.equal(r.gasCostWei,530n);assert.equal(f.scans(),1);
passed.push('Recovery finds the exact committed observation without the original operator result');
f=fixture();f.observationTransaction.from=other;r=await verifiedActionCosts(f.args);
assert.equal(r.gasCostWei,530n);assert.equal(r.operatorGasCostWei,500n);
f.transaction.from=other;r=await verifiedActionCosts(f.args);assert.equal(r.operatorGasCostWei,0n);
passed.push('Third-party gas payments are distinguished from the paid operator’s expenditure');
f=fixture();f.observed.snapshotId=zeroHash;await assert.rejects(verifiedActionCosts({...f.args,observationHash}),/committed snapshot/);
f=fixture();f.observed.nonce=4n;await assert.rejects(verifiedActionCosts(f.args),/different trade/);
passed.push('An unrelated snapshot or nonce cannot inflate costs');
f=fixture();f.observationReceipt.blockHash=zeroHash;await assert.rejects(verifiedActionCosts(f.args),/not canonical/);
f=fixture();f.observationReceipt.status='reverted';await assert.rejects(verifiedActionCosts(f.args),/not canonical/);
f=fixture();f.observationReceipt.blockNumber=11n;await assert.rejects(verifiedActionCosts(f.args),/not canonical/);
passed.push('Reverted, reorganized and same-block observations are rejected');
f=fixture();f.transaction.to=other;r=await verifiedActionCosts(f.args);assert.equal(r.gasCostWei,null);assert.equal(r.costAccounting,'unresolved-batched-execution');
f=fixture();f.observationTransaction.to=other;r=await verifiedActionCosts(f.args);assert.equal(r.gasCostWei,null);assert.equal(r.observationGasCostWei,null);
passed.push('A batched transaction is not falsely attributed entirely to one agent');
for(const kind of [0,1]){f=fixture(kind);r=await verifiedActionCosts(f.args);assert.equal(r.gasCostWei,500n);assert.equal(r.observationGasCostWei,0n);assert.equal(f.scans(),0);}
passed.push('Hold and launch costs do not trigger observation backfill');
f=fixture();f.args.executed.args.amount=101n;await assert.rejects(verifiedActionCosts(f.args),/calldata differs/);
f=fixture();f.observationTransaction.input=encodeFunctionData({abi,functionName:'snapshotTrade',args:[child,2,999n]});await assert.rejects(verifiedActionCosts(f.args),/calldata mismatch/);
passed.push('Execution and observation calldata must match their accepted events');
const result={checkedAt:new Date().toISOString(),passed,scope:'Injected canonical receipt/transaction boundary cases; separate live read-only acceptance covers existing local trades'};
fs.writeFileSync(new URL('../test-results/action-costs.json',import.meta.url),JSON.stringify(result,null,2));
console.log(`PASS ${passed.length} action-cost accounting scenarios`);
