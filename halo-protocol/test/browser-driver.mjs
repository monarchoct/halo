import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runSocialTask, screenIsPublic } from '../runtime/browser/social-driver.mjs';
import { browserJobSchema, browserReportSchema } from '../runtime/browser/schema.mjs';
import { createReportWriter } from '../runtime/browser/report-writer.mjs';

// A deterministic DOM contract fixture, not a live X/FOMO account or a browser smoke test.
class Locator {
  constructor(page, select) { this.page = page; this.select = select; }
  async count() { return this.select().length; }
  async isVisible() { return this.select().length === 1 && this.select()[0].visible !== false; }
  async isEnabled() { return this.select()[0]?.enabled !== false; }
  async getAttribute(name) { return this.select()[0]?.[name] ?? null; }
  async innerText() { return this.select()[0]?.text ?? ''; }
  async allTextContents() { return this.select().map(n => n.text); }
  async click() { if (!await this.isVisible()) throw new Error('Ambiguous or missing control'); await this.select()[0].click?.(); }
  async fill(value) { this.page.draft = value; }
  async waitFor() { if (!await this.isVisible()) throw new Error('Visible result not found'); }
  getByRole(role, options = {}) { return new Locator(this.page, () => this.select().flatMap(n => n.children ?? []).filter(n => matches(n, role, options))); }
  filter({ hasText }) { return new Locator(this.page, () => this.select().filter(n => n.text?.includes(hasText))); }
}
const matches = (node, role, options) => node.role === role && (!options.name || (options.name instanceof RegExp ? options.name.test(node.name) : node.name === options.name));
function fixture({ mode = 'success', connected = true, platform = 'x' } = {}) {
  const origin = platform === 'x' ? 'https://x.com' : 'https://fomo.family';
  const profileUrl = `${origin}/halo_test`;
  const page = { current: `${origin}/`, draft: '', posts: [], submits: 0, composer: false, private: false, mode,
    url() { return this.current; }, async goto(url) { this.current = url; return { ok: () => mode !== 'http-failure', status: () => mode === 'http-failure' ? 503 : 200 }; },
    nodes() { return [
      ...(connected ? [{ role: 'link', name: 'Profile', href: profileUrl }] : [{ role: platform === 'x' ? 'link' : 'button', name: platform === 'x' ? 'Sign in' : 'Login', click: () => { page.private = true; } }]),
      { role: 'button', name: 'New post', click: () => { page.composer = true; } },
      ...(page.composer ? [{ role: 'textbox', name: 'Thesis' }, { role: 'button', name: 'Publish', click: () => {
        page.submits++;
        const post = { role: 'article', name: 'Dynamic text, not a fixed accessible name', text: page.draft,
          children: [{ role: 'link', name: 'Author', href: page.mode === 'wrong-author' ? `${origin}/someone_else` : profileUrl },
            { role: 'link', name: 'Permalink', href: `${profileUrl}/status/123` }] };
        if (page.mode !== 'missing') page.posts.push(post);
        if (page.mode === 'ambiguous') page.posts.push(post);
        if (page.mode === 'accepted-timeout') throw new Error('Connection lost after the site accepted the post');
      } }] : []), ...page.posts,
      ...(page.private ? [{ role: 'button', name: 'Continue with Google' }, { role: 'dialog', text: 'Sign in with Google' }] : []),
    ]; },
    getByRole(role, options = {}) { return new Locator(page, () => page.nodes().filter(n => matches(n, role, options))); },
    locator(selector) { return new Locator(page, () => selector === 'body' ? [{ text: page.private ? 'Enter verification code' : 'Public posts' }]
      : selector.includes('input[type=') && page.private ? [{ text: '' }] : []); },
  };
  const binding = { profileUrl, identity: { role: 'link', name: 'Profile' }, openComposer: { role: 'button', name: 'New post' },
    editor: { role: 'textbox', name: 'Thesis' }, submit: { role: 'button', name: 'Publish' }, postContainer: { role: 'article' },
    postAuthor: { role: 'link', name: 'Author' }, postLink: { role: 'link', name: 'Permalink' } };
  const data = new Map(), reports = [];
  const journal = { async read(id) { return data.get(id); }, async write(id, value) { data.set(id, structuredClone(value)); } };
  const job = { id: 'a'.repeat(64), platform, task: 'publish', chainId: 46630, text: 'Test thesis: evidence before execution.', publish: true };
  return { page, job, binding, journal, data, reports, report: async value => { reports.push(value); } };
}
const passed = [];
const unavailable = fixture({ mode: 'http-failure', connected: false, platform: 'fomo' });
assert.equal((await runSocialTask({ ...unavailable, binding: undefined, job: { ...unavailable.job, task: 'observe' } })).status, 'site-unavailable');
assert.equal(unavailable.page.submits, 0); assert.equal(unavailable.reports.length, 0);
passed.push('An HTTP error cannot be reported as a successfully observed application');
const shell = fixture();
assert.equal((await runSocialTask({ ...shell, binding: undefined, job: { ...shell.job, task: 'observe' } })).status, 'site-not-ready');
assert.equal(shell.page.submits, 0); assert.equal(shell.reports.length, 0);
passed.push('An HTML shell without the expected application control cannot finish observation');
let f = fixture();
assert.equal((await runSocialTask(f)).status, 'posted'); assert.equal(f.page.submits, 1);
assert.equal((await runSocialTask(f)).status, 'posted'); assert.equal(f.page.submits, 1);
passed.push('Dynamic article name supported; journal prevents a second submission');
await assert.rejects(runSocialTask({ ...f, job: { ...f.job, text: 'Changed thesis with reused job id' } }), /changed after/);
passed.push('A journaled job binds its exact publication text and destination');
f = fixture({ mode: 'accepted-timeout' });
assert.equal((await runSocialTask(f)).status, 'uncertain'); assert.equal(f.page.submits, 1);
f.page.mode = 'success';
const recovered = await runSocialTask(f);
assert.equal(recovered.status, 'posted'); assert.equal(recovered.recovered, true); assert.equal(f.page.submits, 1);
passed.push('Lost publish response reconciles to the existing post without another click');
f = fixture({ mode: 'missing' });
assert.equal((await runSocialTask(f)).status, 'uncertain');
assert.equal((await runSocialTask(f)).status, 'uncertain'); assert.equal(f.page.submits, 1);
passed.push('An absent uncertain result is never blindly republished');
f = fixture(); f.job.reconcileOnly = true;
assert.equal((await runSocialTask(f)).status, 'uncertain'); assert.equal(f.page.submits, 0); assert.equal(f.page.composer, false);
passed.push('Database uncertainty prevents a fresh publication even when the private browser journal was lost');
f = fixture(); await runSocialTask(f); f.data.clear(); f.job.reconcileOnly = true;
const journalLost = await runSocialTask(f);
assert.equal(journalLost.status, 'posted'); assert.equal(journalLost.recovered, true); assert.equal(f.page.submits, 1);
passed.push('A replacement with no private journal recovers an existing post through read-only author and thesis checks');
for (const mode of ['wrong-author', 'ambiguous']) {
  f = fixture({ mode }); assert.equal((await runSocialTask(f)).status, 'uncertain');
  assert.equal((await runSocialTask(f)).status, 'uncertain'); assert.equal(f.page.submits, 1);
}
passed.push('Wrong author and ambiguous duplicate posts cannot be called confirmed');
f = fixture(); f.binding.identity.name = 'Someone else';
assert.equal((await runSocialTask(f)).status, 'account-mismatch'); assert.equal(f.page.submits, 0);
passed.push('Configured public profile must match the visible signed-in identity');
f = fixture({ connected: false, platform: 'fomo' }); f.binding = undefined;
assert.equal((await runSocialTask(f)).status, 'needs-account'); assert.equal(f.page.private, true); assert.equal(f.page.submits, 0);
assert.equal(f.reports.at(-1).state, 'needs-account');
passed.push('FOMO account setup becomes private and does not fabricate a connection');
f = fixture(); f.job.publish = false;
assert.equal((await runSocialTask(f)).status, 'drafted'); assert.equal(f.page.submits, 0);
f = fixture(); f.job.chainId = 31337;
await assert.rejects(runSocialTask(f), /Robinhood deployment/); assert.equal(f.page.submits, 0);
passed.push('Draft mode and local-chain guards prevent external publication');
f = fixture(); assert.equal(await screenIsPublic(f.page, 'x'), true);
for (const url of ['https://x.com/messages', 'https://x.com/halo_test?token=private', 'https://user:password@x.com/', 'https://other.example/']) {
  f.page.current = url; assert.equal(await screenIsPublic(f.page, 'x'), false);
}
f.page.current = 'https://x.com/'; f.page.private = true; assert.equal(await screenIsPublic(f.page, 'x'), false);
passed.push('Private paths, URL credentials and authentication overlays suppress capture');
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'halo-screen-privacy-'));
let release, entered;
const enteredPromise = new Promise(resolve => { entered = resolve; });
f = fixture(); f.page.screenshot = async () => { entered(); await new Promise(resolve => { release = resolve; }); return Buffer.from('sensitive image must never reach disk'); };
const writer = createReportWriter({ page: f.page, job: f.job, directory, isPublic: async () => true });
const publicCapture = writer.report({ state: 'viewing', activity: 'Public profile' });
await enteredPromise;
const privateCapture = writer.report({ state: 'private', activity: 'Opening authentication' });
release(); await publicCapture; await privateCapture; await writer.close();
assert.equal(fs.readdirSync(directory).some(n => n.endsWith('.jpg')), false);
assert.equal(JSON.parse(fs.readFileSync(path.join(directory, '000000.json'))).state, 'private');
passed.push('A privacy transition invalidates a screenshot already in flight');
assert.throws(() => browserReportSchema.parse({ version: 'halo.browser-report.v1', jobId: 'a'.repeat(64), sequence: 0,
  timestamp: new Date().toISOString(), siteOrigin: 'https://x.com', activity: 'private', state: 'private', width: 1280, height: 720, imageFile: '000000.jpg' }));
assert.throws(() => browserJobSchema.parse({ ...f.job, profileDirectory: '/private', outputDirectory: '/public', egressProxy: 'http://egress:3128', captureIntervalMs: 10 }));
passed.push('Report schema rejects private images and excessive capture frequency');
const evidence = { checkedAt: new Date().toISOString(), scope: 'Deterministic DOM fixtures; no browser process, external account or post', passed };
fs.mkdirSync(new URL('../test-results/', import.meta.url), { recursive: true });
fs.writeFileSync(new URL('../test-results/browser-driver.json', import.meta.url), JSON.stringify(evidence, null, 2));
for (const name of fs.readdirSync(directory)) fs.unlinkSync(path.join(directory, name)); fs.rmdirSync(directory);
console.log(`PASS ${passed.length} social-driver and capture-boundary scenarios; no external social posts`);
