import fs from 'node:fs';
import path from 'node:path';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import { z } from 'zod';
import { decodeEventLog, keccak256, toHex, verifyMessage } from 'viem';
import { traceMessage } from '../../runtime/trace.mjs';
import { assertSupportedDeployment } from '../../sdk/networks.mjs';
import { evidenceUri } from '../../sdk/artifacts.mjs';

const address = z.string().regex(/^0x[0-9a-fA-F]{40}$/), hash = z.string().regex(/^0x[0-9a-f]{64}$/);
const schema = z.object({ hash, signature: z.string().regex(/^0x[0-9a-fA-F]{130}$/), step: z.object({
  version: z.literal('halo.step.v1'), chainId: z.number().int(), registry: address, operator: address,
  agent: address, nonce: z.string().regex(/^[0-9]{1,30}$/), runId: z.string().uuid(), index: z.number().int().min(0).max(31), previousHash: hash,
  timestamp: z.string().datetime(), stage: z.enum(['observe', 'research', 'propose', 'prove', 'simulate', 'submit', 'confirm', 'skip', 'error']),
  summary: z.string().min(1).max(2000), evidenceURI: z.string().regex(/^ipfs:\/\/b[a-z2-7]+$/).optional(), transactionHash: hash.optional(),
}).strict() }).strict();

export async function createTransparencyApi({ client, deployment, artifacts, directory,
  allowedOrigins = ['http://localhost:5173', 'http://127.0.0.1:5173'] }) {
  assertSupportedDeployment(deployment);
  if (await client.getChainId() !== deployment.chainId) throw new Error('Transparency RPC targets another chain');
  fs.mkdirSync(directory, { recursive: true });
  const app = Fastify({ logger: false, bodyLimit: 8192, requestTimeout: 10000 });
  await app.register(cors, { origin: allowedOrigins, methods: ['GET', 'POST'] });
  const watchers = new Map(), recent = [], indexed = new Map();
  async function receiptMatches(step) {
    if (!step.transactionHash) return false;
    const receipt = await client.getTransactionReceipt({ hash: step.transactionHash });
    const block = await client.getBlock({ blockNumber: receipt.blockNumber });
    if (block.hash !== receipt.blockHash) return false;
    return receipt.status === 'success' && receipt.logs.some(log => {
      if (log.address.toLowerCase() !== step.agent.toLowerCase()) return false;
      try { const event = decodeEventLog({ abi: artifacts.AgentVault.abi, ...log });
        return event.eventName === 'ActionExecuted' && event.args.nonce === BigInt(step.nonce)
          && event.args.beneficiary.toLowerCase() === step.operator.toLowerCase()
          && step.evidenceURI === evidenceUri(event.args.evidenceHash);
      } catch { return false; }
    });
  }
  // A rebuildable development journal. Production moves this projection to PostgreSQL/outbox.
  for (const filename of fs.readdirSync(directory).filter(name => /^[a-f0-9-]+\.json$/.test(name)).sort()) {
    try { const { verification: _cachedVerification, ...record } = JSON.parse(fs.readFileSync(path.join(directory, filename))); schema.parse(record);
      if (record.hash === keccak256(toHex(traceMessage(record.step))) && await verifyMessage({ address: record.step.operator, message: traceMessage(record.step), signature: record.signature })) {
        record.verification = record.step.stage === 'confirm' && await receiptMatches(record.step) ? 'chain-confirmed' : 'operator-signed';
        indexed.set(`${record.step.runId}-${record.step.index}`, record); recent.push(record);
      }
    } catch { }
  }
  recent.sort((a, b) => a.step.timestamp.localeCompare(b.step.timestamp));
  app.setErrorHandler((error, _request, reply) => reply.code(error instanceof z.ZodError ? 400 : 503).send({ error: 'Invalid or unavailable public step record' }));
  const list = agent => recent.filter(value => value.step.agent.toLowerCase() === agent.toLowerCase()).slice(-100);
  app.get('/health', () => ({ service: 'halo-transparency', authority: 'Operator signatures report progress; receipts establish confirmed execution' }));
  app.get('/v1/agents/:agent/steps', async request => ({ steps: list(address.parse(request.params.agent)) }));
  app.post('/v1/steps', async (request, reply) => {
    const record = schema.parse(request.body), step = record.step;
    if (step.chainId !== deployment.chainId || step.registry.toLowerCase() !== deployment.registry.toLowerCase()) return reply.code(400).send({ error: 'Wrong deployment' });
    const message = traceMessage(step);
    if (keccak256(toHex(message)) !== record.hash || !(await verifyMessage({ address: step.operator, message, signature: record.signature }))) return reply.code(400).send({ error: 'Invalid operator signature' });
    const key = `${step.runId}-${step.index}`, existing = indexed.get(key);
    if (existing) return existing.hash === record.hash ? { accepted: true, duplicate: true } : reply.code(409).send({ error: 'Conflicting signed step' });
    if (Math.abs(Date.now() - Date.parse(step.timestamp)) > 300000) return reply.code(400).send({ error: 'Stale live report' });
    if (!(await client.readContract({ address: deployment.registry, abi: artifacts.AgentRegistry.abi, functionName: 'isAgent', args: [step.agent] }))) return reply.code(404).send({ error: 'Unknown agent' });
    if (step.index === 0) {
      if (step.previousHash !== `0x${'0'.repeat(64)}` || step.stage !== 'observe') return reply.code(400).send({ error: 'Invalid initial step' });
      if (recent.filter(value => value.step.agent.toLowerCase() === step.agent.toLowerCase() && value.step.index === 0 && Date.parse(value.step.timestamp) > Date.now() - 3600000).length >= 50) return reply.code(429).send({ error: 'Agent report rate limit reached' });
    } else {
      const previous = indexed.get(`${step.runId}-${step.index - 1}`);
      if (!previous || previous.hash !== step.previousHash || previous.step.operator.toLowerCase() !== step.operator.toLowerCase()
        || previous.step.agent.toLowerCase() !== step.agent.toLowerCase() || previous.step.nonce !== step.nonce
        || ['confirm', 'error', 'skip'].includes(previous.step.stage)) return reply.code(409).send({ error: 'Invalid step chain' });
    }
    let verification = 'operator-signed';
    if (step.stage === 'confirm') {
      if (!step.transactionHash) return reply.code(400).send({ error: 'Confirmation requires a transaction receipt' });
      const valid = await receiptMatches(step);
      if (!valid) return reply.code(400).send({ error: 'Receipt does not confirm this agent, nonce, operator and evidence' });
      verification = 'chain-confirmed';
    }
    const stored = { ...record, verification };
    fs.writeFileSync(path.join(directory, `${step.runId}-${String(step.index).padStart(2, '0')}.json`), JSON.stringify(stored));
    indexed.set(key, stored); recent.push(stored);
    for (const response of watchers.get(step.agent.toLowerCase()) ?? []) response.write(`data: ${JSON.stringify(stored)}\n\n`);
    return { accepted: true, verification };
  });
  app.get('/v1/agents/:agent/stream', async (request, reply) => {
    const agent = address.parse(request.params.agent).toLowerCase();
    if ([...watchers.values()].reduce((sum, set) => sum + set.size, 0) >= 100) return reply.code(503).send({ error: 'Live viewer capacity reached' });
    reply.hijack();
    const origin = allowedOrigins.includes(request.headers.origin) ? request.headers.origin : allowedOrigins[0];
    reply.raw.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'Access-Control-Allow-Origin': origin });
    for (const record of list(agent)) reply.raw.write(`data: ${JSON.stringify(record)}\n\n`);
    const set = watchers.get(agent) ?? new Set(); watchers.set(agent, set); set.add(reply.raw);
    const timer = setInterval(() => reply.raw.write(': heartbeat\n\n'), 25000);
    request.raw.on('close', () => { clearInterval(timer); set.delete(reply.raw); if (!set.size) watchers.delete(agent); });
  });
  app.addHook('onClose', async () => { for (const set of watchers.values()) for (const response of set) response.end(); });
  return app;
}
