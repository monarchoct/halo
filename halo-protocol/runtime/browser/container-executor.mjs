import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { containerRunnerSchema } from './container-runner.mjs';
import { readPublicFile } from './forwarder.mjs';

// Run only under the profile flock acquired by container-runner. No arbitrary
// model strings become commands, mount paths, image choices or Docker options.
if (process.platform !== 'linux' || process.getuid() !== 1000) throw new Error('Linux operator UID required');
const config = containerRunnerSchema.extend({ version: z.literal('halo.container-execution.v1'), executionId: z.string().uuid(),
  execution: z.string(), jobFile: z.string(), output: z.string(), forwardingFile: z.string(),
  project: z.string().regex(/^halo-social-[a-f0-9]{24}$/), profileVolume: z.string().regex(/^halo-social-[a-f0-9]{64}-profile$/),
}).parse(JSON.parse(fs.readFileSync(process.argv[2])));
const directory = path.dirname(fileURLToPath(import.meta.url)), composeDirectory = path.join(directory, 'container');
const container = `${config.project}-browser`;
const job = JSON.parse(fs.readFileSync(config.jobFile));
const env = { PATH: process.env.PATH, HOME: process.env.HOME, LANG: 'C.UTF-8', HALO_BROWSER_IMAGE: config.image,
  HALO_BROWSER_JOB_FILE: config.jobFile, HALO_BROWSER_OUTPUT_DIR: config.output,
  HALO_BROWSER_PROFILE_VOLUME: config.profileVolume, HALO_BROWSER_EGRESS_FILE: config.egressFile,
  HALO_BROWSER_UNSANDBOXED: config.unsandboxed ? '1' : '0' };
const compose = ['compose', '-p', config.project, '-f', path.join(composeDirectory, 'compose.yaml')];
const preserve = '--preserve-env=HALO_BROWSER_IMAGE,HALO_BROWSER_JOB_FILE,HALO_BROWSER_OUTPUT_DIR,HALO_BROWSER_PROFILE_VOLUME,HALO_BROWSER_EGRESS_FILE,HALO_BROWSER_UNSANDBOXED';
const abort = new AbortController();
process.once('SIGTERM', () => abort.abort()); process.once('SIGINT', () => abort.abort());
const lines = createInterface({ input: process.stdin });
let authorize;
const authorized = new Promise(resolve => { authorize = resolve; });
lines.on('line', line => { if (line === 'authorize') authorize(); });
lines.on('close', () => abort.abort());
const all = new Set();
function launch(binary, args, { log, timeoutMs, cleanup = false } = {}) {
  if (!cleanup) abort.signal.throwIfAborted();
  const fd = fs.openSync(path.join(config.execution, log), 'a', 0o600);
  const processChild = spawn(binary, args, { cwd: composeDirectory, env, stdio: ['ignore', fd, fd] });
  let timedOut = false, hardKill;
  const stop = () => { processChild.kill('SIGTERM'); hardKill ??= setTimeout(() => processChild.kill('SIGKILL'), 5000); };
  const timer = setTimeout(() => { timedOut = true; stop(); }, timeoutMs);
  if (!cleanup) abort.signal.addEventListener('abort', stop, { once: true });
  const done = new Promise((resolve, reject) => { processChild.once('error', reject); processChild.once('close', code => resolve({ code, timedOut })); })
    .finally(() => { clearTimeout(timer); clearTimeout(hardKill); abort.signal.removeEventListener('abort', stop); fs.closeSync(fd); all.delete(processChild); });
  // Preserve rejection for callers while avoiding an unhandled rejection during a concurrent process.
  done.catch(() => {}); all.add(processChild);
  return { child: processChild, done, stop };
}
const docker = (args, options) => launch(config.sudoDocker ? 'sudo' : 'docker', config.sudoDocker ? ['-n', preserve, 'docker', ...args] : args, options);
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function command(args, { cleanup = false, allowFailure = false, timeoutMs = 60000, log = 'docker.log' } = {}) {
  const result = await docker(args, { cleanup, timeoutMs, log }).done;
  if (!allowFailure && (result.code !== 0 || result.timedOut)) throw new Error('Container command failed or timed out');
  return result;
}
async function cleanupContainers() {
  await command(['rm', '-f', container], { cleanup: true, allowFailure: true, timeoutMs: 15000 });
  await command([...compose, 'down', '--remove-orphans', '--timeout', '5'], { cleanup: true, timeoutMs: 20000 });
}
let publisher, browserResult, workerCode, reportsDelivered = false, error, cleaned = false;
try {
  // The previous holder is gone before flock allows this process to run. Remove
  // any containers it left behind before reusing the durable private profile.
  await cleanupContainers();
  abort.signal.throwIfAborted();
  await command([...compose, 'up', '-d', '--wait', '--wait-timeout', '40', 'egress']);
  publisher = launch('sh', [path.join(directory, 'run-forwarder.sh'), config.forwardingFile, ...(config.localTest ? ['--local-test'] : [])],
    { log: 'forwarder.log', timeoutMs: (config.maxRunSeconds + 120) * 1000 });
  const readyBy = Date.now() + 10000;
  while (!fs.readFileSync(path.join(config.execution, 'forwarder.log'), 'utf8').includes('halo-browser-forwarder')) {
    if (publisher.child.exitCode !== null || Date.now() >= readyBy) throw new Error('Browser report publisher unavailable');
    abort.signal.throwIfAborted(); await pause(100);
  }
  console.log('halo-runner-authorize-start');
  let authorizationTimer;
  try { await Promise.race([authorized, new Promise((_, reject) => { authorizationTimer = setTimeout(() => reject(new Error('Start authorization expired')), 20000); })]); }
  finally { clearTimeout(authorizationTimer); }
  abort.signal.throwIfAborted();
  const worker = await command([...compose, 'run', '-T', '--no-deps', '--name', container, 'browser'],
    { allowFailure: true, log: 'worker.log', timeoutMs: (config.maxRunSeconds + 30) * 1000 });
  workerCode = worker.code;
  browserResult = z.object({ version: z.literal('halo.browser-result.v1'), jobId: z.literal(job.id),
    reportCount: z.number().int().min(0).max(1000000), result: z.object({ status: z.string().min(1).max(60) }).passthrough(),
  }).strict().parse(JSON.parse(readPublicFile(config.output, 'result.json', 8192)));
  // A failed relay must not lose the browser's publication outcome. Keep the
  // publisher journal and report directory for later delivery recovery.
  const grace = setTimeout(() => publisher.stop(), 15000);
  try { const forwarded = await publisher.done; reportsDelivered = forwarded.code === 0 && !forwarded.timedOut; }
  finally { clearTimeout(grace); }
} catch (caught) { error = caught; }
finally {
  publisher?.stop(); await publisher?.done.catch(() => {});
  try { await cleanupContainers(); cleaned = true; } catch (caught) { error ??= caught; }
  lines.close();
}
const result = { version: 'halo.container-outcome.v1', executionId: config.executionId, jobId: job.id,
  image: config.image, workerExitCode: workerCode ?? null, reportsDelivered, containersCleaned: cleaned,
  reportCount: browserResult?.reportCount ?? 0, result: browserResult?.result ?? { status: 'runner-unavailable' } };
const temporary = path.join(config.execution, 'outcome.json.tmp'), fd = fs.openSync(temporary, 'wx', 0o600);
try { fs.writeFileSync(fd, JSON.stringify(result)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
fs.renameSync(temporary, path.join(config.execution, 'outcome.json'));
const dirfd = fs.openSync(config.execution, 'r'); try { fs.fsyncSync(dirfd); } finally { fs.closeSync(dirfd); }
if (error) { console.error('Browser execution did not complete; private execution records retained'); process.exitCode = 1; }
