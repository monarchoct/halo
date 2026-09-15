import {createHash} from 'node:crypto';
import {decodeEventLog} from 'viem';

const stringify=value=>JSON.stringify(value,(_,v)=>typeof v==='bigint'?v.toString():v);
const busy=message=>Object.assign(new Error(message),{statusCode:503});

/** Incremental, restart-safe log acquisition with canonical checkpoint rollback.
 * The caller supplies a fixed deployment identity and a trusted RPC. No signing.
 */
export function createLogJournal({database,client,identity,chunkSize=2000n,maxChunks=25,maxEvents=5000}) {
  if(!identity||chunkSize<1n||chunkSize>2000n||!Number.isInteger(maxChunks)||maxChunks<1||maxChunks>100) throw new Error('Invalid history configuration');
  return async function getLogs({address,event,args,fromBlock,toBlock,strict=true}) {
    if(typeof fromBlock!=='bigint'||typeof toBlock!=='bigint'||fromBlock<0n||toBlock<fromBlock||!strict) throw new Error('History needs an explicit strict block range');
    const specification={identity,address,event,args:args??null,fromBlock:String(fromBlock)};
    const id=createHash('sha256').update(stringify(specification)).digest('hex');
    const lock=BigInt.asIntN(64,BigInt('0x'+id.slice(0,16))).toString();
    const db=await database.pool.connect();let locked=false;
    try {
      locked=(await db.query('SELECT pg_try_advisory_lock($1::bigint) AS locked',[lock])).rows[0].locked;
      if(!locked) throw busy('History synchronization already in progress');
      await db.query('INSERT INTO halo_history_streams(id,specification,start_block) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',[id,JSON.parse(stringify(specification)),String(fromBlock)]);
      // Newest-first anchors also recover deeper reorganizations. RPC failures abort:
      // they must never be interpreted as proof that old blocks disappeared.
      let canonical=fromBlock-1n,newest=null,before='9223372036854775807',found=false;
      const liveHead=await client.getBlockNumber({cacheTime:0});
      if(toBlock>liveHead) throw busy('Requested history snapshot is ahead of the chain');
      while(!found) {
        const anchors=(await db.query('SELECT block_number,block_hash FROM halo_history_checkpoints WHERE stream_id=$1 AND block_number<$2 ORDER BY block_number DESC LIMIT 32',[id,before])).rows;
        if(!anchors.length)break;
        newest??=BigInt(anchors[0].block_number);
        for(const anchor of anchors) {
          const n=BigInt(anchor.block_number);
          if(n>liveHead)continue;
          const block=await client.getBlock({blockNumber:n});
          if(block.hash===anchor.block_hash){canonical=n;found=true;break;}
        }
        before=anchors.at(-1).block_number;
      }
      if(newest!==null&&canonical!==newest) {
        await db.query('BEGIN');
        try {
          await db.query('DELETE FROM halo_history_logs WHERE stream_id=$1 AND block_number>$2',[id,String(canonical)]);
          await db.query('DELETE FROM halo_history_checkpoints WHERE stream_id=$1 AND block_number>$2',[id,String(canonical)]);
          await db.query('COMMIT');
        } catch(error){await db.query('ROLLBACK');throw error;}
      }
      let chunks=0;
      while(canonical<toBlock) {
        if(chunks++>=maxChunks)throw busy('History backfill is progressing; retry this snapshot');
        const start=canonical+1n,end=start+chunkSize-1n>toBlock?toBlock:start+chunkSize-1n;
        const anchor=await client.getBlock({blockNumber:end});
        const logs=await client.getLogs({address,event,args,fromBlock:start,toBlock:end,strict:true});
        if(logs.length>maxEvents)throw busy('History chunk requires a smaller indexing interval');
        const seen=new Set();
        for(const log of logs) {
          if(log.removed||log.blockNumber<start||log.blockNumber>end||!Number.isInteger(log.logIndex)||log.logIndex<0)throw busy('Invalid history log');
          const key=`${log.blockNumber}:${log.logIndex}`;
          if(seen.has(key))throw busy('Duplicate history log');seen.add(key);
        }
        const blocks=new Map();
        for(const n of new Set(logs.map(log=>log.blockNumber))) blocks.set(n,(await client.getBlock({blockNumber:n})).hash);
        if(logs.some(log=>blocks.get(log.blockNumber)!==log.blockHash))throw busy('History reorganized during acquisition');
        // Verify both the preceding and completing boundary before committing.
        if(canonical>=fromBlock) {
          const saved=(await db.query('SELECT block_hash FROM halo_history_checkpoints WHERE stream_id=$1 AND block_number=$2',[id,String(canonical)])).rows[0];
          if((await client.getBlock({blockNumber:canonical})).hash!==saved.block_hash)throw busy('History reorganized at checkpoint');
        }
        if((await client.getBlock({blockNumber:end})).hash!==anchor.hash)throw busy('History reorganized at batch end');
        await db.query('BEGIN');
        try {
          // One parameterized batch preserves block/log ordering without an N-query insert loop.
          const rows=logs.map(({args:_args,...log})=>({block_number:String(log.blockNumber),log_index:log.logIndex,payload:JSON.parse(stringify(log))}));
          if(rows.length)await db.query(`INSERT INTO halo_history_logs(stream_id,block_number,log_index,payload)
            SELECT $1,x.block_number,x.log_index,x.payload FROM jsonb_to_recordset($2::jsonb) AS x(block_number bigint,log_index integer,payload jsonb)`,[id,JSON.stringify(rows)]);
          await db.query('INSERT INTO halo_history_checkpoints(stream_id,block_number,block_hash) VALUES($1,$2,$3)',[id,String(end),anchor.hash]);
          // Keep the newest anchor in each block window. Frequent refreshes replace
          // an intermediate tip instead of creating one permanent row per viewer tick.
          // Raw events are retained; a fork can replay from the previous window.
          await db.query('DELETE FROM halo_history_checkpoints WHERE stream_id=$1 AND block_number>=$2 AND block_number<$3',[id,String(end/chunkSize*chunkSize),String(end)]);
          await db.query('COMMIT');canonical=end;
        }catch(error){await db.query('ROLLBACK');throw error;}
      }
      // No row cap here: a hot market can journal far more than maxEvents rows, and the caller (market-history.mjs)
      // folds them through a bounded streaming aggregator instead of holding every priced point in memory. The
      // per-chunk cap above still guards against one pathological 2,000-block window returning unbounded logs.
      const rows=(await db.query('SELECT payload FROM halo_history_logs WHERE stream_id=$1 AND block_number<=$2 ORDER BY block_number,log_index',[id,String(toBlock)])).rows;
      return rows.map(({payload:log})=>({...log,blockNumber:BigInt(log.blockNumber),...decodeEventLog({abi:[event],data:log.data,topics:log.topics,strict:true})}));
    }finally {
      let broken;
      try{if(locked)await db.query('SELECT pg_advisory_unlock($1::bigint)',[lock]);}
      catch(error){broken=error;throw error;}
      finally{db.release(broken);}
    }
  };
}

/** Durable read-through cache of a market's full-history candles plus its newest raw-trade window,
 * keyed by the same (identity, market) hash scheme as a log stream so it shares halo_history_streams.
 * This is a cache, not a second source of truth: sdk/market-history.mjs only ever serves a cached
 * entry when its (block number, block hash) exactly match the current chain head, so a reorganized
 * or stale entry is simply a cache miss — the caller rebuilds from halo_history_logs (see getLogs
 * above) and overwrites this cache with the freshly verified result. That miss-and-overwrite is what
 * keeps this table "incrementally maintained" without needing its own orphan-suffix bookkeeping: a
 * market that is not currently trading serves entirely from these few rows, no journal re-read at all. */
export function createCandleCache({database,identity}) {
  const streamId=token=>createHash('sha256').update(stringify({identity,candles:token.toLowerCase()})).digest('hex');
  return {
    async read(token) {
      const id=streamId(token);
      const state=(await database.pool.query(
        'SELECT bucket_ms,through_block,through_hash,total_events,raw_window FROM halo_history_candle_state WHERE stream_id=$1',[id])).rows[0];
      if(!state) return null;
      const rows=(await database.pool.query(
        'SELECT bucket_time,open,high,low,close,volume,trades FROM halo_history_candles WHERE stream_id=$1 ORDER BY bucket_time',[id])).rows;
      return {bucketMs:state.bucket_ms,throughBlock:BigInt(state.through_block),throughHash:state.through_hash,
        totalEvents:state.total_events,rawWindow:state.raw_window,
        candles:rows.map(r=>({time:Number(r.bucket_time),open:r.open,high:r.high,low:r.low,close:r.close,volume:r.volume,trades:r.trades}))};
    },
    async write(token,{bucketMs,throughBlock,throughHash,totalEvents,candles,rawWindow}) {
      const id=streamId(token);
      const db=await database.pool.connect();
      try {
        await db.query('BEGIN');
        await db.query('INSERT INTO halo_history_streams(id,specification,start_block) VALUES($1,$2,0) ON CONFLICT DO NOTHING',
          [id,{identity,candles:token.toLowerCase()}]);
        // Whole-series overwrite, not a row-level upsert: candles are cheap to regenerate (a few hundred rows)
        // and this guarantees a reorg can never leave a stale bucket behind, unlike an incremental append would.
        await db.query('DELETE FROM halo_history_candles WHERE stream_id=$1',[id]);
        if(candles.length) {
          const rows=candles.map(c=>({bucket_time:c.time,open:c.open,high:c.high,low:c.low,close:c.close,volume:c.volume,trades:c.trades}));
          await db.query(`INSERT INTO halo_history_candles(stream_id,bucket_ms,bucket_time,open,high,low,close,volume,trades)
            SELECT $1,$2,x.bucket_time,x.open,x.high,x.low,x.close,x.volume,x.trades FROM jsonb_to_recordset($3::jsonb)
            AS x(bucket_time bigint,open double precision,high double precision,low double precision,close double precision,volume double precision,trades integer)`,
            [id,bucketMs,JSON.stringify(rows)]);
        }
        await db.query(`INSERT INTO halo_history_candle_state(stream_id,bucket_ms,through_block,through_hash,total_events,raw_window)
          VALUES($1,$2,$3,$4,$5,$6)
          ON CONFLICT(stream_id) DO UPDATE SET bucket_ms=$2,through_block=$3,through_hash=$4,total_events=$5,raw_window=$6`,
          [id,bucketMs,String(throughBlock),throughHash,totalEvents,rawWindow]);
        await db.query('COMMIT');
      } catch(error){await db.query('ROLLBACK');throw error;}
      finally{db.release();}
    },
  };
}
