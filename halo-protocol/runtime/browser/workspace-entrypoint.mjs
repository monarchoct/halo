import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { z } from 'zod';
import { restore, snapshot } from './profile-snapshot.mjs';

const directory = path.dirname(fileURLToPath(import.meta.url));
const socialCli = path.join(directory, '..', 'social-cli.mjs');

export const workspaceConfigSchema = z.object({
  agent: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  profileDir: z.string().min(1).default('/profile'),
  socialConfig: z.string().min(1),
  socialArgs: z.array(z.string()).default([]),
  snapshotIntervalMinutes: z.number().positive().max(1440).default(15),
}).strict();

/**
 * Orchestrates one Akash workspace shard's agent service: restore its encrypted profile snapshot
 * into the (possibly fresh, post-lease-loss) persistent volume, run the existing social-worker
 * poll loop as a child process, and keep taking periodic + shutdown snapshots. `store`/`keyBytes`
 * are injected — this module has no cloud-vendor object-store client of its own (see
 * deploy/akash/README.md for how a real deployment wires one in).
 */
export function createWorkspaceEntrypoint({ config: rawConfig, store, keyBytes,
  spawnWorker = config => spawn(process.execPath, [socialCli, config.socialConfig, ...config.socialArgs], { stdio: 'inherit' }),
  log = message => console.log(JSON.stringify(message)),
  setIntervalFn = setInterval, clearIntervalFn = clearInterval }) {
  const config = workspaceConfigSchema.parse(rawConfig);
  let worker, timer, stopped = false, snapshotChain = Promise.resolve();

  function takeSnapshot(reason) {
    snapshotChain = snapshotChain.then(() => snapshot({ profileDir: config.profileDir, store, keyBytes, agent: config.agent }))
      .then(result => { log({ service: 'halo-workspace-entrypoint', event: 'snapshot', reason, ...result }); return result; })
      .catch(error => { log({ service: 'halo-workspace-entrypoint', event: 'snapshot-failed', reason, error: error.message }); throw error; });
    return snapshotChain;
  }

  async function restoreIfEmpty() {
    const hasLocalState = fs.existsSync(config.profileDir) && fs.readdirSync(config.profileDir).length > 0;
    if (hasLocalState) { log({ service: 'halo-workspace-entrypoint', event: 'restore-skipped', reason: 'local-volume-has-state' }); return; }
    try {
      const result = await restore({ profileDir: config.profileDir, store, keyBytes, agent: config.agent });
      log({ service: 'halo-workspace-entrypoint', event: 'restored', ...result });
    } catch (error) {
      if (!/No snapshot is available/.test(error.message)) throw error;
      fs.mkdirSync(config.profileDir, { recursive: true, mode: 0o700 });
      log({ service: 'halo-workspace-entrypoint', event: 'restore-skipped', reason: 'no-prior-snapshot' });
    }
  }

  return {
    /** Resolves once the worker process exits (normally only on stop() or a worker crash). */
    async start() {
      await restoreIfEmpty();
      worker = spawnWorker(config);
      const exitCode = new Promise(resolve => worker.once('exit', (code, signal) => resolve({ code, signal })));
      timer = setIntervalFn(() => { takeSnapshot('interval').catch(() => {}); }, config.snapshotIntervalMinutes * 60 * 1000);
      if (typeof timer?.unref === 'function') timer.unref();
      return exitCode;
    },
    /** Stop the worker and take one final snapshot first. Safe to call more than once. */
    async stop(signal = 'SIGTERM') {
      if (stopped) return; stopped = true;
      clearIntervalFn(timer);
      await takeSnapshot('shutdown').catch(() => {});
      if (worker && worker.exitCode === null && !worker.killed) {
        worker.kill(signal);
        await new Promise(resolve => worker.once('exit', resolve));
      }
    },
  };
}

async function main() {
  const file = process.argv[2];
  if (!file) throw new Error('Usage: node runtime/browser/workspace-entrypoint.mjs config.json');
  const raw = JSON.parse(fs.readFileSync(path.resolve(file), 'utf8'));
  const resolve = value => path.resolve(path.dirname(path.resolve(file)), value);
  const runnerConfig = z.object({ storeModule: z.string().min(1), storeConfig: z.record(z.string(), z.unknown()).default({}),
    keyFile: z.string().min(1) }).passthrough().parse(raw);
  // The concrete object-store client (S3/R2/Backblaze/...) is injected by path so this module
  // never hardcodes an unverified vendor API; see deploy/akash/README.md for the expected shape.
  const storeModule = await import(pathToFileURL(resolve(runnerConfig.storeModule)).href);
  const store = await storeModule.createStore(runnerConfig.storeConfig);
  const keyBytes = fs.readFileSync(resolve(runnerConfig.keyFile));
  const entrypoint = createWorkspaceEntrypoint({ config: raw, store, keyBytes });
  const exit = entrypoint.start();
  for (const signal of ['SIGTERM', 'SIGINT']) process.once(signal, () => { entrypoint.stop(signal).then(() => process.exit(0)); });
  const { code } = await exit;
  process.exitCode = code ?? 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
