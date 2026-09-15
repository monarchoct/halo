import fs from 'node:fs';
import path from 'node:path';
import { root } from './compile.mjs';
import { startLocalIpfs } from '../test/ipfs-helpers.mjs';
import { replicatedArtifacts } from '../sdk/artifacts.mjs';
import { createArtifactApi } from '../services/artifacts/server.mjs';

const deployment = JSON.parse(fs.readFileSync(path.join(root, 'test-results/local-deployment.json')));
if (deployment.environment !== 'local' || deployment.chainId !== 31337) throw new Error('This helper only serves the local development deployment');
const ipfs = await startLocalIpfs();
let api;
try {
  const store = replicatedArtifacts({ replicas: ipfs.replicas });
  const artifactApiUrl = 'http://127.0.0.1:8790';
  api = await createArtifactApi({ store, deployment, origin: artifactApiUrl });
  await api.listen({ host: '127.0.0.1', port: 8790 });
  const publicDeployment = path.join(root, '../halo-web/public/deployment.json');
  fs.writeFileSync(publicDeployment, JSON.stringify({ ...deployment, artifactApiUrl }, null, 2) + '\n');
  fs.writeFileSync(path.join(root, 'test-results/local-ipfs.json'), JSON.stringify({ apiUrl: artifactApiUrl, peers: ipfs.endpoints,
    disclosure: 'Three separate real IPFS peers on one machine, running offline. No independent host or public pinning is claimed.' }, null, 2));
  console.log('Artifact publication ready: three local IPFS peers · http://127.0.0.1:8790');
  await new Promise(resolve => { process.once('SIGINT', resolve); process.once('SIGTERM', resolve); });
} finally { if (api) await api.close(); await ipfs.stop(); }
