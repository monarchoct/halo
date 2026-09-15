import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const manifest=JSON.parse(fs.readFileSync(path.join(root,'runtime-source-manifest.json')));
if(manifest.version!==1 || Object.keys(manifest.files).length<20) throw new Error('Missing runtime source manifest');
for(const [name,expected] of Object.entries(manifest.files)) {
  if(!/^[a-zA-Z0-9_./-]+$/.test(name)||name.split('/').includes('..')||path.isAbsolute(name))throw new Error('Invalid source path');
  const file=path.join(root,name);
  if(fs.lstatSync(file).isSymbolicLink())throw new Error('Source symlink is forbidden');
  const data=fs.readFileSync(file);
  if(data.length!==expected.bytes||createHash('sha256').update(data).digest('hex')!==expected.sha256)throw new Error(`Source checksum failed: ${name}`);
}
export const release={version:1,files:Object.keys(manifest.files).length,
  sourceSha256:createHash('sha256').update(fs.readFileSync(path.join(root,'runtime-source-manifest.json'))).digest('hex')};
if(process.argv[1]===fileURLToPath(import.meta.url))console.log(JSON.stringify({status:'verified',...release}));
