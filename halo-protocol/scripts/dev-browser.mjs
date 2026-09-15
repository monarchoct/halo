import fs from 'node:fs';
import path from 'node:path';
import { createPublicClient, http } from 'viem';
import { root } from './compile.mjs';
import { createBrowserApi } from '../services/browser/server.mjs';
const trading = process.argv.includes('--trading');
const port = trading ? 8795 : 8792;
const deploymentPath = path.join(root, `../halo-web/public/deployment${trading ? '-trading' : ''}.json`);
const deployment = JSON.parse(fs.readFileSync(deploymentPath));
if (deployment.environment !== 'local' || deployment.rpcUrl !== `http://127.0.0.1:${trading ? 8547 : 8545}`) throw new Error('Disposable local deployment required');
const artifacts = { AgentRegistry: JSON.parse(fs.readFileSync(path.join(root, 'artifacts/AgentRegistry.json'))) };
const app = await createBrowserApi({ client: createPublicClient({ transport: http(deployment.rpcUrl) }), deployment, artifacts,
  directory: path.join(root, `test-results/browser-frames${trading ? '-trading' : ''}`) });
await app.listen({ host: '127.0.0.1', port });
fs.writeFileSync(deploymentPath, JSON.stringify({ ...deployment, browserApiUrl: `http://127.0.0.1:${port}` }, null, 2));
console.log(`Operator-signed browser relay ready · http://127.0.0.1:${port} · local only`);
await new Promise(resolve => { process.once('SIGINT', resolve); process.once('SIGTERM', resolve); });
await app.close();
