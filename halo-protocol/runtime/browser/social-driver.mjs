import { createHash } from 'node:crypto';
/** Only configured social controls are exposed. No shell, wallet or model-selected destinations. */
export const SOCIAL_PLATFORMS = Object.freeze({
  x: { origin: 'https://x.com', landing: 'https://x.com/', loginButton: { role: 'link', name: 'Sign in' } },
  fomo: { origin: 'https://fomo.family', landing: 'https://fomo.family/', loginButton: { role: 'button', name: 'Login' } },
});
const SENSITIVE = /password|one.time (code|password)|verification code|seed phrase|recovery phrase|private key|enter.{0,20}email|sign in with|continue with (apple|google)|mit (apple|google) fortfahren|anmelden oder konto erstellen/i;
const control = (page, spec) => page.getByRole(spec.role, spec.name ? { name: spec.name, exact: true } : {});
const isVisible = async locator => { try { return await locator.count() === 1 && await locator.isVisible(); } catch { return false; } };
export const publicationFingerprint = (job, profileUrl) => createHash('sha256').update(JSON.stringify([
  'halo.social-publication.v1', job.id, job.platform, job.chainId, profileUrl, job.text,
])).digest('hex');
const sameUrl = (value, expected, origin) => { try { return !!value && new URL(value, origin).href === expected; } catch { return false; } };
const normalize = value => value.replace(/\s+/g, ' ').trim();

async function findPublishedPost(page, binding, text, origin) {
  const posts = control(page, binding.postContainer).filter({ hasText: text });
  if (!await isVisible(posts) || !normalize(await posts.innerText()).includes(normalize(text))) return;
  const author = control(posts, binding.postAuthor);
  if (!await isVisible(author) || !sameUrl(await author.getAttribute('href'), binding.profileUrl, origin)) return;
  const permalink = control(posts, binding.postLink);
  if (!await isVisible(permalink)) return;
  const href = await permalink.getAttribute('href');
  if (!href) return;
  const url = new URL(href, origin);
  if (url.origin !== origin || url.username || url.password || url.search || url.hash
    || url.pathname === '/' || url.href === binding.profileUrl) return;
  if (origin === 'https://x.com' && !url.pathname.startsWith(`${new URL(binding.profileUrl).pathname.replace(/\/$/, '')}/status/`)) return;
  return url.href;
}

export async function screenIsPublic(page, platform) {
  try {
    const url = new URL(page.url());
    if (url.origin !== SOCIAL_PLATFORMS[platform].origin || /login|signin|sign-in|signup|sign-up|oauth|settings|wallet|recover|account|messages/i.test(url.pathname)
      || url.username || url.password || url.search || url.hash) return false;
    if (await page.locator('input[type="password"],input[type="email"],input[autocomplete="one-time-code"]').count()) return false;
    const dialogs = await page.getByRole('dialog').allTextContents();
    if (dialogs.some(text => SENSITIVE.test(text))) return false;
    // FOMO's account overlay currently uses a container rather than an ARIA dialog.
    if (await page.getByRole('button', { name: /continue with (apple|google)|mit (apple|google) fortfahren/i }).count()) return false;
    const pageText = (await page.locator('body').innerText()).slice(0, 50000);
    return !/seed phrase|recovery phrase|private key|verification code|one.time password/i.test(pageText);
  } catch { return false; }
}

export async function runSocialTask({ page, job, binding, report, journal }) {
  const platform = SOCIAL_PLATFORMS[job.platform];
  if (!platform || !['observe', 'onboard', 'publish'].includes(job.task)) throw new Error('Unsupported social task');
  const response = await page.goto(platform.landing, { waitUntil: 'domcontentloaded', timeout: 30000 });
  if (!response?.ok()) return { status: 'site-unavailable', httpStatus: response?.status() ?? null };
  // A loaded HTML shell is not an observed application. Wait for the configured identity
  // or the platform's actual sign-in control before capturing or acting on the page.
  try { await control(page, binding?.identity ?? platform.loginButton).waitFor({ state: 'visible', timeout: 20000 }); }
  catch { return { status: binding ? 'account-mismatch' : 'site-not-ready', platform: job.platform }; }
  await report({ activity: `Opening ${job.platform === 'x' ? 'X' : 'FOMO'} in the isolated browser.`, state: 'viewing' });
  if (job.task === 'observe') return { status: 'observed', platform: job.platform };
  if (!binding) {
    const entry = control(page, platform.loginButton);
    if (await isVisible(entry)) {
      await report({ activity: 'Opening account setup. Authentication screens are private.', state: 'private' });
      await entry.click({ timeout: 5000 });
    }
    await report({ activity: 'An account must be connected before this operator can publish.', state: 'needs-account' });
    return { status: 'needs-account', platform: job.platform };
  }
  const profile = new URL(binding.profileUrl);
  if (profile.origin !== platform.origin || profile.username || profile.password || profile.search || profile.hash) throw new Error('Profile must belong to the selected platform');
  const identity = control(page, binding.identity);
  if (!await isVisible(identity) || !sameUrl(await identity.getAttribute('href'), profile.href, platform.origin)) {
    await report({ activity: 'The connected account could not be matched to its configured public profile.', state: 'needs-account' });
    return { status: 'account-mismatch' };
  }
  if (job.task === 'onboard') return { status: 'account-visible', profileUrl: profile.href };
  if (!binding.openComposer || !binding.editor || !binding.submit || !binding.postContainer || !binding.postLink || !binding.postAuthor) return { status: 'composer-unconfigured' };
  if (!job.text?.trim() || job.text.length > 2000) throw new Error('A bounded public thesis is required');
  const fingerprint = publicationFingerprint(job, profile.href);
  const save = value => journal.write(job.id, { ...value, fingerprint, text: job.text, profileUrl: profile.href });
  const existing = await journal.read(job.id);
  if (existing && existing.fingerprint !== fingerprint) throw new Error('Publication job changed after it was journaled');
  if (existing?.status === 'posted') return existing;
  // Reconcile an ambiguous click by inspecting the public profile, never by clicking Publish again.
  if (job.reconcileOnly || ['submitting', 'uncertain'].includes(existing?.status)) {
    await page.goto(profile.href, { waitUntil: 'domcontentloaded', timeout: 30000 });
    const postUrl = await findPublishedPost(page, binding, job.text, platform.origin);
    if (postUrl) {
      const result = { status: 'posted', profileUrl: profile.href, postUrl, text: job.text, recovered: true };
      await save(result);
      await report({ activity: 'Recovered the existing public thesis without posting a duplicate.', state: 'complete' });
      return result;
    }
    await report({ activity: 'The prior posting outcome is still uncertain. Only read-only reconciliation will be retried.', state: 'error' });
    return { status: 'uncertain' };
  }
  const opener = control(page, binding.openComposer);
  if (!await isVisible(opener)) return { status: 'composer-unavailable' };
  await opener.click({ timeout: 5000 });
  const editor = control(page, binding.editor);
  if (!await isVisible(editor)) return { status: 'composer-unavailable' };
  await editor.fill(job.text, { timeout: 5000 });
  await save({ status: 'drafted' });
  await report({ activity: 'The public thesis is drafted in the social composer.', state: 'working' });
  if (!job.publish) return { status: 'drafted', profileUrl: profile.href };
  if (![4663, 46630].includes(job.chainId)) throw new Error('Social publication requires a configured Robinhood deployment');
  const submit = control(page, binding.submit);
  if (!await isVisible(submit) || !await submit.isEnabled()) return { status: 'publish-unavailable' };
  await save({ status: 'submitting' });
  try {
    await submit.click({ timeout: 10000 });
    const posted = control(page, binding.postContainer).filter({ hasText: job.text });
    await posted.waitFor({ state: 'visible', timeout: 15000 });
    const postUrl = await findPublishedPost(page, binding, job.text, platform.origin);
    if (!postUrl) throw new Error('Post author and permalink cannot be verified');
    const result = { status: 'posted', profileUrl: profile.href, postUrl, text: job.text };
    await save(result);
    await report({ activity: 'The submitted thesis and its public permalink are visible on the account.', state: 'complete' });
    return result;
  } catch {
    await save({ status: 'uncertain' });
    await report({ activity: 'Posting outcome is uncertain. The worker will not create a duplicate automatically.', state: 'error' });
    return { status: 'uncertain' };
  }
}
