import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';

assert.equal(process.platform, 'linux');
assert.equal(process.getuid(), 0, 'Run this isolated Docker acceptance harness with sudo; the browser itself stays UID 1000');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const image = process.argv[2];
assert.match(image ?? '', /^sha256:[a-f0-9]{64}$/);
const suffix = randomBytes(6).toString('hex');
const project = `halo-boundary-${suffix}`, name = `${project}-probe`;
const directory = path.join(root, 'test-results', project), output = path.join(directory, 'public');
fs.mkdirSync(output, { recursive: true, mode: 0o700 }); fs.chownSync(output, 1000, 1000);
const jobFile = path.join(directory, 'job.json');
fs.writeFileSync(jobFile, JSON.stringify({ task: 'container-boundary-probe-only' }), { mode: 0o600 }); fs.chownSync(jobFile, 1000, 1000);
const composeDirectory = path.join(root, 'runtime/browser/container');
const env = { ...process.env, HALO_BROWSER_IMAGE: image, HALO_BROWSER_JOB_FILE: jobFile, HALO_BROWSER_OUTPUT_DIR: output,
  HALO_BROWSER_PROFILE_VOLUME: `${project}-profile`, HALO_BROWSER_EGRESS_FILE: path.join(composeDirectory, 'egress.example.json') };
function docker(args, input, allowFailure = false) {
  const result = spawnSync('docker', args, { cwd: composeDirectory, env, input, encoding: 'utf8', timeout: 90_000, maxBuffer: 2 * 1024 ** 2 });
  if (!allowFailure && result.status !== 0) throw new Error(`Docker acceptance command failed: ${result.stderr || result.error?.message || result.stdout}`);
  return result;
}
const compose = ['compose', '-p', project, '-f', path.join(composeDirectory, 'compose.yaml')];
let inspected;
try {
  docker([...compose, 'up', '-d', '--wait', '--wait-timeout', '40', 'egress']);
  const result = docker([...compose, 'run', '-T', '--no-deps', '--name', name, 'browser', 'node', '--input-type=module', '--eval', fs.readFileSync(path.join(root, 'test/browser-container-probe.mjs'), 'utf8')]);
  const probe = JSON.parse(result.stdout.trim());
  const record = JSON.parse(docker(['inspect', name]).stdout)[0];
  assert.equal(record.Image, image);
  assert.equal(record.HostConfig.ReadonlyRootfs, true);
  assert.deepEqual(record.HostConfig.CapDrop, ['ALL']);
  const networks = Object.keys(record.NetworkSettings.Networks);
  assert.deepEqual(networks, [`${project}_browser_only`]);
  assert.equal(JSON.parse(docker(['network', 'inspect', networks[0]]).stdout)[0].Internal, true);
  const egressId = docker([...compose, 'ps', '-q', 'egress']).stdout.trim();
  const egress = JSON.parse(docker(['inspect', egressId]).stdout)[0];
  assert.equal(egress.Mounts.some(mount => mount.Destination === '/profile' || mount.Destination === '/public'), false);
  inspected = { checkedAt: new Date().toISOString(), status: 'passed', image, scope: probe.scope, passed: [...probe.passed,
    'Inspected image, read-only root and internal-only browser network match the actual compose deployment',
    'Egress container has neither private browser profile nor public report mounts'],
    host: { platform: process.platform, node: process.version }, project,
    sourceSha256: Object.fromEntries(['test/browser-container.mjs', 'test/browser-container-probe.mjs', 'runtime/browser/container/compose.yaml',
      'runtime/browser/container/seccomp.json', 'runtime/browser/container/egress.example.json'].map(file => [file, createHash('sha256').update(fs.readFileSync(path.join(root, file))).digest('hex')])) };
} finally {
  docker(['rm', '-f', name], undefined, true);
  docker([...compose, 'down', '--remove-orphans'], undefined, true);
  // Unique disposable probe volume only; never a production agent profile.
  docker(['volume', 'rm', `${project}-profile`], undefined, true);
}
docker(['image', 'inspect', image]);
assert.match(docker(['inspect', name], undefined, true).stderr, /No such (object|container)/i);
assert.match(docker(['network', 'inspect', `${project}_browser_only`], undefined, true).stderr, /not found|No such network/i);
assert.match(docker(['volume', 'inspect', `${project}-profile`], undefined, true).stderr, /No such volume/i);
inspected.passed.push('Disposable probe container, internal network and test profile volume are removed after execution');
fs.writeFileSync(path.join(root, 'test-results/browser-container.json'), JSON.stringify(inspected, null, 2));
console.log(`PASS ${inspected.passed.length} actual Linux browser-container boundaries; no browser UI or social posts`);
