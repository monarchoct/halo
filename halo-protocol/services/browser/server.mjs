import fs from 'node:fs';
import path from 'node:path';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import { z } from 'zod';
import { keccak256, toHex, verifyMessage } from 'viem';
import { browserFrameMessage, imageDigest, imageInfo } from '../../runtime/browser/frames.mjs';
import { assertSupportedDeployment } from '../../sdk/networks.mjs';

const hash = z.string().regex(/^0x[0-9a-f]{64}$/), address = z.string().regex(/^0x[0-9a-fA-F]{40}$/);
export const frameSchema = z.object({ version: z.literal('halo.browser-frame.v1'), chainId: z.number().int(),
  registry: address, agent: address, operator: address, sessionId: z.string().uuid(), sequence: z.number().int().min(0).max(1000000),
  previousHash: hash, timestamp: z.string().datetime(), source: z.enum(['production-browser', 'development-capture', 'local-browser-worker']),
  siteOrigin: z.string().max(200).refine(value => { try { const url = new URL(value); return url.protocol === 'https:' && url.origin === value && !url.username && !url.password; } catch { return false; } }),
  activity: z.string().min(1).max(240), state: z.enum(['viewing', 'working', 'private', 'needs-account', 'complete', 'error']),
  width: z.number().int().min(0).max(1920), height: z.number().int().min(0).max(1200), mimeType: z.enum(['image/png', 'image/jpeg']).nullable(), imageHash: hash.nullable(),
  surface: z.enum(['browser','desktop']).optional(),
}).strict();
const schema = z.object({ frame: frameSchema, hash, signature: z.string().regex(/^0x[0-9a-fA-F]{130}$/), pngBase64: z.string().max(2800000).optional() }).strict();

export async function createBrowserApi({ client, deployment, artifacts, directory, retentionMs = 86400000, clock = Date.now,
  maxStoredBytes = 120 * 1024 * 1024, allowedOrigins = ['http://localhost:5173', 'http://127.0.0.1:5173'] }) {
  assertSupportedDeployment(deployment);
  if (await client.getChainId() !== deployment.chainId) throw new Error('Browser relay targets another chain');
  fs.mkdirSync(directory, { recursive: true });
  const app = Fastify({ logger: false, bodyLimit: 2900000, requestTimeout: 10000 });
  await app.register(cors, { origin: allowedOrigins });
  const history = [], heads = new Map(), records = new Map(), watchers = new Map();
  let storedBytes = 0;
  const jsonPath = hash => path.join(directory, `${hash.slice(2)}.json`);
  const pngPath = hash => path.join(directory, `${hash.slice(2)}.image`);
  const publicRecord = value => ({ frame: value.frame, hash: value.hash, signature: value.signature });
  const matchesDeployment = frame => frame.chainId === deployment.chainId && frame.registry.toLowerCase() === deployment.registry.toLowerCase()
    && (frame.source === 'production-browser' || deployment.environment === 'local');
  async function signatureValid(record) {
    const message = browserFrameMessage(record.frame);
    return matchesDeployment(record.frame) && keccak256(toHex(message)) === record.hash
      && await verifyMessage({ address: record.frame.operator, message, signature: record.signature });
  }
  function prune() {
    while (history.length && (Date.parse(history[0].frame.timestamp) < clock() - retentionMs || storedBytes > maxStoredBytes)) {
      const old = history.shift(); records.delete(old.hash);
      for (const file of [jsonPath(old.hash), pngPath(old.hash)]) { if (fs.existsSync(file)) { storedBytes -= fs.statSync(file).size; fs.unlinkSync(file); } }
    }
    for (const [id, head] of heads) if (Date.parse(head.frame.timestamp) < clock() - retentionMs) heads.delete(id);
  }
  // Rebuild only from validated, content-bound records. Files are public operator reports, not credentials.
  for (const name of fs.readdirSync(directory).filter(name => /^[a-f0-9]{64}\.json$/.test(name))) {
    try {
      const value = schema.parse(JSON.parse(fs.readFileSync(path.join(directory, name))));
      if (!await signatureValid(value) || name !== `${value.hash.slice(2)}.json`) continue;
      if (value.frame.imageHash && imageDigest(fs.readFileSync(pngPath(value.hash))) !== value.frame.imageHash) continue;
      records.set(value.hash, value); history.push(value);
      const head = heads.get(value.frame.sessionId);
      if (!head || head.frame.sequence < value.frame.sequence) heads.set(value.frame.sessionId, value);
      storedBytes += fs.statSync(jsonPath(value.hash)).size + (value.frame.imageHash ? fs.statSync(pngPath(value.hash)).size : 0);
    } catch { }
  }
  history.sort((a, b) => a.frame.timestamp.localeCompare(b.frame.timestamp) || a.frame.sequence - b.frame.sequence);
  prune();
  const list = agent => history.filter(value => value.frame.agent.toLowerCase() === agent.toLowerCase()).slice(-120);
  app.setErrorHandler((error, _request, reply) => reply.code(error instanceof z.ZodError ? 400 : 503).send({ error: 'Invalid or unavailable browser report' }));
  app.get('/health', () => ({ service: 'halo-browser-relay', storedBytes, liveViewers: [...watchers.values()].reduce((n, set) => n + set.size, 0),
    verification: 'Operator-signed screen reports. No claim of exclusive model control.' }));
  app.get('/v1/agents/:agent/browser', request => { prune(); return { frames: list(address.parse(request.params.agent)) }; });
  app.get('/v1/browser/frames/:hash', (request, reply) => {
    prune();
    const record = records.get(hash.parse(request.params.hash));
    return record ? publicRecord(record) : reply.code(404).send({ error: 'Frame not retained' });
  });
  app.get('/v1/browser/frames/:hash/image', (request, reply) => {
    const id = hash.parse(request.params.hash), record = records.get(id);
    if (!record?.frame.imageHash || Date.parse(record.frame.timestamp) < clock() - retentionMs) return reply.code(404).send({ error: 'Frame expired or private' });
    return reply.header('Content-Type', record.frame.mimeType).header('X-Content-Type-Options', 'nosniff').header('Cache-Control', 'private, max-age=60').send(fs.readFileSync(pngPath(id)));
  });
  // Serialize admission because signatures and RPC checks yield; competing requests cannot replace a head.
  let admission = Promise.resolve();
  app.post('/v1/browser/frames', (request, reply) => {
    const operation = admission.then(async () => {
      const value = schema.parse(request.body), frame = value.frame;
      if (!await signatureValid(value)) return reply.code(400).send({ error: 'Invalid deployment or signature' });
      const existing = records.get(value.hash);
      if (existing) return { accepted: true, duplicate: true };
      if (Math.abs(clock() - Date.parse(frame.timestamp)) > 300000) return reply.code(400).send({ error: 'Stale frame' });
      if (!(await client.readContract({ address: deployment.registry, abi: artifacts.AgentRegistry.abi, functionName: 'isAgent', args: [frame.agent] }))) return reply.code(404).send({ error: 'Unknown agent' });
      const head = heads.get(frame.sessionId);
      if (head ? frame.sequence !== head.frame.sequence + 1 || frame.previousHash !== head.hash
        || frame.operator.toLowerCase() !== head.frame.operator.toLowerCase() || frame.agent.toLowerCase() !== head.frame.agent.toLowerCase()
        : frame.sequence !== 0 || frame.previousHash !== `0x${'0'.repeat(64)}`) return reply.code(409).send({ error: 'Invalid frame chain' });
      if (head && Date.parse(frame.timestamp) < Date.parse(head.frame.timestamp)) return reply.code(400).send({ error: 'Frame time moved backwards' });
      if (history.filter(item => item.frame.operator.toLowerCase() === frame.operator.toLowerCase() && Date.parse(item.frame.timestamp) > clock() - 60000).length >= 120)
        return reply.code(429).send({ error: 'Screen rate limit reached' });
      const privateView = ['private', 'needs-account', 'error'].includes(frame.state);
      let png;
      if (frame.imageHash) {
        if (privateView || !value.pngBase64) return reply.code(400).send({ error: 'Private states must not contain a screen' });
        png = Buffer.from(value.pngBase64, 'base64');
        let info; try { info = imageInfo(png); } catch { return reply.code(400).send({ error: 'Invalid screen format' }); }
        if (png.length > 2000000 || info.mimeType !== frame.mimeType || info.width !== frame.width || info.height !== frame.height
          || frame.width === 0 || frame.height === 0 || imageDigest(png) !== frame.imageHash) return reply.code(400).send({ error: 'Invalid image content binding' });
      } else if (value.pngBase64 || frame.width !== 0 || frame.height !== 0 || frame.mimeType !== null) return reply.code(400).send({ error: 'Uncommitted image' });
      const record = publicRecord(value), encoded = JSON.stringify(record);
      if (png) { fs.writeFileSync(pngPath(value.hash), png); storedBytes += png.length; }
      fs.writeFileSync(jsonPath(value.hash), encoded); storedBytes += Buffer.byteLength(encoded);
      history.push(record); records.set(record.hash, record); heads.set(frame.sessionId, record); prune();
      for (const response of watchers.get(frame.agent.toLowerCase()) ?? []) {
        if (response.writableLength > 128000) response.end(); else response.write(`data: ${encoded}\n\n`);
      }
      return { accepted: true };
    });
    admission = operation.catch(() => {}); return operation;
  });
  app.get('/v1/agents/:agent/browser/stream', (request, reply) => {
    const agent = address.parse(request.params.agent).toLowerCase();
    if ([...watchers.values()].reduce((n, set) => n + set.size, 0) >= 100) return reply.code(503).send({ error: 'Viewer capacity reached' });
    prune(); reply.hijack();
    reply.raw.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive',
      'Access-Control-Allow-Origin': allowedOrigins.includes(request.headers.origin) ? request.headers.origin : allowedOrigins[0] });
    for (const record of list(agent)) reply.raw.write(`data: ${JSON.stringify(record)}\n\n`);
    const set = watchers.get(agent) ?? new Set(); watchers.set(agent, set); set.add(reply.raw);
    const timer = setInterval(() => reply.raw.write(': heartbeat\n\n'), 25000);
    request.raw.on('close', () => { clearInterval(timer); set.delete(reply.raw); if (!set.size) watchers.delete(agent); });
  });
  app.addHook('onClose', async () => { for (const set of watchers.values()) for (const response of set) response.end(); });
  return app;
}
