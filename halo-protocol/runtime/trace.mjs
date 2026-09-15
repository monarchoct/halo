import { keccak256, toHex } from 'viem';
import { canonicalJson } from '../sdk/manifest.mjs';
import { safeFetch } from '../sdk/safe-fetch.mjs';

export function traceMessage(step) { return `HALO_PUBLIC_STEP_V1\n${canonicalJson(step)}`; }
export function createTracePublisher({ wallet, account, deployment, endpoint, localOrigins = [] }) {
  const runs = new Map();
  const pending = [];
  const operator = typeof account === 'string' ? account : account.address;
  return async event => {
    const previous = runs.get(event.runId);
    const step = { version: 'halo.step.v1', chainId: deployment.chainId, registry: deployment.registry,
      operator, timestamp: new Date().toISOString(), index: previous ? previous.index + 1 : 0,
      previousHash: previous?.hash ?? `0x${'0'.repeat(64)}`, ...event };
    const message = traceMessage(step);
    const signature = await wallet.signMessage({ account, message });
    const hash = keccak256(toHex(message));
    const record = { step, signature, hash };
    // Retry this exact signed item if the response is uncertain; never create a conflicting replacement index.
    runs.set(event.runId, { hash, index: step.index });
    pending.push(record);
    while (pending.length) {
      const body = Buffer.from(canonicalJson(pending[0]));
      await safeFetch(`${endpoint}/v1/steps`, { method: 'POST', body, localOrigins, timeoutMs: 3000,
        headers: { 'Content-Type': 'application/json', 'Content-Length': String(body.length) } });
      pending.shift();
    }
    return record;
  };
}
