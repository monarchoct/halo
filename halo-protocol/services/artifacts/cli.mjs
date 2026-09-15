#!/usr/bin/env node
/**
 * Production entry for the public artifact service: accepts agent manifests (POST /v1/manifests), replicates them to at
 * least three IPFS peers, and serves them back by content id (GET /ipfs/:cid) with integrity checks.
 *
 *   node services/artifacts/cli.mjs /config/artifacts.json
 *
 * Peers are reached exactly like the operator reaches them (loopback or public HTTPS with a bearer token); the service
 * holds no keys and never exposes a peer's administrative RPC.
 */
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { assertSupportedDeployment } from '../../sdk/networks.mjs';
import { replicatedArtifacts, kuboReplica } from '../../sdk/artifacts.mjs';
import { createArtifactApi } from './server.mjs';

if (!process.argv[2]) throw new Error('Usage: node services/artifacts/cli.mjs /config/artifacts.json');
const configPath = path.resolve(process.argv[2]), directory = path.dirname(configPath);
const config = z.object({
  deploymentFile: z.string(), host: z.enum(['127.0.0.1', '0.0.0.0']).default('127.0.0.1'),
  port: z.number().int().min(1024).max(65535).default(8790),
  origin: z.string().url(),
  allowedOrigins: z.array(z.string().url()).min(1).max(10),
  ipfsPeers: z.array(z.object({ apiUrl: z.string().url(), authorizationEnvironment: z.string().regex(/^[A-Z][A-Z0-9_]*$/).optional() }).strict()).min(3).max(8),
}).strict().parse(JSON.parse(fs.readFileSync(configPath, 'utf8')));
const deployment = JSON.parse(fs.readFileSync(path.resolve(directory, config.deploymentFile), 'utf8'));
assertSupportedDeployment(deployment);
if (deployment.environment === 'local') throw new Error('Use scripts/dev-artifacts.mjs for the disposable local deployment');
const store = replicatedArtifacts({ replicas: config.ipfsPeers.map(peer => {
  const authorization = peer.authorizationEnvironment ? process.env[peer.authorizationEnvironment] : undefined;
  if (peer.authorizationEnvironment && !authorization) throw new Error('Configured IPFS authorization is unavailable');
  return kuboReplica({ apiUrl: peer.apiUrl, authorization });
}) });
for (const name of config.ipfsPeers.map(peer => peer.authorizationEnvironment).filter(Boolean)) delete process.env[name];
const app = await createArtifactApi({ store, deployment, origin: config.origin, allowedOrigins: config.allowedOrigins });
await app.listen({ host: config.host, port: config.port });
console.log(JSON.stringify({ service: 'halo-public-artifacts', chainId: deployment.chainId, port: config.port, peers: config.ipfsPeers.length }));
await new Promise(resolve => { process.once('SIGINT', resolve); process.once('SIGTERM', resolve); });
await app.close();
