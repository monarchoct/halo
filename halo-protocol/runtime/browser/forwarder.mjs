import fs from 'node:fs';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { keccak256, toHex, verifyMessage } from 'viem';
import { z } from 'zod';
import { canonicalJson } from '../../sdk/manifest.mjs';
import { safeFetch, SafeFetchHttpError } from '../../sdk/safe-fetch.mjs';
import { assertSupportedDeployment } from '../../sdk/networks.mjs';
import { browserReportSchema } from './schema.mjs';
import { SOCIAL_PLATFORMS } from './social-driver.mjs';
import { browserFrameMessage, imageDigest, imageInfo } from './frames.mjs';

const ZERO = `0x${'0'.repeat(64)}`;
const digest = value => createHash('sha256').update(value).digest('hex');
const cursorSchema = z.object({ version: z.literal(1), contextHash: z.string().length(64),
  cursor: z.number().int().min(0), sequence: z.number().int().min(0), sessionId: z.string().uuid(),
  lastTimestamp: z.number().int().min(0),
  previousHash: z.string().regex(/^0x[0-9a-f]{64}$/), pending: z.object({
    reportHash: z.string().length(64), record: z.object({ frame: z.record(z.string(), z.unknown()),
      hash: z.string().regex(/^0x[0-9a-f]{64}$/), signature: z.string().regex(/^0x[0-9a-fA-F]{130}$/),
      pngBase64: z.string().max(2800000).optional() }).strict(),
  }).strict().nullable(),
}).strict();

function atomicWrite(file, value) {
  const temporary = `${file}.${randomUUID()}.tmp`;
  const fd = fs.openSync(temporary, 'wx', 0o600);
  try { fs.writeFileSync(fd, canonicalJson(value)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  fs.renameSync(temporary, file);
  if (process.platform === 'linux') {
    const dir = fs.openSync(path.dirname(file), 'r'); try { fs.fsyncSync(dir); } finally { fs.closeSync(dir); }
  }
}

/** Read untrusted files without following leaf symlinks or accepting arbitrary paths/devices. */
export function readPublicFile(directory, name, maxBytes) {
  if (!/^(\d{6}\.(json|jpg|png)|result\.json)$/.test(name)) throw new Error('Unexpected browser report filename');
  const file = path.join(directory, name);
  const before = fs.lstatSync(file);
  if (!before.isFile() || before.isSymbolicLink() || before.size > maxBytes) throw new Error('Unsafe browser report file');
  const fd = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
  try {
    const current = fs.fstatSync(fd);
    if (!current.isFile() || current.size > maxBytes || current.ino !== before.ino || current.dev !== before.dev)
      throw new Error('Browser report changed while opening');
    const bytes = Buffer.alloc(current.size);
    let offset = 0;
    while (offset < bytes.length) { const n = fs.readSync(fd, bytes, offset, bytes.length - offset, offset); if (!n) break; offset += n; }
    if (offset !== bytes.length || fs.fstatSync(fd).size !== current.size) throw new Error('Incomplete browser report');
    return bytes;
  } finally { fs.closeSync(fd); }
}

/** One writer per execution journal. The browser gets only the report mount, never this signer or journal. */
export function createBrowserForwarder({ wallet, account, deployment, agent, endpoint, reportDirectory, stateFile,
  jobId, platform, source = 'production-browser', localOrigins = [], transport = safeFetch, now = () => Date.now() }) {
  assertSupportedDeployment(deployment);
  z.enum(['production-browser', 'development-capture', 'local-browser-worker']).parse(source);
  if (!SOCIAL_PLATFORMS[platform] || !/^[a-f0-9]{64}$/.test(jobId) || !/^0x[0-9a-fA-F]{40}$/.test(agent)) throw new Error('Invalid browser execution identity');
  if (source !== 'production-browser' && deployment.environment !== 'local') throw new Error('Development capture requires a local deployment');
  const operator = typeof account === 'string' ? account : account.address;
  const reportRoot = fs.realpathSync(reportDirectory);
  const journalRoot = path.resolve(path.dirname(stateFile)); fs.mkdirSync(journalRoot, { recursive: true, mode: 0o700 });
  const journal = path.join(fs.realpathSync(journalRoot), path.basename(stateFile));
  if (journal.startsWith(`${reportRoot}${path.sep}`) || reportRoot.startsWith(`${path.dirname(journal)}${path.sep}`) || path.dirname(journal) === reportRoot)
    throw new Error('Signing state and browser output must be disjoint');
  const context = { chainId: deployment.chainId, registry: deployment.registry.toLowerCase(), agent: agent.toLowerCase(),
    operator: operator.toLowerCase(), endpoint, jobId, platform, source, reportRoot };
  const contextHash = digest(canonicalJson(context));
  let state = fs.existsSync(journal) ? cursorSchema.parse(JSON.parse(fs.readFileSync(journal)))
    : { version: 1, contextHash, cursor: 0, sequence: 0, lastTimestamp: 0, sessionId: randomUUID(), previousHash: ZERO, pending: null };
  if (state.contextHash !== contextHash) throw new Error('Browser delivery state belongs to another execution');
  let queue = Promise.resolve();
  const save = next => { atomicWrite(journal, next); state = next; };
  const post = async record => {
    const body = Buffer.from(canonicalJson(record));
    const response = await transport(`${endpoint}/v1/browser/frames`, { method: 'POST', body, localOrigins, maxBytes: 16384,
      headers: { 'Content-Type': 'application/json', 'Content-Length': String(body.length) } });
    if (JSON.parse(response.bytes).accepted !== true) throw new Error('Relay did not acknowledge the frame');
  };
  async function sign(report, image, expired = false) {
    const frame = { version: 'halo.browser-frame.v1', chainId: deployment.chainId, registry: deployment.registry,
      agent, operator, sessionId: state.sessionId, sequence: state.sequence, previousHash: state.previousHash,
      timestamp: expired ? new Date(now()).toISOString() : report.timestamp, source, siteOrigin: SOCIAL_PLATFORMS[platform].origin,
      activity: expired ? 'Browser capture expired during delivery. The recorded image is not presented as a live view.' : report.activity,
      state: expired ? 'error' : report.state, width: image ? report.width : 0, height: image ? report.height : 0,
      mimeType: image ? imageInfo(image).mimeType : null, imageHash: image ? imageDigest(image) : null,
      ...(report.surface?{surface:report.surface}:{}), ...(report.sandbox?{sandbox:report.sandbox}:{}) };
    const message = browserFrameMessage(frame);
    return { frame, hash: keccak256(toHex(message)), signature: await wallet.signMessage({ account, message }),
      ...(image ? { pngBase64: image.toString('base64') } : {}) };
  }
  async function step() {
    if (fs.realpathSync(reportDirectory) !== reportRoot) throw new Error('Browser output mount changed');
    let report;
    let reportHash;
    if (state.pending) {
      const record = state.pending.record, f = record.frame, message = browserFrameMessage(f);
      if (record.hash !== keccak256(toHex(message)) || !await verifyMessage({ address: operator, message, signature: record.signature })
        || f.chainId !== deployment.chainId || f.agent?.toLowerCase() !== context.agent || f.registry?.toLowerCase() !== context.registry
        || f.source !== source || f.siteOrigin !== SOCIAL_PLATFORMS[platform].origin || f.sessionId !== state.sessionId
        || f.sequence !== state.sequence || f.previousHash !== state.previousHash)
        throw new Error('Stored browser delivery is corrupt');
      if (f.imageHash ? !record.pngBase64 || imageDigest(Buffer.from(record.pngBase64, 'base64')) !== f.imageHash : record.pngBase64)
        throw new Error('Stored browser image is corrupt');
      if (now() - Date.parse(f.timestamp) > 240000) {
        // Resolve an uncertain old delivery before resetting the stream. An absent/expired frame is
        // represented by an explicit gap, never replayed with a fresh timestamp and a stale image.
        let retained;
        try { retained = JSON.parse((await transport(`${endpoint}/v1/browser/frames/${record.hash}`, { localOrigins, maxBytes: 16384 })).bytes); }
        catch (error) { if (!(error instanceof SafeFetchHttpError) || error.statusCode !== 404) throw error; }
        if (retained?.hash === record.hash && retained.signature === record.signature) {
          save({ ...state, cursor: state.cursor + 1, sequence: state.sequence + 1, lastTimestamp: Date.parse(f.timestamp), previousHash: record.hash, pending: null });
          return { status: 'recovered', cursor: state.cursor, hash: record.hash };
        }
        if (retained) throw new Error('Relay returned a different retained record');
        reportHash = state.pending.reportHash;
        save({ ...state, pending: null, sequence: 0, lastTimestamp: 0, previousHash: ZERO, sessionId: randomUUID() });
        report = { timestamp: f.timestamp, activity: f.activity, state: 'error', width: 0, height: 0 };
      }
    }
    if (!state.pending) {
      if (!report) {
        const filename = `${String(state.cursor).padStart(6, '0')}.json`;
        let bytes;
        try { bytes = readPublicFile(reportRoot, filename, 8192); }
        catch (error) { if (error.code === 'ENOENT') return { status: 'waiting', cursor: state.cursor }; throw error; }
        report = browserReportSchema.parse(JSON.parse(bytes)); reportHash = digest(bytes);
        if (report.jobId !== jobId || report.sequence !== state.cursor || report.siteOrigin !== SOCIAL_PLATFORMS[platform].origin)
          throw new Error('Browser report belongs to another execution or site');
        if (Date.parse(report.timestamp) > now() + 10000) throw new Error('Browser capture is from the future');
      }
      const expired = now() - Date.parse(report.timestamp) > 240000 || Date.parse(report.timestamp) < state.lastTimestamp;
      let image;
      if (!expired && report.imageFile) {
        image = readPublicFile(reportRoot, report.imageFile, 2000000);
        const info = imageInfo(image);
        if (info.width !== report.width || info.height !== report.height) throw new Error('Browser image dimensions differ from its report');
      }
      const record = await sign(report, image, expired);
      save({ ...state, pending: { reportHash, record } });
    }
    const delivered = state.pending.record;
    await post(delivered);
    save({ ...state, cursor: state.cursor + 1, sequence: state.sequence + 1, lastTimestamp: Date.parse(delivered.frame.timestamp), previousHash: delivered.hash, pending: null });
    return { status: 'delivered', cursor: state.cursor, hash: delivered.hash };
  }
  return { async drain({ limit = 20 } = {}) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error('Invalid delivery batch');
    const operation = queue.then(async () => {
      const results = [];
      for (let i = 0; i < limit; i++) { const result = await step(); results.push(result); if (result.status === 'waiting') break; }
      return results;
    });
    queue = operation.catch(() => {}); return operation;
  } };
}
