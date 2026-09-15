import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { randomBytes } from 'node:crypto';
import { createWorkspaceEntrypoint } from '../runtime/browser/workspace-entrypoint.mjs';
import { snapshot } from '../runtime/browser/profile-snapshot.mjs';

function memoryStore() {
  const data = new Map();
  return { data, async put(key, bytes) { data.set(key, Buffer.from(bytes)); },
    async get(key) { const value = data.get(key); if (!value) throw Object.assign(new Error('Not found'), { code: 'ENOENT' }); return value; },
    async list(prefix) { return [...data.keys()].filter(key => key.startsWith(prefix)); } };
}
function stubWorker() {
  const child = new EventEmitter();
  child.exitCode = null; child.killed = false;
  child.kill = signal => { child.killed = true; child.exitCode = 0; setImmediate(() => child.emit('exit', 0, signal)); };
  return child;
}
function fakeClock() {
  const timers = [];
  return { timers,
    setIntervalFn: (fn, ms) => { const timer = { fn, ms }; timers.push(timer); return timer; },
    clearIntervalFn: timer => { const i = timers.indexOf(timer); if (i >= 0) timers.splice(i, 1); },
    tick() { for (const timer of [...timers]) timer.fn(); } };
}

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'halo-workspace-entrypoint-'));
const agent = `0x${'11'.repeat(20)}`;
const keyBytes = randomBytes(32);

// Fresh volume (no local state, no prior snapshot): start() proceeds without restoring, worker spawns.
{
  const store = memoryStore();
  const profileDir = path.join(root, 'fresh-profile');
  let spawnedWith;
  const worker = stubWorker();
  const clock = fakeClock();
  const entrypoint = createWorkspaceEntrypoint({
    config: { agent, profileDir, socialConfig: 'social.json' }, store, keyBytes, log: () => {},
    spawnWorker: config => { spawnedWith = config; return worker; },
    setIntervalFn: clock.setIntervalFn, clearIntervalFn: clock.clearIntervalFn,
  });
  const exit = entrypoint.start();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(spawnedWith.agent, agent);
  assert.equal(fs.existsSync(profileDir), true, 'an empty profile directory is created even with nothing to restore');
  worker.kill('SIGTERM');
  await exit;
  console.log('PASS start() with no prior snapshot and an empty volume proceeds straight to the worker');
}

// A prior snapshot exists and the local volume is empty (post lease-loss): start() restores it first.
{
  const store = memoryStore();
  const seedDir = path.join(root, 'seed-profile');
  fs.mkdirSync(seedDir, { recursive: true });
  fs.writeFileSync(path.join(seedDir, 'session.json'), '{"loggedIn":true}');
  await snapshot({ profileDir: seedDir, store, keyBytes, agent });
  const profileDir = path.join(root, 'lease-loss-profile');
  const worker = stubWorker();
  const clock = fakeClock();
  const entrypoint = createWorkspaceEntrypoint({
    config: { agent, profileDir, socialConfig: 'social.json' }, store, keyBytes, log: () => {},
    spawnWorker: () => worker, setIntervalFn: clock.setIntervalFn, clearIntervalFn: clock.clearIntervalFn,
  });
  const exit = entrypoint.start();
  await new Promise(resolve => setImmediate(resolve));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(fs.readFileSync(path.join(profileDir, 'session.json'), 'utf8'), '{"loggedIn":true}');
  worker.kill('SIGTERM');
  await exit;
  console.log('PASS start() restores the last snapshot into an empty volume before running the worker');
}

// A volume that already has local state is never overwritten by an older external snapshot.
{
  const store = memoryStore();
  const seedDir = path.join(root, 'seed-profile-2');
  fs.mkdirSync(seedDir, { recursive: true });
  fs.writeFileSync(path.join(seedDir, 'session.json'), '{"marker":"old"}');
  await snapshot({ profileDir: seedDir, store, keyBytes, agent });
  const profileDir = path.join(root, 'restart-profile');
  fs.mkdirSync(profileDir, { recursive: true });
  fs.writeFileSync(path.join(profileDir, 'session.json'), '{"marker":"current"}');
  const worker = stubWorker();
  const clock = fakeClock();
  const entrypoint = createWorkspaceEntrypoint({
    config: { agent, profileDir, socialConfig: 'social.json' }, store, keyBytes, log: () => {},
    spawnWorker: () => worker, setIntervalFn: clock.setIntervalFn, clearIntervalFn: clock.clearIntervalFn,
  });
  const exit = entrypoint.start();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(fs.readFileSync(path.join(profileDir, 'session.json'), 'utf8'), '{"marker":"current"}');
  worker.kill('SIGTERM');
  await exit;
  console.log('PASS an ordinary restart with existing local state is never clobbered by an older snapshot');
}

// The periodic timer takes a snapshot without stopping the worker; stop() takes a final one and kills it.
{
  const store = memoryStore();
  const profileDir = path.join(root, 'periodic-profile');
  fs.mkdirSync(profileDir, { recursive: true });
  fs.writeFileSync(path.join(profileDir, 'a.txt'), 'one');
  const worker = stubWorker();
  const clock = fakeClock();
  const events = [];
  const entrypoint = createWorkspaceEntrypoint({
    config: { agent, profileDir, socialConfig: 'social.json', snapshotIntervalMinutes: 1 }, store, keyBytes,
    log: message => events.push(message), spawnWorker: () => worker,
    setIntervalFn: clock.setIntervalFn, clearIntervalFn: clock.clearIntervalFn,
  });
  const exit = entrypoint.start();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(clock.timers.length, 1);
  clock.tick();
  await new Promise(resolve => setImmediate(resolve));
  assert.ok(events.some(event => event.event === 'snapshot' && event.reason === 'interval'));
  await entrypoint.stop('SIGTERM');
  assert.ok(events.some(event => event.event === 'snapshot' && event.reason === 'shutdown'));
  assert.equal(worker.killed, true);
  assert.equal(clock.timers.length, 0, 'the periodic timer is cleared on stop');
  await exit;
  const slots = [...store.data.keys()].filter(key => key.startsWith(`profiles/${agent}/`));
  assert.ok(slots.length >= 1);
  await entrypoint.stop('SIGTERM'); // stop() is idempotent
  console.log('PASS periodic snapshots run on schedule and stop() snapshots once more before killing the worker');
}

fs.rmSync(root, { recursive: true, force: true });
