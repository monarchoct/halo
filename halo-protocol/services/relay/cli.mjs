#!/usr/bin/env node
/**
 * Production entry for the two live relays (signed operator steps, signed browser frames) in one process.
 *
 *   node services/relay/cli.mjs /config/relays.json
 *
 * With `fanout.connectionEnvironment` set, records are carried between replicas over PostgreSQL LISTEN/NOTIFY so any
 * replica can serve any agent's stream; without it the relay is a single instance. Relays hold no signing keys.
 */
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { createPublicClient, http } from 'viem';
import { assertSupportedDeployment } from '../../sdk/networks.mjs';
import { createTransparencyApi } from '../transparency/server.mjs';
import { createBrowserApi } from '../browser/server.mjs';
import { createFanout, postgresBus } from './fanout.mjs';

if (!process.argv[2]) throw new Error('Usage: node services/relay/cli.mjs /config/relays.json');
const configPath = path.resolve(process.argv[2]), directory = path.dirname(configPath);
const config = z.object({
  deploymentFile: z.string(), host: z.enum(['127.0.0.1', '0.0.0.0']).default('127.0.0.1'),
  transparency: z.object({ port: z.number().int().min(1024).max(65535), directory: z.string() }).strict(),
  browser: z.object({ port: z.number().int().min(1024).max(65535), directory: z.string(), retentionHours: z.number().int().min(1).max(168).default(24), maxStoredMb: z.number().int().min(50).max(5000).default(120) }).strict(),
  allowedOrigins: z.array(z.string().url()).min(1).max(10),
  maxViewers: z.number().int().min(10).max(50000).default(2000),
  fanout: z.object({ connectionEnvironment: z.string().regex(/^[A-Z][A-Z0-9_]*$/), caFile: z.string().optional(), channelPrefix: z.string().regex(/^[a-z_][a-z0-9_]{0,40}$/).default('halo_relay') }).strict().optional(),
}).strict().parse(JSON.parse(fs.readFileSync(configPath, 'utf8')));
const deployment = JSON.parse(fs.readFileSync(path.resolve(directory, config.deploymentFile), 'utf8'));
assertSupportedDeployment(deployment);
if (deployment.environment === 'local' && config.host !== '127.0.0.1') throw new Error('Local relays must remain loopback');
const client = createPublicClient({ transport: http(deployment.rpcUrl, { timeout: 10000, retryCount: 1 }) });
if (await client.getChainId() !== deployment.chainId) throw new Error('Relay RPC targets another chain');
const artifacts = Object.fromEntries(['AgentRegistry', 'AgentVault'].map(name => [name, JSON.parse(fs.readFileSync(new URL(`../../artifacts/${name}.json`, import.meta.url)))]));

let database, buses = [], apps = [];
try {
  const fanouts = {};
  for (const stream of ['steps', 'frames']) {
    let bus;
    if (config.fanout) {
      if (!database) {
        const url = process.env[config.fanout.connectionEnvironment]; delete process.env[config.fanout.connectionEnvironment];
        if (!url) throw new Error('A fan-out database credential is required when fanout is configured');
        const { openDatabase } = await import('../persistence/database.mjs');
        database = openDatabase({ url, local: deployment.environment === 'local', ca: config.fanout.caFile ? fs.readFileSync(path.resolve(directory, config.fanout.caFile), 'utf8') : undefined, maxConnections: 4 });
      }
      bus = await postgresBus({ pool: database.pool, channel: `${config.fanout.channelPrefix}_${stream}` }); buses.push(bus);
    }
    fanouts[stream] = createFanout({ bus, maxViewers: config.maxViewers });
  }
  const transparency = await createTransparencyApi({ client, deployment, artifacts, directory: path.resolve(directory, config.transparency.directory), fanout: fanouts.steps, allowedOrigins: config.allowedOrigins });
  const browser = await createBrowserApi({ client, deployment, artifacts, directory: path.resolve(directory, config.browser.directory), fanout: fanouts.frames, allowedOrigins: config.allowedOrigins,
    retentionMs: config.browser.retentionHours * 3600000, maxStoredBytes: config.browser.maxStoredMb * 1024 * 1024 });
  apps = [transparency, browser];
  await transparency.listen({ host: config.host, port: config.transparency.port });
  await browser.listen({ host: config.host, port: config.browser.port });
  console.log(JSON.stringify({ service: 'halo-relays', chainId: deployment.chainId, transparency: config.transparency.port, browser: config.browser.port, fanout: config.fanout ? 'postgres' : 'single-instance' }));
  await new Promise(resolve => { process.once('SIGINT', resolve); process.once('SIGTERM', resolve); });
} finally {
  for (const app of apps) await app.close().catch(() => {});
  for (const bus of buses) await bus.close().catch(() => {});
  await database?.close().catch(() => {});
}
