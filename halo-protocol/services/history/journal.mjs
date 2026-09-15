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
      const rows=(await db.query('SELECT payload FROM halo_history_logs WHERE stream_id=$1 AND block_number<=$2 ORDER BY block_number,log_index LIMIT $3',[id,String(toBlock),maxEvents+1])).rows;
      if(rows.length>maxEvents)throw busy('Chart history needs aggregated buckets');
      return rows.map(({payload:log})=>({...log,blockNumber:BigInt(log.blockNumber),...decodeEventLog({abi:[event],data:log.data,topics:log.topics,strict:true})}));
    }finally {
      let broken;
      try{if(locked)await db.query('SELECT pg_advisory_unlock($1::bigint)',[lock]);}
      catch(error){broken=error;throw error;}
      finally{db.release(broken);}
    }
  };
}
