import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { browserJobSchema } from './schema.mjs';
import { assertSupportedDeployment } from '../../sdk/networks.mjs';

const directory = path.dirname(fileURLToPath(import.meta.url));
export const containerRunnerSchema = z.object({
  image: z.string().regex(/^(?:[a-z0-9./:_-]+@)?sha256:[a-f0-9]{64}$/),
  stateDirectory: z.string(), deploymentFile: z.string(), egressFile: z.string(), endpoint: z.string().url(),
  operatorAddress: z.string().regex(/^0x[0-9a-fA-F]{40}$/), operatorKeyFile: z.string().optional(),
  localTest: z.boolean().default(false), sudoDocker: z.boolean().default(false),
  display: z.enum(['browser','desktop']).default('browser'),
  maxRunSeconds: z.number().int().min(30).max(900).default(180),
  captureIntervalMs: z.number().int().min(2000).max(30000).default(3000),
}).strict();

function privateDirectory(value) {
  const resolved = path.resolve(value); fs.mkdirSync(resolved, { recursive: true, mode: 0o700 });
  const actual = fs.realpathSync(resolved), stat = fs.statSync(actual);
  if (actual !== resolved || stat.uid !== process.getuid() || (stat.mode & 0o077)) throw new Error('Use an operator-owned private directory without symlinks');
  return actual;
}
function writePrivate(file, value) {
  const fd = fs.openSync(file, 'wx', 0o600);
  try { fs.writeFileSync(fd, JSON.stringify(value)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
}
export function profileIdentity(deployment, agent, platform) {
  return createHash('sha256').update(JSON.stringify([deployment.chainId, deployment.registry.toLowerCase(), agent.toLowerCase(), platform])).digest('hex');
}

/** Trusted operator adapter. Only the job, public output and private browser profile are mounted in Chromium. */
export function createContainerRunner(input) {
  if (process.platform !== 'linux' || process.getuid() !== 1000) throw new Error('Run browser orchestration as Linux UID 1000');
  const config = containerRunnerSchema.parse(input);
  config.deploymentFile = fs.realpathSync(config.deploymentFile); config.egressFile = fs.realpathSync(config.egressFile);
  const deployment = JSON.parse(fs.readFileSync(config.deploymentFile)); assertSupportedDeployment(deployment);
  if (config.localTest ? deployment.environment !== 'local' : deployment.environment === 'local') throw new Error('Local browser execution requires the explicit local-test configuration');
  if (config.operatorKeyFile) config.operatorKeyFile = fs.realpathSync(config.operatorKeyFile);
  else if (!config.localTest) throw new Error('A production browser publisher needs its independent operator key file');
  const state = privateDirectory(config.stateDirectory);
  const locks = privateDirectory(path.join(state, 'profiles')), executions = privateDirectory(path.join(state, 'executions'));
  const env = { PATH: `${path.dirname(process.execPath)}:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin`,
    HOME: process.env.HOME, LANG: 'C.UTF-8' };
  return async (proposal, guard) => {
    guard.signal?.throwIfAborted();
    const agent = z.string().regex(/^0x[0-9a-fA-F]{40}$/).parse(guard.agent).toLowerCase();
    const job = browserJobSchema.parse({ ...proposal, profileDirectory: '/profile', outputDirectory: '/public',
      egressProxy: 'http://egress:3128', captureIntervalMs: config.captureIntervalMs, maxRunSeconds: config.maxRunSeconds, display:config.display });
    if (job.chainId !== deployment.chainId || (config.localTest && job.publish)) throw new Error('Browser job does not match its deployment');
    const identity = profileIdentity(deployment, agent, job.platform), executionId = randomUUID();
    const execution = privateDirectory(path.join(executions, executionId));
    const output = privateDirectory(path.join(execution, 'public'));
    const jobFile = path.join(execution, 'job.json'); writePrivate(jobFile, job);
    const forwardingFile = path.join(execution, 'forwarding.json');
    writePrivate(forwardingFile, { deploymentFile: config.deploymentFile, agent, operatorAddress: config.operatorAddress,
      ...(config.operatorKeyFile ? { operatorKeyFile: config.operatorKeyFile } : {}), jobId: job.id, platform: job.platform,
      endpoint: config.endpoint, reportDirectory: output, stateFile: path.join(execution, 'publisher', 'delivery.json'),
      maxRunSeconds: config.maxRunSeconds + 120 });
    const runFile = path.join(execution, 'execution.json');
    writePrivate(runFile, { version: 'halo.container-execution.v1', ...config, executionId, execution, jobFile, output, forwardingFile,
      project: `halo-social-${identity.slice(0, 24)}`, profileVolume: `halo-social-${identity}-profile` });
    const fd = fs.openSync(path.join(execution, 'runner.log'), 'wx', 0o600);
    const child = spawn('flock', ['--exclusive', '--nonblock', '--no-fork', '--conflict-exit-code', '75', path.join(locks, `${identity}.lock`),
      process.execPath, path.join(directory, 'container-executor.mjs'), runFile], { env, stdio: ['pipe', 'pipe', fd] });
    let interrupted = false, hardKill, authorization;
    const abort = () => { interrupted = true; child.kill('SIGTERM'); hardKill ??= setTimeout(() => child.kill('SIGKILL'), 45000); };
    guard.signal?.addEventListener('abort', abort, { once: true });
    if (guard.signal?.aborted) abort();
    child.stdin.on('error', () => {});
    const lines = createInterface({ input: child.stdout });
    lines.on('line', line => {
      if (line !== 'halo-runner-authorize-start' || authorization) return;
      authorization = (async () => {
        guard.signal?.throwIfAborted(); await guard.beforeStart(); await guard.verifyReceipt(); guard.signal?.throwIfAborted();
        if (!child.stdin.destroyed) child.stdin.write('authorize\n');
      })().catch(() => abort());
    });
    try {
      const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('close', resolve); });
      await authorization;
      if (interrupted) throw new Error('Browser execution interrupted or lease lost');
      if (code === 75) throw new Error('Agent browser profile is already in use');
      if (code !== 0) throw new Error('Browser container execution unavailable; retained outcome requires recovery');
      const file = path.join(execution, 'outcome.json'), stat = fs.lstatSync(file);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 16384) throw new Error('Invalid trusted browser execution outcome');
      const result = JSON.parse(fs.readFileSync(file));
      if (result.executionId !== executionId || result.jobId !== job.id) throw new Error('Browser outcome belongs to another execution');
      return { ...result, executionDirectory: execution };
    } finally {
      clearTimeout(hardKill); guard.signal?.removeEventListener('abort', abort); lines.close(); child.stdin.destroy(); fs.closeSync(fd);
    }
  };
}
