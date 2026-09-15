import { decodeEventLog } from 'viem';
import { chainReader, jsonSafe } from '../sdk/chain-reader.mjs';
import { evidenceUri } from '../sdk/artifacts.mjs';
import { LeaseLostError } from '../services/persistence/store.mjs';
import { confirmedLaunchIntents } from './social.mjs';
import { verifiedActionCosts } from '../sdk/action-costs.mjs';

/** A database coordinates one operator group. Other groups remain permissionless;
 * the vault nonce, not this database, prevents repeated on-chain execution. */
export function createScheduler({ client, deployment, artifacts, operator, store, workerId, confirmations = 4, leaseSeconds = 180 }) {
  if (!Number.isInteger(confirmations) || confirmations < 1 || confirmations > 128) throw new Error('Invalid confirmation target');
  if (!Number.isInteger(leaseSeconds) || leaseSeconds < 15 || leaseSeconds > 3600) throw new Error('Invalid operator lease duration');
  const reader = chainReader({ client, deployment, artifacts });
  const safeHead = async () => { const head = await client.getBlock(); return head.number >= BigInt(confirmations - 1) ? head.number - BigInt(confirmations - 1) : 0n; };
  async function verifiedReceipt(agent, nonce, hash, observationHash) {
    const receipt = await client.getTransactionReceipt({ hash });
    if (receipt.status !== 'success' || receipt.blockNumber > await safeHead()) return null;
    const block = await client.getBlock({ blockNumber: receipt.blockNumber });
    if (block.hash !== receipt.blockHash) return null;
    const executed = receipt.logs.filter(log => log.address.toLowerCase() === agent.toLowerCase()).map(log => {
      try { return decodeEventLog({ abi: artifacts.AgentVault.abi, ...log }); } catch { return null; }
    }).find(event => event?.eventName === 'ActionExecuted' && event.args.nonce === BigInt(nonce));
    if (!executed) throw new Error('Receipt does not contain the queued agent action');
    const costs = await verifiedActionCosts({ client, agent, abi: artifacts.AgentVault.abi, receipt, executed,
      deploymentBlock: deployment.deploymentBlock, observationHash });
    return jsonSafe({ status: 'confirmed', agent, nonce: BigInt(nonce), transactionHash: hash, blockNumber: receipt.blockNumber,
      blockHash: receipt.blockHash, kind: ['hold','launch','buy','sell'][Number(executed.args.kind)], child: executed.args.child,
      evidenceURI: evidenceUri(executed.args.evidenceHash), operator: executed.args.beneficiary, workReward: executed.args.workReward,
      actionCommitment: executed.args.actionCommitment, gasUsed: receipt.gasUsed, ...costs });
  }
  async function reconcile(job) {
    const head = await safeHead();
    const current = await client.readContract({ address: job.agent, abi: artifacts.AgentVault.abi, functionName: 'nonce', blockNumber: head });
    if (current <= BigInt(job.nonce)) return null;
    // Full backfill is required here: a restarted operator may have missed the receipt
    // long before the API's recent-history window. The indexed path will accelerate it.
    for (let from = BigInt(deployment.deploymentBlock); from <= head; from += 5000n) {
      const events = await client.getContractEvents({ address: job.agent, abi: artifacts.AgentVault.abi, eventName: 'ActionExecuted', args: { nonce: BigInt(job.nonce) },
        fromBlock: from, toBlock: from + 4999n > head ? head : from + 4999n, strict: true });
      if (events.length > 1) throw new Error('Multiple canonical events claim the same agent nonce');
      if (events.length) { const result = await verifiedReceipt(job.agent, job.nonce, events[0].transactionHash); return result ? { ...result, recovered: true, computeBudgetWei: null } : null; }
    }
    throw new Error('Advanced agent nonce has no recoverable canonical receipt');
  }
  async function complete(job, result) {
    const entry = { topic: 'operator-receipt', dedupeKey: `${job.agent}:${job.nonce}`, streamKey: `${job.agent}:${job.nonce}`, ordinal: 0,
      payload: { version: 'halo.operator-receipt.v1', ...result } };
    await store.complete(job, result, [entry, ...confirmedLaunchIntents(deployment, result)]); return result;
  }
  return {
    async scan({ offset = 0, limit = 20 } = {}) {
      await reader.status();
      const page = await reader.agents({ offset, limit });
      const block = await client.getBlock({ blockNumber: page.observedBlock });
      const queued = [];
      for (const agent of page.agents) {
        if (!agent.active) continue;
        const due = agent.lastExecutedAt + BigInt(agent.policy.intervalSeconds);
        const delaySeconds = agent.lastExecutedAt === 0n || due <= block.timestamp ? 0 : Math.min(86400, Number(due - block.timestamp));
        queued.push(await store.enqueue({ agent: agent.address, nonce: agent.nonce,
          payload: { version: 'halo.agent-cycle.v1', nonce: agent.nonce.toString() }, delaySeconds }));
      }
      return { total: page.total, queued: queued.length, nextOffset: offset + page.agents.length >= page.total ? 0 : offset + page.agents.length };
    },
    async workOnce({ agent } = {}) {
      const job = await store.claim(workerId, leaseSeconds, { agent });
      if (!job) return { status: 'idle' };
      let lost = false, renewal = Promise.resolve();
      const interval = setInterval(() => {
        renewal = renewal.then(() => store.renew(job, leaseSeconds)).catch(() => { lost = true; });
      }, Math.floor(leaseSeconds * 1000 / 3));
      const guard = async () => { if (lost) throw new LeaseLostError(); await store.assertLease(job); };
      try {
        await reader.status();
        const recovered = await reconcile(job);
        if (recovered) { await guard(); return await complete(job, recovered); }
        const result = await operator.runCycle(job.agent, { expectedNonce: job.nonce, beforeSubmit: guard,
          onSubmitted: hash => store.submitted(job, hash) });
        await guard();
        if (result.status === 'confirmed') {
          const checked = await verifiedReceipt(job.agent, job.nonce, result.transactionHash, result.observationTransactionHash);
          if (!checked || checked.operator.toLowerCase() !== result.operator.toLowerCase()) throw new Error('Operator result is not canonically confirmed');
          return await complete(job, { ...result, ...checked });
        }
        await store.retry(job, { delaySeconds: 30, reason: result.status });
        return { ...result, jobId: job.id };
      } catch (error) {
        if (error instanceof LeaseLostError || lost) return { status: 'lease-lost', jobId: job.id };
        try { await store.retry(job, { delaySeconds: 30, reason: 'execution-or-reconciliation-unavailable' }); }
        catch { return { status: 'lease-lost', jobId: job.id }; }
        return { status: 'retryable-error', jobId: job.id };
      } finally { clearInterval(interval); await renewal; }
    },
  };
}
