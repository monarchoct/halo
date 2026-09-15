import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createPublicClient,http,parseAbiItem,decodeEventLog} from 'viem';
import {marketHistory,curvePrice,poolPrice} from '../sdk/market-history.mjs';
import {CURVE_SUPPLY} from '../sdk/curve.mjs';
const deployment=JSON.parse(fs.readFileSync(new URL('../../halo-web/public/deployment-trading.json',import.meta.url)));
const artifacts=Object.fromEntries(fs.readdirSync(new URL('../artifacts/',import.meta.url)).filter(n=>n.endsWith('.json')).map(n=>[n.slice(0,-5),JSON.parse(fs.readFileSync(new URL(`../artifacts/${n}`,import.meta.url)))]));
const client=createPublicClient({transport:http(deployment.rpcUrl)});
const token='0xddEA3d67503164326F90F53CFD1705b90Ed1312D';
const options={client,deployment,artifacts};
assert.equal(curvePrice(1000000n*10n**18n,0n,18,18),.0003125);
assert.equal(curvePrice(1000000n*10n**18n,CURVE_SUPPLY,18,18),.005);
assert.equal(poolPrice(2n**97n,true,18,6),4e12);
assert.equal(poolPrice(2n**97n,false,6,18),.25e-12);
assert.throws(()=>curvePrice(1n,-1n,18,18));
const read=marketHistory(options);
const [history,shared]=await Promise.all([read(token),read(token)]);
assert.equal(history,shared,'Concurrent readers share one snapshot');
assert.equal(history.complete,true);assert(history.points.some(p=>p.venue==='pool'&&p.kind==='sell'));
const migration=history.points.findIndex(p=>p.kind==='graduation');
assert(Math.abs(history.points[migration].price/history.points[migration-1].price-1)<1e-12);
const swapAbi=[parseAbiItem('event Swap(bytes32 indexed id,address indexed sender,int128 amount0,int128 amount1,uint160 sqrtPriceX96,uint128 liquidity,int24 tick,uint24 fee)')];
for(const point of history.points.filter(p=>p.venue==='pool'&&p.kind!=='graduation')) {
  const receipt=await client.getTransactionReceipt({hash:point.transactionHash});
  const log=receipt.logs.find(l=>l.logIndex===point.logIndex);
  const {args}=decodeEventLog({abi:swapAbi,data:log.data,topics:log.topics});
  const quoteDelta=BigInt(token)<BigInt(history.quote)?args.amount1:args.amount0;
  assert.equal(point.volume,Math.abs(Number(quoteDelta)/1e18));
  assert.equal(point.kind,(BigInt(token)<BigInt(history.quote)?args.amount0:args.amount1)>0n?'buy':'sell');
}
const curveToken='0x4669E130DF0CB41f351CCd24383E226A5E0846b0';
const curveHistory=await read(curveToken);
const curve=await client.readContract({address:deployment.curveFactory,abi:artifacts.CurveFactory.abi,functionName:'curveOf',args:[curveToken]});
const onchain=await client.readContract({address:curve,abi:artifacts.HaloCurve.abi,functionName:'priceX128',blockNumber:BigInt(curveHistory.observedBlock)});
assert(Math.abs(curveHistory.points.at(-1).price/(Number(onchain)/2**128)-1)<1e-12);
await assert.rejects(marketHistory({...options,maxBlocks:0n})(token),/archival indexer/);
await assert.rejects(marketHistory({...options,maxEvents:1})(token),/archival indexer/);
await assert.rejects(read('0x0000000000000000000000000000000000000001'),/not created/);
let calls=0;
const reorganizing={...client,getBlock:async args=>{const b=await client.getBlock(args);return ++calls>1?{...b,hash:'0x'+'ff'.repeat(32)}:b;}};
await assert.rejects(marketHistory({...options,client:reorganizing})(token),/reorganized/);
const result={checkedAt:new Date().toISOString(),chainId:deployment.chainId,environment:deployment.environment,
  checks:['curve endpoints and decimal scaling','pool quote inversion','concurrent snapshot deduplication','graduation price continuity','canonical pool receipts and volume','curve marginal price matches contract','oversize history fails explicitly','unknown tokens rejected','reorganization rejected'],
  graduatedEvents:history.points.length,curveEvents:curveHistory.points.length,observedBlock:history.observedBlock};
fs.writeFileSync(new URL('../test-results/market-history.json',import.meta.url),JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify(result));
