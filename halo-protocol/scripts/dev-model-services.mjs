import fs from 'node:fs';
import path from 'node:path';
import { createPublicClient, http } from 'viem';
import { root } from './compile.mjs';
import { kuboReplica, replicatedArtifacts } from '../sdk/artifacts.mjs';
import { createArtifactApi } from '../services/artifacts/server.mjs';
import { createTransparencyApi } from '../services/transparency/server.mjs';
const file = path.join(root, '../halo-web/public/deployment-trading.json');
const deployment = JSON.parse(fs.readFileSync(file));
if (deployment.environment !== 'local' || deployment.chainId !== 31337 || deployment.rpcUrl !== 'http://127.0.0.1:8547') throw new Error('This helper only extends the existing disposable trading preview');
const client = createPublicClient({ transport: http(deployment.rpcUrl) });
if (await client.getChainId() !== 31337) throw new Error('Local chain mismatch');
const peers = JSON.parse(fs.readFileSync(path.join(root, 'test-results/local-ipfs.json'))).peers;
const store = replicatedArtifacts({ replicas: peers.map(apiUrl => kuboReplica({ apiUrl })) });
const artifacts = Object.fromEntries(fs.readdirSync(path.join(root, 'artifacts')).filter(name => name.endsWith('.json')).map(name => [name.slice(0, -5), JSON.parse(fs.readFileSync(path.join(root, 'artifacts', name)))]));
const artifactApiUrl = 'http://127.0.0.1:8793', transparencyApiUrl = 'http://127.0.0.1:8794';
const api = await createArtifactApi({ store, deployment, origin: artifactApiUrl });
const trace = await createTransparencyApi({ client, deployment, artifacts, directory: path.join(root, 'test-results/model-public-steps') });
try {
  await api.listen({ host: '127.0.0.1', port: 8793 });
  await trace.listen({ host: '127.0.0.1', port: 8794 });
  fs.writeFileSync(file, JSON.stringify({ ...deployment, artifactApiUrl, transparencyApiUrl }, null, 2) + '\n');
  // Artifact publication is chain/core scoped, not registry scoped. Keep creation's model options
  // usable on the existing local previews without restarting their chains or IPFS processes.
  for (const name of ['deployment.json', 'deployment-settlement.json']) {
    const existingFile = path.join(root, '../halo-web/public', name);
    const existing = JSON.parse(fs.readFileSync(existingFile));
    if (existing.environment === 'local' && existing.chainId === deployment.chainId && existing.coreReleaseSha256 === deployment.coreReleaseSha256)
      fs.writeFileSync(existingFile, JSON.stringify({ ...existing, artifactApiUrl }, null, 2) + '\n');
  }
  console.log('Model preview artifacts :8793 and signed activity :8794; existing chain and history preserved.');
  await new Promise(resolve => { process.once('SIGINT', resolve); process.once('SIGTERM', resolve); });
} finally { await api.close(); await trace.close(); }
