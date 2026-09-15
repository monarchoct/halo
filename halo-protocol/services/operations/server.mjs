import Fastify from 'fastify';
import cors from '@fastify/cors';
import {z} from 'zod';
import {createOperationsReader} from './reader.mjs';

export async function createOperationsApi({database,client,deployment,artifacts,allowedOrigins=['http://localhost:5173','http://127.0.0.1:5173']}) {
  const reader=await createOperationsReader({database,deployment});
  const app=Fastify({logger:false,bodyLimit:1024,requestTimeout:15000});
  await app.register(cors,{origin:allowedOrigins,methods:['GET'],credentials:false});
  app.addHook('onSend',async(_request,reply,payload)=>{reply.header('Cache-Control','no-store');return payload;});
  app.setErrorHandler((error,_request,reply)=>reply.code(error instanceof z.ZodError?400:503).send({error:error instanceof z.ZodError?'Invalid operations request':'Operator status is temporarily unavailable.'}));
  app.get('/health',async()=>{await database.pool.query('SELECT 1');return {service:'halo-public-operations',version:1,authority:'Read-only public projections; no execution or account authority'};});
  let inFlight=0;
  app.get('/v1/agents/:agent/operations',async(request,reply)=>{
    const agent=z.string().regex(/^0x[0-9a-fA-F]{40}$/).parse(request.params.agent).toLowerCase();
    const {limit}=z.object({limit:z.coerce.number().int().min(1).max(20).default(20)}).strict().parse(request.query);
    if(inFlight>=8)return reply.code(429).send({error:'Operator status is busy. Retry shortly.'});
    inFlight++;
    try{
      const [chainId,registered]=await Promise.all([client.getChainId(),client.readContract({address:deployment.registry,abi:artifacts.AgentRegistry.abi,functionName:'isAgent',args:[agent]})]);
      if(chainId!==deployment.chainId)throw new Error('Wrong RPC chain');
      if(!registered)return reply.code(404).send({error:'Agent is not registered in this deployment.'});
      return await reader.agent(agent,{limit});
    }finally{inFlight--;}
  });
  return app;
}
