import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { chromium } from 'playwright';
import { runSocialTask } from './social-driver.mjs';
import { browserJobSchema } from './schema.mjs';
import { createReportWriter } from './report-writer.mjs';
import { startDesktop } from './desktop.mjs';

if (!process.argv[2]) throw new Error('Usage: node worker.mjs job.json');
const jobPath = path.resolve(process.argv[2]);
const config = browserJobSchema.parse(JSON.parse(fs.readFileSync(jobPath)));
if (process.platform !== 'linux') throw new Error('Run the production browser worker in its isolated Linux container');
const resolve = value => path.resolve(path.dirname(jobPath), value);
for (const directory of [resolve(config.profileDirectory), resolve(config.outputDirectory)]) fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
const profile = fs.realpathSync(resolve(config.profileDirectory)), output = fs.realpathSync(resolve(config.outputDirectory));
if (profile === output || output.startsWith(`${profile}${path.sep}`) || profile.startsWith(`${output}${path.sep}`)) throw new Error('Private profile and public output must be disjoint');
const proxy = new URL(config.egressProxy);
if (!['http:', 'https:'].includes(proxy.protocol) || proxy.username || proxy.password || proxy.pathname !== '/' || proxy.search || proxy.hash) throw new Error('Use a separate configured egress proxy origin');
// Gated escape hatch for hosts that cannot grant Chromium's own user-namespace sandbox (e.g. a
// Docker-less restricted pod). Off by default; explicit opt-in only, loudly logged and recorded
// on every signed frame so a viewer can see the isolation boundary that was actually in effect.
const unsandboxed = process.env.HALO_BROWSER_UNSANDBOXED === '1';
if (unsandboxed) console.warn(JSON.stringify({ service: 'halo-browser-worker', level: 'warn', event: 'chromium-sandbox-disabled',
  message: 'HALO_BROWSER_UNSANDBOXED=1: Chromium is starting with --no-sandbox. Only the surrounding container/pod boundary isolates this session; use this only where a kernel user-namespace sandbox is unavailable to the host.' }));
let context, page, interval, desktop, stage = 'startup';
const writer = createReportWriter({ getPage: () => page, job: config, directory: output, captureDesktop:(page,platform)=>desktop?.capture(page,platform),
  sandbox: unsandboxed ? 'container-only' : 'kernel' });
const report = value => writer.report(value);
let capturing = false, expired = false;
const deadline = setTimeout(() => { expired = true; context?.close().catch(() => {}); }, config.maxRunSeconds * 1000);
const journal = {
  async read(id) { const file = path.join(profile, `post-${id}.json`); return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file)) : undefined; },
  async write(id, value) {
    const file = path.join(profile, `post-${id}.json`), temporary = `${file}.${randomUUID()}.tmp`, fd = fs.openSync(temporary, 'wx', 0o600);
    try { fs.writeFileSync(fd, JSON.stringify({ ...value, textSha256: createHash('sha256').update(value.text ?? '').digest('hex'), updatedAt: new Date().toISOString() })); fs.fsyncSync(fd); }
    finally { fs.closeSync(fd); }
    fs.renameSync(temporary, file);
    const dir = fs.openSync(profile, 'r'); try { fs.fsyncSync(dir); } finally { fs.closeSync(dir); }
  },
};
let result;
try {
  await report({ activity: unsandboxed ? 'Starting the isolated browser with its kernel sandbox disabled (HALO_BROWSER_UNSANDBOXED).' : 'Starting the isolated browser with its sandbox enabled.', state: 'private' });
  if(config.display==='desktop')desktop=await startDesktop();
  const chromeArgs = [...(desktop?['--window-position=0,0','--window-size=1280,800']:[]), ...(unsandboxed?['--no-sandbox']:[])];
  context = await chromium.launchPersistentContext(profile, { headless: !desktop, chromiumSandbox: !unsandboxed,
    ...(chromeArgs.length?{args:chromeArgs}:{}), ...(desktop?{env:desktop.env,viewport:null}:{}),
    timeout: Math.min(60000, config.maxRunSeconds * 1000),
    proxy: { server: proxy.origin }, ...(!desktop?{viewport:{width:1280,height:720}}:{}), acceptDownloads: false, serviceWorkers: 'block',
    permissions: [], locale: 'en-US', ignoreHTTPSErrors: false });
  if (expired) throw new Error('Browser startup exceeded the job deadline');
  page = context.pages()[0] ?? await context.newPage();
  await context.route('**/*', async route => {
    try {
      const url = new URL(route.request().url());
      if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443')) return route.abort();
      return route.continue(); // The separate proxy pins public DNS and the container has no direct egress.
    } catch { return route.abort(); }
  });
  context.on('page', popup => { if (popup !== page) popup.close().catch(() => {}); });
  page.on('dialog', dialog => dialog.dismiss().catch(() => {}));
  interval = setInterval(async () => {
    if (capturing) return;
    capturing = true;
    try { await writer.capture(); } catch { /* The final result records the worker outcome. */ }
    finally { capturing = false; }
  }, config.captureIntervalMs);
  stage = 'social-task';
  result = await runSocialTask({ page, job: config, binding: config.binding, report, journal });
  const terminalState = ['needs-account', 'account-mismatch'].includes(result.status) ? 'needs-account'
    : ['observed', 'account-visible', 'posted', 'drafted'].includes(result.status) ? 'complete' : 'error';
  await report({ activity: `Browser task finished: ${result.status}.`, state: terminalState });
} catch {
  result = { status: expired ? 'timed-out' : 'failed', stage };
  process.exitCode = 1;
  await report({ activity: expired ? 'The browser reached its execution time limit.'
    : stage === 'startup' ? 'The isolated browser could not start. No social task was executed.'
      : 'The browser task could not complete. Its publication journal is retained.', state: 'error' }).catch(() => {});
} finally {
  clearInterval(interval); clearTimeout(deadline);
  await context?.close().catch(() => {});
  const reportCount = await writer.close();
  await desktop?.close();
  const temporary = path.join(output, `result.${randomUUID()}.tmp`);
  const fd = fs.openSync(temporary, 'wx', 0o600);
  try { fs.writeFileSync(fd, JSON.stringify({ version: 'halo.browser-result.v1', jobId: config.id, reportCount, result })); fs.fsyncSync(fd); }
  finally { fs.closeSync(fd); }
  fs.renameSync(temporary, path.join(output, 'result.json'));
  const dir = fs.openSync(output, 'r'); try { fs.fsyncSync(dir); } finally { fs.closeSync(dir); }
}
