import fs from 'node:fs';
import path from 'node:path';
import { root } from './compile.mjs';

// Only public ABI data crosses into the browser bundle; proving material and keys do not.
const target = path.resolve(root, '../halo-web/lib/generated');
fs.mkdirSync(target, { recursive: true });
for (const name of ['AgentRegistry', 'AgentVault', 'CurveFactory', 'HaloCurve', 'HaloToken', 'FeeSplitter', 'AgentFeeTreasury', 'NativeBuyRouter']) {
  const artifact = JSON.parse(fs.readFileSync(path.join(root, 'artifacts', `${name}.json`)));
  fs.writeFileSync(path.join(target, `${name}.json`), JSON.stringify(artifact.abi) + '\n');
}
console.log('Exported public contract ABIs to HALO web');
