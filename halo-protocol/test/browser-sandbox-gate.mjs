import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { browserReportSchema } from '../runtime/browser/schema.mjs';
import { createReportWriter } from '../runtime/browser/report-writer.mjs';
import { createBrowserForwarder } from '../runtime/browser/forwarder.mjs';
import { containerRunnerSchema } from '../runtime/browser/container-runner.mjs';
import { SafeFetchHttpError } from '../sdk/safe-fetch.mjs';

// The schema accepts the two documented sandbox states and nothing else.
{
  const base = { version: 'halo.browser-report.v1', jobId: 'a'.repeat(64), sequence: 0, timestamp: new Date().toISOString(),
    siteOrigin: 'https://fomo.family', activity: 'x', state: 'private', width: 0, height: 0 };
  assert.equal(browserReportSchema.parse({ ...base, sandbox: 'kernel' }).sandbox, 'kernel');
  assert.equal(browserReportSchema.parse({ ...base, sandbox: 'container-only' }).sandbox, 'container-only');
  assert.equal(browserReportSchema.parse(base).sandbox, undefined, 'sandbox stays optional (unchanged default behaviour)');
  assert.throws(() => browserReportSchema.parse({ ...base, sandbox: 'none' }));
  console.log('PASS browserReportSchema: sandbox is optional and only accepts kernel|container-only');
}

// containerRunnerSchema: unsandboxed defaults to false (unchanged default behaviour) and is explicit opt-in only.
{
  assert.equal(containerRunnerSchema.parse({ image: `x@sha256:${'a'.repeat(64)}`, stateDirectory: 'd', deploymentFile: 'f',
    egressFile: 'e', endpoint: 'https://relay.example', operatorAddress: `0x${'1'.repeat(40)}` }).unsandboxed, false);
  assert.equal(containerRunnerSchema.parse({ image: `x@sha256:${'a'.repeat(64)}`, stateDirectory: 'd', deploymentFile: 'f',
    egressFile: 'e', endpoint: 'https://relay.example', operatorAddress: `0x${'1'.repeat(40)}`, unsandboxed: true }).unsandboxed, true);
  console.log('PASS containerRunnerSchema: unsandboxed defaults false, explicit true is accepted');
}

// createReportWriter records the configured sandbox surface on every report, public or private.
{
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'halo-sandbox-gate-'));
  const job = { id: 'b'.repeat(64), platform: 'fomo', display: 'browser' };
  const writer = createReportWriter({ job, directory, sandbox: 'container-only' });
  await writer.report({ activity: 'starting', state: 'private' });
  await writer.close();
  const record = JSON.parse(fs.readFileSync(path.join(directory, '000000.json'), 'utf8'));
  assert.equal(record.sandbox, 'container-only');
  browserReportSchema.parse(record);
  fs.rmSync(directory, { recursive: true, force: true });
  console.log('PASS createReportWriter stamps every report with its configured sandbox surface');
}

// createReportWriter defaults to no sandbox field at all when unset (kernel-sandboxed default path).
{
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'halo-sandbox-gate-'));
  const job = { id: 'c'.repeat(64), platform: 'fomo', display: 'browser' };
  const writer = createReportWriter({ job, directory });
  await writer.report({ activity: 'starting', state: 'private' });
  await writer.close();
  const record = JSON.parse(fs.readFileSync(path.join(directory, '000000.json'), 'utf8'));
  assert.equal('sandbox' in record, false);
  fs.rmSync(directory, { recursive: true, force: true });
  console.log('PASS createReportWriter omits sandbox entirely when not configured (default unchanged)');
}

// The signed, delivered frame carries the sandbox field through to what a viewer ultimately sees.
{
  const deployment = { environment: 'local', chainId: 31337, rpcUrl: 'http://127.0.0.1:8545', registry: `0x${'2'.repeat(40)}` };
  const agent = `0x${'3'.repeat(40)}`;
  const account = privateKeyToAccount(generatePrivateKey());
  const wallet = { signMessage: args => account.signMessage({ message: args.message }) };
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'halo-sandbox-gate-forward-'));
  const reports = path.join(base, 'public'), stateFile = path.join(base, 'operator', 'delivery.json');
  fs.mkdirSync(reports, { recursive: true });
  const jobId = 'd'.repeat(64);
  const deliveries = [];
  async function transport(url, options = {}) {
    if (options.method === 'POST') { deliveries.push(JSON.parse(options.body)); return { bytes: Buffer.from(JSON.stringify({ accepted: true })) }; }
    throw new SafeFetchHttpError(404);
  }
  const record = { version: 'halo.browser-report.v1', jobId, sequence: 0, timestamp: new Date().toISOString(),
    siteOrigin: 'https://fomo.family', state: 'private', activity: 'Starting with the kernel sandbox disabled.',
    width: 0, height: 0, sandbox: 'container-only' };
  browserReportSchema.parse(record);
  fs.writeFileSync(path.join(reports, '000000.json'), JSON.stringify(record));
  const forwarder = createBrowserForwarder({ wallet, account, deployment, agent, endpoint: 'http://127.0.0.1:8792',
    reportDirectory: reports, stateFile, jobId, platform: 'fomo', source: 'development-capture',
    localOrigins: ['http://127.0.0.1:8792'], transport });
  const [result] = await forwarder.drain();
  assert.equal(result.status, 'delivered');
  assert.equal(deliveries[0].frame.sandbox, 'container-only');
  fs.rmSync(base, { recursive: true, force: true });
  console.log('PASS the delivered, signed frame carries the sandbox surface through to the relay payload');
}
