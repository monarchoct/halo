import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createContainerRunner, profileIdentity } from '../runtime/browser/container-runner.mjs';
const exec = promisify(execFile), root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const image = process.argv[2]; assert.match(image ?? '', /^sha256:[a-f0-9]{64}$/);
const stateDirectory = '/home/halo/lab/social-runtime';
const deploymentFile = path.join(root, 'test-results/browser-trading-deployment.json');
const deployment = JSON.parse(fs.readFileSync(deploymentFile)); assert.equal(deployment.chainId, 31337);
const agent = '0x532323de74BAb864b7005D910E5bD8562D038b9b';
const runner = createContainerRunner({ image, stateDirectory, deploymentFile,
  egressFile: path.join(root, 'runtime/browser/container/egress.example.json'), endpoint: 'http://127.0.0.1:8795',
  operatorAddress: '0x15d34aaf54267db7d7c367839aaf71a00a2c6a65', localTest: true, sudoDocker: true, maxRunSeconds: 60 });
const id = randomBytes(32).toString('hex'), abort = new AbortController(); let timer, entered = false;
try {
  await assert.rejects(runner({ id, chainId: 31337, task: 'observe', platform: 'fomo', publish: false }, {
    agent, signal: abort.signal, async beforeStart() { entered = true; timer = setTimeout(() => abort.abort(), 1500); }, async verifyReceipt() {},
  }), /interrupted/);
} finally { clearTimeout(timer); }
assert.equal(entered, true);
const executions = path.join(stateDirectory, 'executions');
const execution = fs.readdirSync(executions).find(name => {
  try { return JSON.parse(fs.readFileSync(path.join(executions, name, 'job.json'))).id === id; } catch { return false; }
});
assert.ok(execution);
const outcome = JSON.parse(fs.readFileSync(path.join(executions, execution, 'outcome.json')));
assert.equal(outcome.containersCleaned, true);
const identity = profileIdentity(deployment, agent, 'fomo');
const project = `halo-social-${identity.slice(0,24)}`;
const containers = await exec('sudo', ['-n','docker','ps','-aq','--filter',`label=com.docker.compose.project=${project}`]);
const networks = await exec('sudo', ['-n','docker','network','ls','-q','--filter',`label=com.docker.compose.project=${project}`]);
assert.equal(containers.stdout.trim(), ''); assert.equal(networks.stdout.trim(), '');
const volume = await exec('sudo', ['-n','docker','volume','inspect','--format','{{.Name}}',`halo-social-${identity}-profile`]);
assert.equal(volume.stdout.trim(), `halo-social-${identity}-profile`);
const lock = await exec('flock', ['--exclusive','--nonblock','--conflict-exit-code','75',path.join(stateDirectory,'profiles',`${identity}.lock`),'true']);
assert.equal(lock.stderr, '');
fs.writeFileSync(path.join(root,'test-results/browser-runner-lifecycle.json'),JSON.stringify({ checkedAt:new Date().toISOString(),image,
  scope:'Actual Linux process interruption after start authorization; public observation only, no account creation or post',
  executionId:execution, browserResult:outcome.result, containersCleaned:true, networksCleaned:true, profilePreserved:true, lockReleased:true,
  reportsDelivered:outcome.reportsDelivered, passed:['Cancellation terminates the trusted executor and removes browser/proxy containers and networks','Private profile survives and the real profile lock is released'],
},null,2));
console.log('PASS actual runner interruption, container/network cleanup, private-profile retention and lock release');
