import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createPublicClient, http } from 'viem';
import { root } from '../scripts/compile.mjs';
import { createBrowserApi } from '../services/browser/server.mjs';

const trading = process.argv.includes('--trading');
const deploymentFile = path.join(root, `test-results/${trading ? 'browser-trading-deployment' : 'local-deployment'}.json`);
const deployment = JSON.parse(fs.readFileSync(deploymentFile));
assert.equal(deployment.environment, 'local');
assert.equal(deployment.rpcUrl, `http://127.0.0.1:${trading ? 8547 : 8545}`);
const agent = trading ? '0x532323de74BAb864b7005D910E5bD8562D038b9b' : JSON.parse(fs.readFileSync(path.join(root, 'test-results/last-local-operator.json'))).agent;
const directory = path.join(root, 'test-results/browser-cli', randomUUID());
const reports = path.join(directory, 'public'), privateState = path.join(directory, 'private');
fs.mkdirSync(reports, { recursive: true }); fs.mkdirSync(privateState);
const jobId = '6'.repeat(64);
const app = await createBrowserApi({ client: createPublicClient({ transport: http(deployment.rpcUrl) }), deployment,
  artifacts: { AgentRegistry: JSON.parse(fs.readFileSync(path.join(root, 'artifacts/AgentRegistry.json'))) }, directory: path.join(directory, 'relay') });
await app.listen({ host: '127.0.0.1', port: 0 });
const configFile = path.join(directory, 'forwarding.json');
const localAccounts = await createPublicClient({ transport: http(deployment.rpcUrl) }).request({ method: 'eth_accounts' });
const config = { deploymentFile, agent,
  operatorAddress: deployment.demoOperator ?? localAccounts[4], jobId, platform: 'fomo', endpoint: `http://127.0.0.1:${app.server.address().port}`,
  reportDirectory: reports, stateFile: path.join(privateState, 'delivery.json') };
fs.writeFileSync(configFile, JSON.stringify(config));
const report = { version: 'halo.browser-report.v1', jobId, sequence: 0, timestamp: new Date().toISOString(), siteOrigin: 'https://fomo.family',
  activity: 'CLI delivery fixture. No browser session or social account is involved.', state: 'private', width: 0, height: 0 };
fs.writeFileSync(path.join(reports, '000000.json'), JSON.stringify(report));
fs.writeFileSync(path.join(reports, 'result.json'), JSON.stringify({ version: 'halo.browser-result.v1', jobId, reportCount: 1, result: { status: 'fixture-complete' } }));
async function run(args = ['--once', '--local-test']) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['runtime/browser/forward-cli.mjs', configFile, ...args], { cwd: root, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    const timer = setTimeout(() => { child.kill(); reject(new Error('Forwarder CLI test deadline')); }, 10000);
    child.stdout.on('data', bytes => stdout += bytes); child.stderr.on('data', bytes => stderr += bytes);
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.on('close', code => { clearTimeout(timer); resolve({ code, stdout, stderr }); });
  });
}
const passed = [];
// This mode lets an execution host run the exact CLI itself when nested child
// creation is unavailable. It serves only the disposable fixture on loopback.
if (process.argv.includes('--serve')) {
  fs.writeFileSync(path.join(root, 'test-results/browser-cli-fixture.json'), JSON.stringify({ configFile, reports, endpoint: config.endpoint, agent }));
  console.log(JSON.stringify({ status: 'fixture-ready', configFile, endpoint: config.endpoint }));
  await new Promise(resolve => { process.once('SIGINT', resolve); process.once('SIGTERM', resolve); });
  await app.close();
} else {
try {
  let result = await run();
  assert.equal(result.code, 0, result.stderr); assert.match(result.stdout, /delivery-complete/);
  let history = (await app.inject({ url: `/v1/agents/${agent}/browser` })).json().frames;
  assert.equal(history.length, 1); assert.equal(history[0].frame.source, 'local-browser-worker'); assert.equal(history[0].frame.imageHash, null);
  passed.push('CLI signs through disposable RPC and delivers over actual loopback HTTP');
  result = await run(); assert.equal(result.code, 0, result.stderr); assert.match(result.stdout, /delivery-complete/);
  history = (await app.inject({ url: `/v1/agents/${agent}/browser` })).json().frames;
  assert.equal(history.length, 1);
  passed.push('CLI restart resumes its durable cursor without duplicate frames');
  result = await run(['--once']); assert.notEqual(result.code, 0); assert.match(result.stderr, /explicit disposable-chain switch/);
  passed.push('Local RPC delivery requires the explicit disposable-chain argument');
  fs.writeFileSync(path.join(reports, '000001.json'), JSON.stringify({ ...report, jobId: '7'.repeat(64), sequence: 1 }));
  result = await run(); assert.equal(result.code, 1); assert.match(result.stdout, /delivery-incomplete/);
  assert.equal((await app.inject({ url: `/v1/agents/${agent}/browser` })).json().frames.length, 1);
  passed.push('Invalid pending reports produce a nonzero exit instead of silent success');
  const keyPath = path.join(reports, 'must-not-be-read.key'); fs.writeFileSync(keyPath, 'not-a-real-key');
  fs.writeFileSync(configFile, JSON.stringify({ ...config, operatorKeyFile: keyPath }));
  result = await run(); assert.notEqual(result.code, 0); assert.match(result.stderr, /must never contain the operator key/); assert.doesNotMatch(result.stderr, /not-a-real-key/);
  passed.push('Signing credentials inside the public browser mount are rejected before reading');
} finally { await app.close(); }
fs.writeFileSync(path.join(root, 'test-results/browser-forwarder-cli.json'), JSON.stringify({ checkedAt: new Date().toISOString(), scope: 'Local HTTP and disposable RPC; no browser or external social execution', passed }, null, 2));
console.log(`PASS ${passed.length} browser forwarder CLI scenarios; no social posts or financial transactions`);
}
