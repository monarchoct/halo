import { parseAbiItem, formatUnits } from 'viem';
import { chainReader } from './chain-reader.mjs';
import { CURVE_SUPPLY } from './curve.mjs';
import { pickBucket } from './market-candles.mjs';

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

/** Bounded, rebuildable RPC history. Never silently truncate a chart or substitute synthetic prices.
 * `maxEvents` no longer fails the request: it is the size of the raw recent-trade window kept in
 * memory (see the streaming fold in build() below). Everything older is only ever held as a candle. */
export function marketHistory({client, deployment, artifacts, journal, candleCache, maxBlocks=200_000n, maxEvents=500}) {
  const reader = chainReader({client,deployment,artifacts});
  const cache = new Map();
  const pending = new Map();
  const disclosure='Marginal price after each event. Quote volume excludes curve fees; pool volume uses actual swap deltas. Only this HALO curve and its graduated pool are included. Recent blocks may reorganize.';
  async function logs(address,event,args,fromBlock,toBlock) {
    if(journal) return journal({address,event,args,fromBlock,toBlock,strict:true});
    const result=[];
    for(let start=fromBlock;start<=toBlock;start+=2000n) {
      const end=start+1999n>toBlock?toBlock:start+1999n;
      result.push(...await client.getLogs({address,event,args,fromBlock:start,toBlock:end,strict:true}));
    }
    return result;
  }
  async function build(address) {
    const head=await client.getBlock();
    const start=BigInt(deployment.deploymentBlock);
    if(!journal && head.number-start>maxBlocks) throw new Error('History requires the archival indexer');
    const market=await reader.token(address,head.number);
    // The durable candle cache is a pure read-through short-circuit, never a source of truth: it is only
    // ever served when its (block number, block hash) exactly match the current canonical head, so a reorg
    // simply misses (no orphaned data can leak out) and falls through to the full rebuild below, which then
    // overwrites the cache. This avoids re-fetching and re-folding potentially millions of journaled rows on
    // every request for a market that is not currently trading — by far the common case.
    if(candleCache) {
      const cached=await candleCache.read(market.address);
      if(cached && cached.throughBlock===head.number && cached.throughHash===head.hash) {
        return {token:market.address,quote:market.quote,quoteSymbol:market.quoteSymbol,chainId:deployment.chainId,registry:deployment.registry,
          observedBlock:String(head.number),observedAt:Number(head.timestamp)*1000,complete:true,
          points:cached.rawWindow,candles:cached.candles,bucketMs:cached.bucketMs,totalEvents:cached.totalEvents,disclosure};
      }
    }
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
    all.sort(order);
    const timestamps=new Map();
    const blocks=[...new Set(all.map(l=>l.blockNumber))];
    for(let i=0;i<blocks.length;i+=8) await Promise.all(blocks.slice(i,i+8).map(async number=>{
      const block=await client.getBlock({blockNumber:number}); timestamps.set(number,{time:Number(block.timestamp)*1000,hash:block.hash});
    }));
    let sold=0n;
    const baseIsZero=BigInt(market.address)<BigInt(market.quote);
    // A single active market can produce far more than maxEvents trades. Rather than materialize every
    // priced point (the old 5,000-event hard cap) this folds each event, in order, into: (a) a fixed-size
    // circular buffer of the newest `maxEvents` raw points, and (b) an O(1)-per-event OHLCV accumulator
    // that only ever holds the current bucket plus finished candles. Memory is therefore O(candles+maxEvents),
    // never O(totalEvents) — a million-trade token costs the same RAM as a thousand-trade one. The bucket
    // width is auto-picked from the full observed time range so ~300 candles cover the whole history.
    const first=timestamps.get(all[0].blockNumber).time, last=timestamps.get(all.at(-1).blockNumber).time;
    const bucketMs=pickBucket(last-first||1);
    const candles=[];
    let currentCandle=null;
    const window=new Array(maxEvents);
    let windowCount=0;
    for(const log of all) {
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
      const time=timestamps.get(log.blockNumber).time;
      const point={time,price,volume,kind,venue:log.kind==='swap'||log.kind==='graduation'?'pool':'curve',
        transactionHash:log.transactionHash,blockNumber:String(log.blockNumber),logIndex:log.logIndex};
      window[windowCount%maxEvents]=point; windowCount++;
      const bucketTime=Math.floor(time/bucketMs)*bucketMs;
      if(!currentCandle||currentCandle.time!==bucketTime) {
        if(currentCandle) candles.push(currentCandle);
        currentCandle={time:bucketTime,open:price,high:price,low:price,close:price,volume,trades:1};
      } else {
        currentCandle.high=Math.max(currentCandle.high,price); currentCandle.low=Math.min(currentCandle.low,price);
        currentCandle.close=price; currentCandle.volume+=volume; currentCandle.trades++;
      }
    }
    if(currentCandle) candles.push(currentCandle);
    if(sold!==market.sold) throw new Error('Curve history does not match chain state');
    if((await client.getBlock({blockNumber:head.number})).hash!==head.hash) throw new Error('Chain reorganized; retry history');
    const windowSize=Math.min(windowCount,maxEvents);
    const points=Array.from({length:windowSize},(_,i)=>window[(windowCount-windowSize+i)%maxEvents]);
    if(candleCache) await candleCache.write(market.address,{bucketMs,throughBlock:head.number,throughHash:head.hash,totalEvents:all.length,candles,rawWindow:points});
    return {token:market.address,quote:market.quote,quoteSymbol:market.quoteSymbol,chainId:deployment.chainId,registry:deployment.registry,
      observedBlock:String(head.number),observedAt:Number(head.timestamp)*1000,complete:true,points,candles,bucketMs,totalEvents:all.length,disclosure};
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
