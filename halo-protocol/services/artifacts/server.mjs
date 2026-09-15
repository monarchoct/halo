import Fastify from 'fastify';
import cors from '@fastify/cors';
import { z } from 'zod';
import { agentManifestSchema } from '../../sdk/manifest.mjs';
import { parseRawCid } from '../../sdk/artifacts.mjs';

export async function createArtifactApi({ store, deployment, origin, allowedOrigins = ['http://localhost:5173', 'http://127.0.0.1:5173'] }) {
  const app = Fastify({ logger: false, bodyLimit: 65536, requestTimeout: 15000 });
  await app.register(cors, { origin: allowedOrigins, methods: ['GET', 'POST'], credentials: false });
  app.setErrorHandler((error, _request, reply) => reply.code(error instanceof z.ZodError ? 400 : 503).send({ error: error instanceof z.ZodError ? 'Invalid manifest' : 'Required artifact replicas are unavailable' }));
  app.get('/health', () => ({ service: 'halo-public-artifacts', network: deployment.environment, storage: 'IPFS raw blocks', privateKeys: false }));
  app.post('/v1/manifests', async (request, reply) => {
    const manifest = agentManifestSchema.parse(request.body);
    if (manifest.chainId !== deployment.chainId || manifest.models.releaseSha256 !== deployment.coreReleaseSha256) return reply.code(400).send({ error: 'Manifest targets a different chain or core release' });
    const result = await store.put(manifest);
    return { ...result, replicatedCopies: result.replicas.length, retrievalUrl: `${origin}/ipfs/${result.cid}` };
  });
  app.get('/ipfs/:cid', async (request, reply) => {
    const cid = parseRawCid(z.string().max(100).parse(request.params.cid));
    const bytes = await store.get(`ipfs://${cid}`);
    return reply.type('application/json').header('X-Content-Type-Options', 'nosniff').header('Cache-Control', 'public, max-age=31536000, immutable').send(bytes);
  });
  return app;
}
