import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { browserReportSchema } from './schema.mjs';
import { screenIsPublic, SOCIAL_PLATFORMS } from './social-driver.mjs';

function commit(file, bytes) {
  const tmp = `${file}.${randomUUID()}.tmp`, fd = fs.openSync(tmp, 'wx', 0o600);
  try { fs.writeFileSync(fd, bytes); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  fs.renameSync(tmp, file);
}

/** Capture is serialized. Entering a private phase invalidates any screenshot already in flight. */
export function createReportWriter({ page, getPage = () => page, job, directory, isPublic = screenIsPublic, captureDesktop }) {
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  if (fs.readdirSync(directory).some(name => /^\d{6}\.(json|jpg|png)$/.test(name))) throw new Error('Each browser execution requires an unused output directory');
  let sequence = 0, revision = 0, stopped = false, queue = Promise.resolve();
  let phase = { activity: 'The isolated browser is starting.', state: 'private' };
  const emit = () => {
    if (stopped) return Promise.resolve();
    const operation = queue.then(async () => {
      const startedRevision = revision, snapshot = { ...phase };
      const record = { version: 'halo.browser-report.v1', jobId: job.id, sequence,
        timestamp: new Date().toISOString(), siteOrigin: SOCIAL_PLATFORMS[job.platform].origin,
        ...snapshot, width: 0, height: 0, ...(job.display==='desktop'?{surface:'desktop'}:{}) };
      const publicPhase = !['private', 'needs-account', 'error'].includes(snapshot.state);
      const capturePage = getPage();
      let bytes;
      if (publicPhase && capturePage && await isPublic(capturePage, job.platform)) {
        bytes = job.display==='desktop' ? await captureDesktop?.(capturePage,job.platform)
          : await capturePage.screenshot({ type: 'jpeg', quality: 65, fullPage: false,
            mask: [capturePage.locator('input'), capturePage.locator('[data-private]')], maskColor: '#240046' });
        if (startedRevision !== revision || !await isPublic(capturePage, job.platform)) bytes = undefined;
      }
      if (bytes) {
        if (bytes.length > 2000000) throw new Error('Browser screenshot exceeds transport limit');
        record.imageFile = `${String(sequence).padStart(6, '0')}.jpg`; record.width = 1280; record.height = job.display==='desktop'?800:720;
        commit(path.join(directory, record.imageFile), bytes);
      } else if (publicPhase) {
        record.state = 'private'; record.activity = 'The browser is on a private or unclassified screen.';
      }
      browserReportSchema.parse(record);
      commit(path.join(directory, `${String(sequence).padStart(6, '0')}.json`), JSON.stringify(record));
      sequence++;
    });
    queue = operation.catch(() => {}); return operation;
  };
  return {
    report(next) { phase = next; revision++; return emit(); },
    capture: emit,
    async close() { stopped = true; await queue; return sequence; },
  };
}
