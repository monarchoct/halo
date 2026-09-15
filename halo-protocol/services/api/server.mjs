import Fastify from 'fastify';
import cors from '@fastify/cors';
import { z } from 'zod';
import { chainReader, jsonSafe } from '../../sdk/chain-reader.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { keccak256, toHex } from 'viem';
import { agentManifestSchema, canonicalJson } from '../../sdk/manifest.mjs';
import { marketHistory } from '../../sdk/market-history.mjs';
import { nativePurchaseQuote } from '../../sdk/native-quote.mjs';

const address = z.string().regex(/^0x[0-9a-fA-F]{40}$/);

export async function createApi({ client, deployment, artifacts, artifactDirectory, historyJournal, allowedOrigins = ['http://localhost:5173', 'http://127.0.0.1:5173'] }) {
  const app = Fastify({ logger: false, bodyLimit: 64 * 1024, requestTimeout: 15_000 });
  const reader = chainReader({ client, deployment, artifacts });
  const history = marketHistory({ client, deployment, artifacts, journal: historyJournal });
  const localArtifacts = deployment.environment === 'local' && artifactDirectory;
  await app.register(cors, { origin: allowedOrigins, methods: localArtifacts ? ['GET', 'POST'] : ['GET'], credentials: false });
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof z.ZodError) return reply.code(400).send({ error: 'Invalid request', issues: error.issues });
    const code = error.statusCode && error.statusCode >= 400 && error.statusCode < 500 ? error.statusCode : 503;
    reply.code(code).send({ error: code === 404 ? error.message : 'Chain data is temporarily unavailable. Retry or use another RPC provider.' });
  });
  app.get('/health', async () => ({ service: 'halo-public-api', version: '1', authority: 'No transaction signing or agent execution authority', localArtifactUpload: !!localArtifacts }));
  // Local development content store. Public releases must use the independent content replication service.
  if (localArtifacts) {
    fs.mkdirSync(artifactDirectory, { recursive: true });
    app.post('/v1/manifests', async (request, reply) => {
      const manifest = agentManifestSchema.parse(request.body);
      if (manifest.chainId !== deployment.chainId || manifest.models.releaseSha256 !== deployment.coreReleaseSha256) {
        return reply.code(400).send({ error: 'Manifest targets a different chain or decision release' });
      }
      const content = canonicalJson(manifest);
      const hash = keccak256(toHex(content));
      fs.writeFileSync(path.join(artifactDirectory, `${hash}.json`), content, { flag: 'w' });
      return { hash, uri: `${deployment.apiUrl}/artifacts/${hash}.json`, replicatedCopies: 1, environment: 'local' };
    });
    app.get('/artifacts/:hash', async (request, reply) => {
      const hash = z.string().regex(/^0x[0-9a-f]{64}\.json$/).parse(request.params.hash);
      const filename = path.join(artifactDirectory, hash);
      if (!fs.existsSync(filename)) return reply.code(404).send({ error: 'Artifact not found' });
      const content = fs.readFileSync(filename, 'utf8');
      if (`${keccak256(toHex(content))}.json` !== hash) return reply.code(503).send({ error: 'Artifact failed its integrity check' });
      return reply.type('application/json').header('Cache-Control', 'public, max-age=31536000, immutable').send(content);
    });
  }
  app.get('/v1/status', async () => jsonSafe(await reader.status()));
  app.get('/v1/agents', async request => {
    const pagination = z.object({ offset: z.coerce.number().int().min(0).max(1_000_000).default(0),
      limit: z.coerce.number().int().min(1).max(20).default(20) }).parse(request.query);
    return jsonSafe(await reader.agents(pagination));
  });
  app.get('/v1/agents/:address', async request => jsonSafe(await reader.agent(address.parse(request.params.address))));
  app.get('/v1/agents/:address/actions', async request => jsonSafe(await reader.actions(address.parse(request.params.address))));
  app.get('/v1/tokens/:address', async request => jsonSafe(await reader.token(address.parse(request.params.address))));
  app.get('/v1/tokens/:address/history', async request => history(address.parse(request.params.address)));
  let nativeQuotes = 0;
  app.get('/v1/tokens/:address/native-quote', async (request, reply) => {
    const token = address.parse(request.params.address);
    const query = z.object({ buyer: address, amount: z.string().regex(/^[1-9][0-9]{0,38}$/),
      slippageBps: z.coerce.number().int().min(1).max(2000).default(100) }).strict().parse(request.query);
    reply.header('Cache-Control', 'no-store');
    if (!deployment.nativeBuyRouter) return reply.code(503).send({ error: 'Native purchase routing is not configured for this deployment.' });
    if (nativeQuotes >= 4) return reply.code(429).send({ error: 'Quote service busy. Retry shortly.' });
    nativeQuotes++;
    try { return await nativePurchaseQuote({ client, deployment, artifacts, token, ...query }); }
    finally { nativeQuotes--; }
  });
  return app;
}
