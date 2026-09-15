import fs from 'node:fs';
import path from 'node:path';
import { createPublicClient, http } from 'viem';
import { root } from './compile.mjs';
import { createTransparencyApi } from '../services/transparency/server.mjs';
const deploymentPath = path.join(root, '../halo-web/public/deployment.json');
const deployment = JSON.parse(fs.readFileSync(deploymentPath));
if (deployment.environment !== 'local' || deployment.rpcUrl !== 'http://127.0.0.1:8545') throw new Error('Local helper requires the disposable chain');
const artifacts = Object.fromEntries(fs.readdirSync(path.join(root, 'artifacts')).filter(name => name.endsWith('.json')).map(name => [name.slice(0, -5), JSON.parse(fs.readFileSync(path.join(root, 'artifacts', name)))]));
const api = await createTransparencyApi({ client: createPublicClient({ transport: http(deployment.rpcUrl) }), deployment, artifacts,
  directory: path.join(root, 'test-results/public-steps') });
await api.listen({ host: '127.0.0.1', port: 8791 });
fs.writeFileSync(deploymentPath, JSON.stringify({ ...deployment, transparencyApiUrl: 'http://127.0.0.1:8791' }, null, 2));
console.log('Signed public activity stream ready · http://127.0.0.1:8791');
await new Promise(resolve => { process.once('SIGINT', resolve); process.once('SIGTERM', resolve); });
await api.close();
