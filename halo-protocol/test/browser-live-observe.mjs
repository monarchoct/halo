// Runs HALO's actual browser worker on a public landing page. Never submits an account or post.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { verifyMessage } from 'viem';
import { browserFrameMessage, imageDigest } from '../runtime/browser/frames.mjs';

assert.equal(process.platform, 'linux');
assert.equal(process.getuid(), 1000, 'Use the lab operator account, matching the isolated worker UID');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const image = process.argv[2]; assert.match(image ?? '', /^sha256:[a-f0-9]{64}$/);
const platform = process.argv[3] ?? 'fomo'; assert.ok(['fomo', 'x'].includes(platform));
const forwarding = process.argv.includes('--forward'), failStartup = process.argv.includes('--fail-startup');
const desktop=process.argv.includes('--desktop'); // self-service onboarding is removed: this harness only ever observes
const agent = '0x532323de74BAb864b7005D910E5bD8562D038b9b';
const executionId = randomUUID();
const jobId = createHash('sha256').update(JSON.stringify(['halo.local-observe.v1', 31337, agent.toLowerCase(), platform, executionId])).digest('hex');
const directory = path.join(root, 'test-results', `browser-observe-${executionId}`);
const output = path.join(directory, 'public'); fs.mkdirSync(output, { recursive: true, mode: 0o700 });
const job = { id: jobId, platform, task: 'observe', display:desktop?'desktop':'browser', chainId: 31337, publish: false,
  profileDirectory: '/profile', outputDirectory: '/public', egressProxy: 'http://egress:3128', captureIntervalMs: 3000, maxRunSeconds: 180 };
const jobFile = path.join(directory, 'job.json'); fs.writeFileSync(jobFile, JSON.stringify(job, null, 2), { mode: 0o600 });
const composeDirectory = path.join(root, 'runtime/browser/container');
const project = `halo-observe-${executionId.slice(0, 8)}`, container = `${project}-browser`;
const env = { ...process.env, HALO_BROWSER_IMAGE: image, HALO_BROWSER_JOB_FILE: jobFile, HALO_BROWSER_OUTPUT_DIR: output,
  HALO_BROWSER_PROFILE_VOLUME: `halo-local-nova-${platform}-profile`, HALO_BROWSER_EGRESS_FILE: path.join(composeDirectory, 'egress.example.json') };
const compose = ['compose', '-p', project, '-f', path.join(composeDirectory, 'compose.yaml')];
const preserve = '--preserve-env=HALO_BROWSER_IMAGE,HALO_BROWSER_JOB_FILE,HALO_BROWSER_OUTPUT_DIR,HALO_BROWSER_PROFILE_VOLUME,HALO_BROWSER_EGRESS_FILE';
function docker(args, options = {}) { return spawnSync('sudo', [preserve, 'docker', ...args], { cwd: composeDirectory, env, encoding: 'utf8', timeout: 240_000, maxBuffer: 8 * 1024 ** 2, ...options }); }
let outcome, worker, publisher, publisherDone, publisherFd, delivery, lockProbeExit;
try {
  const egress = docker([...compose, 'up', '-d', '--wait', '--wait-timeout', '40', 'egress']);
  if (egress.status !== 0) throw new Error(egress.stderr);
  if (forwarding) {
    const deploymentFile = path.join(root, 'test-results/browser-trading-deployment.json');
    const deployment = JSON.parse(fs.readFileSync(deploymentFile));
    assert.equal(deployment.environment, 'local'); assert.equal(deployment.chainId, 31337);
    assert.equal(deployment.rpcUrl, 'http://127.0.0.1:8547');
    const rpc = async method => (await (await fetch(deployment.rpcUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params: [] }) })).json()).result;
    assert.equal(await rpc('eth_chainId'), '0x7a69');
    const operatorAddress = (await rpc('eth_accounts'))[4]; assert.match(operatorAddress, /^0x[0-9a-fA-F]{40}$/);
    const forwardingFile = path.join(directory, 'forwarding.json');
    fs.writeFileSync(forwardingFile, JSON.stringify({ deploymentFile, agent, operatorAddress, jobId, platform,
      endpoint: 'http://127.0.0.1:8795', reportDirectory: output, stateFile: path.join(directory, 'operator', 'delivery.json'), maxRunSeconds: 240 }));
    const publisherLog = path.join(directory, 'forwarder.log'); publisherFd = fs.openSync(publisherLog, 'wx', 0o600);
    const args = [path.join(root, 'runtime/browser/run-forwarder.sh'), forwardingFile, '--local-test'];
    const publisherEnv = { ...process.env, PATH: `/home/halo/lab/node/bin:${process.env.PATH}` };
    publisher = spawn('sh', args, { cwd: root, env: publisherEnv, stdio: ['ignore', publisherFd, publisherFd] });
    publisherDone = new Promise((resolve, reject) => { publisher.once('error', reject); publisher.once('close', code => resolve(code)); });
    const readyBy = Date.now() + 10000;
    while (!fs.readFileSync(publisherLog, 'utf8').includes('halo-browser-forwarder')) {
      assert.equal(publisher.exitCode, null, 'Publisher exited before acquiring its execution journal');
      assert.ok(Date.now() < readyBy, 'Publisher did not become ready');
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    const competing = spawnSync('sh', args, { cwd: root, env: publisherEnv, encoding: 'utf8', timeout: 10000 });
    lockProbeExit = competing.status; assert.equal(lockProbeExit, 75, 'A second writer was not excluded by the real Linux flock');
  }
  const fd = fs.openSync(path.join(directory, 'worker.log'), 'wx', 0o600);
  try { worker = docker([...compose, 'run', '-T', '--no-deps', '--name', container, '-e', 'DEBUG=pw:browser',
    ...(failStartup ? ['-e', 'PLAYWRIGHT_BROWSERS_PATH=/unavailable-browser-fixture'] : []), 'browser'], { stdio: ['ignore', fd, fd] }); }
  finally { fs.closeSync(fd); }
  if (fs.existsSync(path.join(output, 'result.json'))) outcome = JSON.parse(fs.readFileSync(path.join(output, 'result.json')));
  if (publisher) {
    const timer = setTimeout(() => publisher.kill('SIGTERM'), 15000);
    const exitCode = await publisherDone; clearTimeout(timer);
    assert.equal(exitCode, 0, 'Publisher did not acknowledge the worker outcome');
    const journal = JSON.parse(fs.readFileSync(path.join(directory, 'operator', 'delivery.json')));
    const frames = (await (await fetch(`http://127.0.0.1:8795/v1/agents/${agent}/browser`)).json()).frames
      .filter(record => record.frame.sessionId === journal.sessionId);
    assert.equal(frames.length, outcome.reportCount); let imageCount = 0;
    for (const record of frames) {
      assert.equal(record.frame.source, 'local-browser-worker');
      assert.equal(await verifyMessage({ address: record.frame.operator, message: browserFrameMessage(record.frame), signature: record.signature }), true);
      if (record.frame.imageHash) {
        const bytes = Buffer.from(await (await fetch(`http://127.0.0.1:8795/v1/browser/frames/${record.hash}/image`)).arrayBuffer());
        assert.equal(imageDigest(bytes), record.frame.imageHash); imageCount++;
      }
    }
    delivery = { sessionId: journal.sessionId, publisherExitCode: exitCode, frameCount: frames.length, imageCount, frames };
  }
  const inspect = docker(['inspect', container]);
  if (inspect.status === 0) {
    const c = JSON.parse(inspect.stdout)[0];
    fs.writeFileSync(path.join(directory, 'container.json'), JSON.stringify({ image: c.Image, user: c.Config.User, state: c.State,
      readOnly: c.HostConfig.ReadonlyRootfs, capDrop: c.HostConfig.CapDrop, networks: Object.keys(c.NetworkSettings.Networks) }, null, 2));
  }
} finally {
  if (publisher?.exitCode === null) { publisher.kill('SIGTERM'); await publisherDone; }
  if (publisherFd !== undefined) fs.closeSync(publisherFd);
  docker(['rm', '-f', container]);
  docker([...compose, 'down', '--remove-orphans']);
  // This agent-specific profile is intentionally retained for subsequent observation.
}
const evidence = { checkedAt: new Date().toISOString(), jobId, executionId, platform, agent, image,
  operatorTriggered: true, scope: 'Actual isolated local worker; public observation only, no account creation or posting',
  display:desktop?'desktop':'browser',
  outputDirectory: output, workerExitCode: worker?.status, outcome, failStartup, lockProbeExit, delivery,
  reportFiles: fs.readdirSync(output).filter(file => /^\d{6}\.json$/.test(file)),
  imageFiles: fs.readdirSync(output).filter(file => /^\d{6}\.(jpg|png)$/.test(file)) };
fs.writeFileSync(path.join(directory, 'acceptance.json'), JSON.stringify(evidence, null, 2));
fs.writeFileSync(path.join(root, 'test-results', `latest-${platform}-observation.json`), JSON.stringify({ directory, jobId, executionId }, null, 2));
console.log(JSON.stringify(evidence, null, 2));
if (failStartup) {
  assert.equal(worker?.status, 1); assert.equal(outcome?.result.status, 'failed'); assert.equal(outcome?.result.stage, 'startup');
  assert.equal(outcome.reportCount, 2); assert.equal(evidence.imageFiles.length, 0);
} else if (worker?.status !== 0 || outcome?.result.status !== 'observed') process.exitCode = 1;
