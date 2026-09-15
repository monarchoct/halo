import Fastify from 'fastify';
import cors from '@fastify/cors';
import { z } from 'zod';
import { chainReader, jsonSafe } from '../../sdk/chain-reader.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { keccak256, toHex } from 'viem';
import { agentManifestSchema, canonicalJson } from '../../sdk/manifest.mjs';
import { marketHistory } from '../../sdk/market-history.mjs';
import { aggregate, pickBucket, coarsen } from '../../sdk/market-candles.mjs';
import { nativePurchaseQuote } from '../../sdk/native-quote.mjs';

const address = z.string().regex(/^0x[0-9a-fA-F]{40}$/);
const BUCKET_NAMES = { '1m': 60e3, '5m': 300e3, '15m': 900e3, '1h': 3600e3, '4h': 14400e3, '1d': 86400e3 };
const RAW_POINT_LIMIT = 500;

/** Builds the response candle series for a /history request, never throwing regardless of history size.
 * When the requested bucket is at or above the reader's own auto-picked bucket, the reader's full-history
 * candles are coarsened (exact, no precision loss). A finer request can only be honored for the time span
 * still covered by the raw point window, since older trades were never kept individually (see market-history.mjs). */
function resolveCandles({ points, candles, bucketMs: readerBucketMs }, { bucket, from, to }) {
  const earliest = candles[0]?.time ?? points[0]?.time;
  const latest = candles.at(-1)?.time ?? points.at(-1)?.time ?? Date.now();
  const rangeMs = (to ?? latest) - (from ?? earliest ?? latest);
  const requestedBucketMs = bucket && bucket !== 'auto' ? BUCKET_NAMES[bucket] : pickBucket(rangeMs);
  let series, bucketMs;
  if (requestedBucketMs >= readerBucketMs) { series = coarsen(candles, requestedBucketMs); bucketMs = requestedBucketMs; }
  else { series = aggregate(points, requestedBucketMs, { fill: true }); bucketMs = requestedBucketMs; }
  if (from !== undefined) series = series.filter(c => c.time >= Math.floor(from / bucketMs) * bucketMs);
  if (to !== undefined) series = series.filter(c => c.time <= to);
  return { candles: series, bucketMs };
}

const cursorCodec = {
  encode: ({ blockNumber, logIndex }) => Buffer.from(`${blockNumber}.${logIndex}`).toString('base64url'),
  decode(value) {
    let text;
    try { text = Buffer.from(value, 'base64url').toString('utf8'); } catch { throw new Error('Malformed cursor'); }
    const match = /^(\d+)\.(\d+)$/.exec(text);
    if (!match) throw new Error('Malformed cursor');
    return { blockNumber: BigInt(match[1]), logIndex: Number(match[2]) };
  },
};

export async function createApi({ client, deployment, artifacts, artifactDirectory, historyJournal, historyCandleCache, allowedOrigins = ['http://localhost:5173', 'http://127.0.0.1:5173'] }) {
  const app = Fastify({ logger: false, bodyLimit: 64 * 1024, requestTimeout: 15_000 });
  const reader = chainReader({ client, deployment, artifacts });
  const history = marketHistory({ client, deployment, artifacts, journal: historyJournal, candleCache: historyCandleCache, maxEvents: RAW_POINT_LIMIT });
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
  // Network-wide feed of proven actions, newest first. Bounded to the first `agents` registered agents so one request
  // cannot fan out without limit; a failed per-agent read is reported as partial rather than silently dropped.
  app.get('/v1/activity', async request => {
    const query = z.object({ limit: z.coerce.number().int().min(1).max(200).default(100),
      agents: z.coerce.number().int().min(1).max(50).default(20) }).strict().parse(request.query);
    const { agents, total } = await reader.agents({ offset: 0, limit: Math.min(query.agents, 20) });
    const settled = await Promise.allSettled(agents.map(async agent => (await reader.actions(agent.address)).actions
      .map(action => ({ ...action, agent: { address: agent.address, name: agent.name, symbol: agent.symbol, agentToken: agent.agentToken },
        child: action.child, childMarket: agent.children.find(child => child.address.toLowerCase() === String(action.child).toLowerCase()) ?? null }))));
    const activity = settled.flatMap(result => result.status === 'fulfilled' ? result.value : [])
      .sort((a, b) => Number(BigInt(b.blockNumber) - BigInt(a.blockNumber)) || Number(BigInt(b.nonce) - BigInt(a.nonce))).slice(0, query.limit);
    return jsonSafe({ version: 'halo.activity.v1', activity, agentsScanned: agents.length, agentsTotal: total,
      partial: settled.some(result => result.status === 'rejected') });
  });
  app.get('/v1/tokens/:address', async request => jsonSafe(await reader.token(address.parse(request.params.address))));
  app.get('/v1/tokens/:address/history', async request => {
    const query = z.object({ bucket: z.enum(['1m', '5m', '15m', '1h', '4h', '1d', 'auto']).default('auto'),
      from: z.coerce.number().int().min(0).optional(), to: z.coerce.number().int().min(0).optional() }).strict().parse(request.query);
    const snapshot = await history(address.parse(request.params.address));
    const { candles, bucketMs } = resolveCandles(snapshot, query);
    const points = query.from === undefined && query.to === undefined ? snapshot.points
      : snapshot.points.filter(p => (query.from === undefined || p.time >= query.from) && (query.to === undefined || p.time <= query.to));
    const { candles: _candles, bucketMs: _bucketMs, totalEvents, ...rest } = snapshot;
    return jsonSafe({ ...rest, points, candles, bucketMs, truncated: totalEvents > snapshot.points.length });
  });
  app.get('/v1/tokens/:address/trades', async (request, reply) => {
    const query = z.object({ limit: z.coerce.number().int().min(1).max(200).default(50), cursor: z.string().optional() }).strict().parse(request.query);
    let after;
    if (query.cursor !== undefined) {
      try { after = cursorCodec.decode(query.cursor); } catch { return reply.code(400).send({ error: 'Malformed cursor' }); }
    }
    const { points } = await history(address.parse(request.params.address));
    // points is ascending (blockNumber,logIndex); trades are served newest-first via the same keyset.
    const descending = [...points].reverse();
    let startIndex = 0;
    if (after !== undefined) {
      startIndex = descending.findIndex(p => BigInt(p.blockNumber) < after.blockNumber || (BigInt(p.blockNumber) === after.blockNumber && p.logIndex < after.logIndex));
      if (startIndex === -1) return { trades: [], nextCursor: null };
    }
    const page = descending.slice(startIndex, startIndex + query.limit);
    const nextCursor = page.length && startIndex + page.length < descending.length
      ? cursorCodec.encode({ blockNumber: page.at(-1).blockNumber, logIndex: page.at(-1).logIndex }) : null;
    return jsonSafe({ trades: page, nextCursor });
  });
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
