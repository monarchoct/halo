import fs from 'node:fs';
import path from 'node:path';
import { createPublicClient, createWalletClient, http } from 'viem';
import { root } from './compile.mjs';
import { createBrowserPublisher, imageInfo } from '../runtime/browser/frames.mjs';
const deployment = JSON.parse(fs.readFileSync(path.join(root, '../halo-web/public/deployment.json')));
if (deployment.environment !== 'local' || deployment.chainId !== 31337 || deployment.rpcUrl !== 'http://127.0.0.1:8545') throw new Error('Disposable local chain required');
const agent = process.argv[2], imageFile = process.argv[3], origin = process.argv[4];
if (!/^0x[0-9a-fA-F]{40}$/.test(agent ?? '') || !imageFile || !origin) throw new Error('Usage: node scripts/dev-browser-capture.mjs AGENT PUBLIC_PNG HTTPS_ORIGIN');
const png = fs.readFileSync(path.resolve(imageFile));
const info = imageInfo(png);
const client = createPublicClient({ transport: http(deployment.rpcUrl) });
if (await client.getChainId() !== 31337) throw new Error('Chain mismatch');
const wallet = createWalletClient({ transport: http(deployment.rpcUrl) }), account = (await wallet.getAddresses())[4];
const publish = createBrowserPublisher({ wallet, account, deployment, agent, endpoint: 'http://127.0.0.1:8792',
  localOrigins: ['http://127.0.0.1:8792'], source: 'development-capture' });
const record = await publish({ png, width: info.width, height: info.height, siteOrigin: origin,
  activity: 'Viewing FOMO’s public website. Development capture; no social account has been created.', state: 'complete' });
fs.writeFileSync(path.join(root, 'test-results/browser-capture.json'), JSON.stringify({ ...record, pngBase64: undefined }, null, 2));
console.log(JSON.stringify({ status: 'published-local-capture', frame: record.hash, operator: account }));
