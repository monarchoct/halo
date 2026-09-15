import { createHash } from 'node:crypto';
import { z } from 'zod';
import { decodeEventLog, erc20Abi } from 'viem';
import { canonicalJson } from '../sdk/manifest.mjs';
import { assertSupportedDeployment } from '../sdk/networks.mjs';
import { evidenceUri, identify, parseRawCid } from '../sdk/artifacts.mjs';
import { proposalSchema } from './proposals.mjs';
import { socialBindingSchema } from './browser/schema.mjs';
import { SOCIAL_PLATFORMS } from './browser/social-driver.mjs';

const address = z.string().regex(/^0x[0-9a-fA-F]{40}$/).transform(v => v.toLowerCase());
const hash = z.string().regex(/^0x[0-9a-f]{64}$/);
const uint = z.string().regex(/^(0|[1-9][0-9]{0,77})$/);
const digest = value => createHash('sha256').update(canonicalJson(value)).digest('hex');
export const socialIntentSchema = z.object({ version: z.literal('halo.social-intent.v1'), chainId: z.number().int(), registry: address,
  agent: address, nonce: uint, platform: z.enum(['x', 'fomo']), transactionHash: hash, blockHash: hash, blockNumber: uint,
  child: address, evidenceURI: z.string().max(100).refine(value => { try { parseRawCid(value); return value.startsWith('ipfs://'); } catch { return false; } }),
}).strict();

/** Emitted in the same transaction as confirmed job completion. Hold cycles do not spam social queues. */
export function confirmedLaunchIntents(deployment, result) {
  if (result.status !== 'confirmed' || result.kind !== 'launch') return [];
  return ['x', 'fomo'].map(platform => {
    const payload = socialIntentSchema.parse({ version: 'halo.social-intent.v1', chainId: deployment.chainId, registry: deployment.registry,
      agent: result.agent, nonce: String(result.nonce), platform, transactionHash: result.transactionHash,
      blockHash: result.blockHash, blockNumber: String(result.blockNumber), child: result.child, evidenceURI: result.evidenceURI });
    const key = `${payload.agent}:${payload.nonce}:${platform}`;
    return { topic: 'social-post', dedupeKey: key, streamKey: key, ordinal: 0, payload };
  });
}

export async function verifySocialReceipt({ client, deployment, artifacts, intent, confirmations = 4 }) {
  assertSupportedDeployment(deployment); intent = socialIntentSchema.parse(intent);
  if (intent.chainId !== deployment.chainId || intent.registry !== deployment.registry.toLowerCase()) throw new Error('Social intent belongs to another deployment');
  if (!Number.isInteger(confirmations) || confirmations < 1 || confirmations > 128) throw new Error('Invalid social confirmation target');
  const [chainId, head, receipt, registered] = await Promise.all([client.getChainId(), client.getBlockNumber(),
    client.getTransactionReceipt({ hash: intent.transactionHash }),
    client.readContract({ address: deployment.registry, abi: artifacts.AgentRegistry.abi, functionName: 'isAgent', args: [intent.agent] })]);
  if (chainId !== intent.chainId || !registered || receipt.status !== 'success' || receipt.transactionHash !== intent.transactionHash || receipt.blockHash !== intent.blockHash
    || receipt.blockNumber !== BigInt(intent.blockNumber) || head < receipt.blockNumber + BigInt(confirmations - 1)
    || (await client.getBlock({ blockNumber: receipt.blockNumber })).hash !== receipt.blockHash) throw new Error('Social receipt is not canonically confirmed');
  const events = receipt.logs.filter(log => log.address.toLowerCase() === intent.agent).flatMap(log => {
    try { const e = decodeEventLog({ abi: artifacts.AgentVault.abi, ...log }); return e.eventName === 'ActionExecuted' && e.args.nonce === BigInt(intent.nonce) ? [e] : []; }
    catch { return []; }
  });
  if (events.length !== 1 || Number(events[0].args.kind) !== 1 || events[0].args.child.toLowerCase() !== intent.child
    || evidenceUri(events[0].args.evidenceHash) !== intent.evidenceURI) throw new Error('Social intent does not match its confirmed launch');
}

const plain = value => value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
const shorten = (value, maximum) => {
  if (!Number.isInteger(maximum) || maximum < 1) throw new Error('Transaction link leaves no room for a public thesis');
  return value.length <= maximum ? value : `${value.slice(0, maximum - 1).trimEnd()}…`;
};
export async function prepareSocialPublication({ client, deployment, artifacts, content, intent, confirmations }) {
  intent = socialIntentSchema.parse(intent);
  await verifySocialReceipt({ client, deployment, artifacts, intent, confirmations });
  const bytes = await content.get(intent.evidenceURI);
  if (bytes.length > 262144 || (await identify(bytes)).cid !== parseRawCid(intent.evidenceURI)) throw new Error('Social evidence content mismatch');
  const evidence = JSON.parse(bytes);
  if (evidence.version !== 'halo.decision-evidence.v1' || evidence.chainId !== intent.chainId
    || evidence.registry?.toLowerCase() !== intent.registry || evidence.agent?.toLowerCase() !== intent.agent || evidence.nonce !== intent.nonce)
    throw new Error('Social evidence refers to another agent action');
  const proposal = proposalSchema.parse(evidence.proposal);
  const [name, symbol, parent] = await Promise.all([
    client.readContract({ address: intent.child, abi: erc20Abi, functionName: 'name' }),
    client.readContract({ address: intent.child, abi: erc20Abi, functionName: 'symbol' }),
    client.readContract({ address: intent.agent, abi: artifacts.AgentVault.abi, functionName: 'agentToken' }),
  ]);
  if (proposal.kind !== 'launch' || name !== proposal.name || symbol !== proposal.symbol) throw new Error('Thesis token identity differs from its deployed token');
  let transaction = `Tx: ${intent.transactionHash}`;
  if (deployment.explorerUrl) {
    const explorer = new URL(deployment.explorerUrl);
    if (explorer.protocol !== 'https:' || explorer.username || explorer.password || explorer.pathname !== '/' || explorer.search || explorer.hash)
      throw new Error('Use a public explorer origin for social transaction links');
    transaction = `${explorer.origin}/tx/${intent.transactionHash}`;
  }
  const suffix = `\nVault: ${intent.agent}\n${transaction}`;
  const prefix = `$${symbol} thesis (unverified): `;
  const text = intent.platform === 'x' ? `${prefix}${shorten(plain(proposal.rationale), 280 - prefix.length - suffix.length)}${suffix}`
    : `${plain(name)} ($${symbol})\nAgent thesis (unverified): ${shorten(plain(proposal.rationale), 1300)}\n\nVault: ${intent.agent}\nToken: ${intent.child}\nQuote token: ${parent.toLowerCase()}\nEvidence: ${intent.evidenceURI}\n${transaction}`;
  if (text.length > (intent.platform === 'x' ? 280 : 2000)) throw new Error('Prepared thesis exceeds the platform text budget');
  return { version: 'halo.social-publication.v1', id: digest(intent), platform: intent.platform, agent: intent.agent, nonce: intent.nonce,
    text, intentHash: digest(intent), receipt: intent.transactionHash, evidenceURI: intent.evidenceURI };
}

/** A browser result is not delivery success. Only a reconciled public post completes social delivery. */
export function createSocialHandler({ client, deployment, artifacts, content, store, runBrowser, bindings = async () => undefined,
  confirmations = 4, publish = false }) {
  assertSupportedDeployment(deployment);
  if (publish && deployment.environment === 'local') throw new Error('Local social execution cannot publish external posts');
  return async (payload, delivery, { signal } = {}) => {
    signal?.throwIfAborted();
    const intent = socialIntentSchema.parse(payload);
    const prepared = await prepareSocialPublication({ client, deployment, artifacts, content, intent, confirmations });
    const checkpoint = await store.checkpointDelivery(delivery, { prepared });
    const suppliedBinding = await bindings(intent.agent, intent.platform);
    const binding = suppliedBinding ? socialBindingSchema.parse(suppliedBinding) : undefined;
    if (binding) {
      const profile = new URL(binding.profileUrl);
      if (profile.origin !== SOCIAL_PLATFORMS[intent.platform].origin || profile.username || profile.password
        || profile.search || profile.hash || profile.pathname === '/' || profile.href !== binding.profileUrl)
        throw new Error('Social account must have a canonical public profile on its platform');
    }
    const profileUrl = checkpoint.result?.profileUrl ?? binding?.profileUrl;
    if (profileUrl && binding?.profileUrl !== profileUrl) throw new Error('Publication account cannot change across attempts');
    const previousPossible = checkpoint.result?.externalMutationPossible === true;
    const task = binding ? 'publish' : 'onboard';
    const couldPublish = task === 'publish' && publish;
    await store.checkpointDelivery(delivery, { result: { status: 'browser-started', jobId: prepared.id, ...(profileUrl ? { profileUrl } : {}),
      externalMutationPossible: previousPossible || couldPublish } });
    const execution = await runBrowser({ id: prepared.id, platform: intent.platform, task, chainId: deployment.chainId,
      text: prepared.text, publish, reconcileOnly: previousPossible, ...(binding ? { binding } : {}) }, { agent: intent.agent,
      signal, beforeStart: () => store.checkpointDelivery(delivery),
      verifyReceipt: () => verifySocialReceipt({ client, deployment, artifacts, intent, confirmations }) });
    const browser = execution.result;
    if (!browser || typeof browser.status !== 'string' || browser.status.length > 80) throw new Error('Browser result is missing its bounded outcome');
    const knownNoSubmission = ['needs-account', 'account-mismatch', 'composer-unconfigured', 'site-unavailable', 'site-not-ready', 'drafted'].includes(browser.status)
      || (browser.status === 'failed' && browser.stage === 'startup');
    const result = { status: browser.status, jobId: prepared.id, executionId: execution.executionId, ...(profileUrl ? { profileUrl } : {}),
      ...(browser.postUrl ? { postUrl: browser.postUrl } : {}),
      externalMutationPossible: previousPossible || (couldPublish && !knownNoSubmission),
      reportsDelivered: execution.reportsDelivered === true };
    if (browser.status === 'posted') {
      if (!binding || (!couldPublish && !previousPossible) || browser.profileUrl !== profileUrl || browser.text !== prepared.text
        || typeof browser.postUrl !== 'string' || browser.postUrl.length > 2048) throw new Error('Posted outcome does not match the committed thesis and account');
      const post = new URL(browser.postUrl), profile = new URL(profileUrl);
      if (post.origin !== profile.origin || post.username || post.password || post.search || post.hash
        || post.pathname === '/' || post.href === profile.href
        || (intent.platform === 'x' && !new RegExp(`^${profile.pathname.replace(/\/$/, '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/status/[0-9]+$`).test(post.pathname)))
        throw new Error('Posted outcome has an invalid public permalink');
      return { deliveryStatus: 'posted', result };
    }
    return { deliveryStatus: 'deferred', retrySeconds: ['needs-account', 'account-mismatch', 'drafted'].includes(browser.status) ? 3600 : 300, result };
  };
}
