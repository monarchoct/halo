import {decodeFunctionData,decodeEventLog,zeroHash} from 'viem';
const same=(a,b)=>typeof a==='string'&&typeof b==='string'&&a.toLowerCase()===b.toLowerCase();
const fee=receipt=>receipt.gasUsed*receipt.effectiveGasPrice;

/** Cost of the accepted action and its exact persisted observation, independently read
 * from canonical receipts. Other failed attempts and hosting bills are separate costs. */
export async function verifiedActionCosts({client,agent,abi,receipt,executed,deploymentBlock,observationHash}){
  const base={executionTransactionGasCostWei:fee(receipt),observationTransactionHash:null,observationGasCostWei:0n};
  const transaction=await client.getTransaction({hash:receipt.transactionHash});
  const unknown={...base,observationGasCostWei:null,gasCostWei:null,operatorGasCostWei:null,costAccounting:'unresolved-batched-execution'};
  if(!same(transaction.to,agent))return unknown;
  let decoded;
  try{decoded=decodeFunctionData({abi,data:transaction.input});}catch{return unknown;}
  if(decoded.functionName!=='execute')return unknown;
  const action=decoded.args[0],event=executed.args;
  if(action.nonce!==event.nonce||action.kind!==event.kind||action.amount!==event.amount||!same(action.beneficiary,event.beneficiary)
    ||action.evidenceHash!==event.evidenceHash)throw new Error('Action calldata differs from the accepted receipt');
  const executionCost=fee(receipt),operatorExecutionCost=same(transaction.from,event.beneficiary)?executionCost:0n;
  if(![2,3].includes(Number(event.kind))){
    if(action.snapshotId!==zeroHash)throw new Error('Non-trade action has an observation');
    return {...base,gasCostWei:executionCost,operatorGasCostWei:operatorExecutionCost,costAccounting:'canonical-action-transactions'};
  }
  if(!same(action.child,event.child)||action.snapshotId===zeroHash)throw new Error('Trade calldata differs from the accepted receipt');
  let hash=observationHash;
  if(!hash){
    // Recovery has no trusted operator result. Locate the event by the snapshot committed
    // in the successful calldata; a random prior observation cannot inflate this action.
    for(let from=BigInt(deploymentBlock);from<=receipt.blockNumber;from+=5000n){
      const events=await client.getContractEvents({address:agent,abi,eventName:'TradeObserved',args:{snapshotId:action.snapshotId},
        fromBlock:from,toBlock:from+4999n>receipt.blockNumber?receipt.blockNumber:from+4999n,strict:true});
      if(events.length>1)throw new Error('Ambiguous canonical trade observation');
      if(events.length){hash=events[0].transactionHash;break;}
    }
  }
  if(!hash)throw new Error('The accepted trade observation could not be recovered');
  const observedReceipt=await client.getTransactionReceipt({hash});
  if(observedReceipt.status!=='success'||observedReceipt.blockNumber>=receipt.blockNumber
    ||(await client.getBlock({blockNumber:observedReceipt.blockNumber})).hash!==observedReceipt.blockHash)
    throw new Error('Trade observation receipt is not canonical');
  const observations=observedReceipt.logs.filter(log=>same(log.address,agent)).map(log=>{
    try{return decodeEventLog({abi,...log});}catch{return null;}
  }).filter(log=>log?.eventName==='TradeObserved'&&log.args.snapshotId===action.snapshotId);
  if(observations.length!==1)throw new Error('Observation receipt does not contain the committed snapshot');
  const observed=observations[0].args;
  if(observed.nonce!==action.nonce||!same(observed.child,action.child)||observed.kind!==action.kind||observed.amount!==action.amount)
    throw new Error('Observation is bound to a different trade');
  const observedTransaction=await client.getTransaction({hash});
  let observedCall;
  try{observedCall=decodeFunctionData({abi,data:observedTransaction.input});}catch{}
  if(!same(observedTransaction.to,agent)||observedCall?.functionName!=='snapshotTrade')
    return {...base,observationTransactionHash:hash,observationGasCostWei:null,gasCostWei:null,operatorGasCostWei:null,costAccounting:'unresolved-batched-observation'};
  const [child,kind,amount]=observedCall.args;
  if(!same(child,action.child)||kind!==action.kind||amount!==action.amount)throw new Error('Observation calldata mismatch');
  const observationCost=fee(observedReceipt);
  return {...base,observationTransactionHash:hash,observationGasCostWei:observationCost,
    gasCostWei:executionCost+observationCost,
    operatorGasCostWei:operatorExecutionCost+(same(observedTransaction.from,event.beneficiary)?observationCost:0n),
    costAccounting:'canonical-action-transactions'};
}
