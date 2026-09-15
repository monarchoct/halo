import { parseAbiItem, formatUnits } from 'viem';
import { chainReader } from './chain-reader.mjs';
import { CURVE_SUPPLY } from './curve.mjs';

const bought = parseAbiItem('event Bought(address indexed payer,address indexed recipient,uint256 tokens,uint256 quoteSpent,uint256 fee)');
const soldEvent = parseAbiItem('event Sold(address indexed payer,address indexed recipient,uint256 tokens,uint256 quoteReceived,uint256 fee)');
const graduated = parseAbiItem('event PoolGraduated(address indexed curve,address indexed vault,bytes32 indexed poolId,uint160 sqrtPriceX96,uint128 liquidity)');
const swap = parseAbiItem('event Swap(bytes32 indexed id,address indexed sender,int128 amount0,int128 amount1,uint160 sqrtPriceX96,uint128 liquidity,int24 tick,uint24 fee)');
const launched = parseAbiItem('event TokenLaunched(address indexed token,address indexed curve,address indexed parent,address deployer,address operations,address splitter,uint256 target,string metadataURI)');
const order = (a,b) => a.blockNumber < b.blockNumber ? -1 : a.blockNumber > b.blockNumber ? 1 : a.logIndex-b.logIndex;
const units = (value, decimals) => Number(formatUnits(value, decimals));
export function curvePrice(target, sold, baseDecimals, quoteDecimals) {
  if(sold < 0n || sold > CURVE_SUPPLY) throw new Error('Incomplete curve event history');
  const denominator = 4n*CURVE_SUPPLY-3n*sold;
  return Number(4n*target*CURVE_SUPPLY)/Number(denominator*denominator)*10**(baseDecimals-quoteDecimals);
}
export function poolPrice(sqrtPriceX96, baseIsZero, baseDecimals, quoteDecimals) {
  const ratio = (Number(sqrtPriceX96)/2**96)**2;
  return (baseIsZero ? ratio : 1/ratio)*10**(baseDecimals-quoteDecimals);
}

/** Bounded, rebuildable RPC history. Never silently truncate a chart or substitute synthetic prices. */
export function marketHistory({client, deployment, artifacts, journal, maxBlocks=200_000n, maxEvents=5_000}) {
  const reader = chainReader({client,deployment,artifacts});
  const cache = new Map();
  const pending = new Map();
  async function logs(address,event,args,fromBlock,toBlock) {
    if(journal) return journal({address,event,args,fromBlock,toBlock,strict:true});
    const result=[];
    for(let start=fromBlock;start<=toBlock;start+=2000n) {
      const end=start+1999n>toBlock?toBlock:start+1999n;
      result.push(...await client.getLogs({address,event,args,fromBlock:start,toBlock:end,strict:true}));
      if(result.length>maxEvents) throw new Error('History requires the archival indexer');
    }
    return result;
  }
  async function build(address) {
    const head=await client.getBlock();
    const start=BigInt(deployment.deploymentBlock);
    if(!journal && head.number-start>maxBlocks) throw new Error('History requires the archival indexer');
    const market=await reader.token(address,head.number);
    const [births,buys,sells]=await Promise.all([
      logs(deployment.curveFactory,launched,{token:market.address},start,head.number),
      logs(market.curve,bought,undefined,start,head.number),
      logs(market.curve,soldEvent,undefined,start,head.number),
    ]);
    if(births.length!==1) throw new Error('Missing canonical token launch');
    const all=[{...births[0],kind:'launch'},...buys.map(l=>({...l,kind:'buy'})),...sells.map(l=>({...l,kind:'sell'}))];
    if(market.graduated) {
      const adapter=await client.readContract({address:market.curve,abi:artifacts.HaloCurve.abi,functionName:'graduationAdapter',blockNumber:head.number});
      const migrations=await logs(adapter,graduated,{curve:market.curve},start,head.number);
      if(migrations.length!==1) throw new Error('Missing canonical pool graduation');
      const manager=await client.readContract({address:adapter,abi:artifacts.V4GraduationAdapter.abi,functionName:'manager',blockNumber:head.number});
      all.push({...migrations[0],kind:'graduation'});
      all.push(...(await logs(manager,swap,{id:migrations[0].args.poolId},migrations[0].blockNumber,head.number)).map(l=>({...l,kind:'swap'})));
    }
    if(all.length>maxEvents) throw new Error('History requires the archival indexer');
    all.sort(order);
    const timestamps=new Map();
    const blocks=[...new Set(all.map(l=>l.blockNumber))];
    for(let i=0;i<blocks.length;i+=8) await Promise.all(blocks.slice(i,i+8).map(async number=>{
      const block=await client.getBlock({blockNumber:number}); timestamps.set(number,{time:Number(block.timestamp)*1000,hash:block.hash});
    }));
    let sold=0n;
    const baseIsZero=BigInt(market.address)<BigInt(market.quote);
    const points=all.map(log=>{
      if(log.removed || timestamps.get(log.blockNumber).hash!==log.blockHash) throw new Error('Chain reorganized; retry history');
      let volume=0,kind=log.kind,price;
      if(kind==='buy') { sold+=log.args.tokens; volume=units(log.args.quoteSpent-log.args.fee,market.quoteDecimals); }
      if(kind==='sell') { sold-=log.args.tokens; volume=units(log.args.quoteReceived+log.args.fee,market.quoteDecimals); }
      if(kind==='swap') {
        const quoteDelta=baseIsZero?log.args.amount1:log.args.amount0;
        const baseDelta=baseIsZero?log.args.amount0:log.args.amount1;
        volume=Math.abs(units(quoteDelta,market.quoteDecimals));
        kind=baseDelta>0n?'buy':'sell';
      }
      price=log.kind==='swap'||log.kind==='graduation'
        ?poolPrice(log.args.sqrtPriceX96,baseIsZero,market.decimals,market.quoteDecimals)
        :curvePrice(market.target,sold,market.decimals,market.quoteDecimals);
      if(!Number.isFinite(price)||price<=0||!Number.isFinite(volume)) throw new Error('Unrepresentable market value');
      return {time:timestamps.get(log.blockNumber).time,price,volume,kind,venue:log.kind==='swap'||log.kind==='graduation'?'pool':'curve',
        transactionHash:log.transactionHash,blockNumber:String(log.blockNumber),logIndex:log.logIndex};
    });
    if(sold!==market.sold) throw new Error('Curve history does not match chain state');
    if((await client.getBlock({blockNumber:head.number})).hash!==head.hash) throw new Error('Chain reorganized; retry history');
    return {token:market.address,quote:market.quote,quoteSymbol:market.quoteSymbol,chainId:deployment.chainId,registry:deployment.registry,
      observedBlock:String(head.number),observedAt:Number(head.timestamp)*1000,complete:true,points,
      disclosure:'Marginal price after each event. Quote volume excludes curve fees; pool volume uses actual swap deltas. Only this HALO curve and its graduated pool are included. Recent blocks may reorganize.'};
  }
  return async address=>{
    const key=address.toLowerCase(),existing=cache.get(key);
    if(existing && Date.now()-existing.at<15000) return existing.data;
    if(pending.has(key)) return pending.get(key);
    if(pending.size>=4) throw Object.assign(new Error('History service busy'),{statusCode:429});
    const job=build(address).then(data=>{ if(cache.size>=100) cache.delete(cache.keys().next().value);cache.set(key,{at:Date.now(),data});return data; }).finally(()=>pending.delete(key));
    pending.set(key,job);return job;
  };
}
