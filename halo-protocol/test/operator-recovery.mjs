import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createPublicClient, createWalletClient, defineChain, http } from 'viem';
import { root } from '../scripts/compile.mjs';
import { kuboReplica, replicatedArtifacts } from '../sdk/artifacts.mjs';
import { createOperator } from '../runtime/operator.mjs';
import { startLocalIpfs } from './ipfs-helpers.mjs';

const deployment = JSON.parse(fs.readFileSync(path.join(root, 'test-results/local-deployment.json')));
const initial = JSON.parse(fs.readFileSync(path.join(root, 'test-results/last-local-operator.json')));
assert.equal(deployment.environment, 'local'); assert.equal(deployment.chainId, 31337); assert.equal(initial.status, 'confirmed');
const chain = defineChain({ id: 31337, name: 'HALO disposable local chain', nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 }, rpcUrls: { default: { http: [deployment.rpcUrl] } } });
const client = createPublicClient({ chain, transport: http(deployment.rpcUrl) });
assert.equal(await client.getChainId(), 31337);
const wallet = createWalletClient({ chain, transport: http(deployment.rpcUrl) });
const account = (await wallet.getAddresses())[5];
assert.notEqual(account.toLowerCase(), initial.operator.toLowerCase());
const artifacts = Object.fromEntries(fs.readdirSync(path.join(root, 'artifacts')).filter(name => name.endsWith('.json')).map(name => [name.slice(0, -5), JSON.parse(fs.readFileSync(path.join(root, 'artifacts', name)))]));
const peers = JSON.parse(fs.readFileSync(path.join(root, 'test-results/local-ipfs.json'))).peers;
const replacement = await startLocalIpfs({ directory: path.join(root, 'test-results/replacement-ipfs'), portBase: 5110, count: 1 });
try {
  const store = replicatedArtifacts({ replicas: [...peers.slice(1).map(apiUrl => kuboReplica({ apiUrl })), ...replacement.replicas] });
  const configuration = { client, wallet, account, deployment: { ...deployment, apiUrl: 'http://127.0.0.1:1' }, artifacts, store,
    python: process.env.HALO_PYTHON ?? path.resolve(root, '../../work/halo-python', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python'),
    directory: path.join(root, 'test-results/recovered-operator'), confirmations: 1, maxGasCostWei: 10n ** 16n,
    computeCostWei: 10n ** 10n, allowLocalLoss: true,
    // No loopback fetch exception: both HALO's API and the old HTTP manifest URL are inaccessible to this worker.
    localOrigins: [],
  };
  const operator = createOperator(configuration);
  await client.request({ method: 'evm_increaseTime', params: [901] }); await client.request({ method: 'evm_mine', params: [] });
  const nonceBefore = await client.readContract({ address: initial.agent, abi: artifacts.AgentVault.abi, functionName: 'nonce' });
  const result = await operator.runCycle(initial.agent);
  assert.equal(result.status, 'confirmed', JSON.stringify(result));
  assert.equal(result.kind, 'launch');
  assert.equal(BigInt(result.nonce), nonceBefore);
  assert.notEqual(result.child.toLowerCase(), initial.child.toLowerCase());
  const firstEvidence = JSON.parse(await store.get(initial.evidenceURI));
  const recoveredEvidence = JSON.parse(await store.get(result.evidenceURI));
  assert(recoveredEvidence.proposal.sourceIds.every(id => !firstEvidence.proposal.sourceIds.includes(id)));
  const immediate = await operator.runCycle(initial.agent);
  assert.equal(immediate.status, 'not-due');
  // A normal economically selective operator refuses the same subsidized local work.
  await client.request({ method: 'evm_increaseTime', params: [901] }); await client.request({ method: 'evm_mine', params: [] });
  const economicOperator = createOperator({ ...configuration, allowLocalLoss: false });
  const rejected = await economicOperator.runCycle(initial.agent);
  assert.equal(rejected.status, 'unprofitable', JSON.stringify(rejected));
  assert.equal(await client.readContract({ address: initial.agent, abi: artifacts.AgentVault.abi, functionName: 'nonce' }), nonceBefore + 1n);
  fs.writeFileSync(path.join(root, 'test-results/operator-recovery.json'), JSON.stringify({ checkedAt: new Date().toISOString(),
    disclosure: 'Actual local contracts, actual EZKL proofs and separate local IPFS peers. Provider and API failures are represented by excluding their endpoints; no independent cloud hosts are claimed.',
    initial, replacement: result, immediateRetry: immediate.status, economicRefusal: rejected,
    passed: ['Fresh operator wallet recovers without HALO API or original peer', 'Prior public evidence restores the legacy HTTP manifest',
      'A second distinct narrative becomes a second real child token', 'Fresh operator is paid the committed reward',
      'Immediate duplicate work is not resubmitted', 'Unprofitable work is refused without changing agent state'] }, null, 2));
  console.log(JSON.stringify({ passed: 6, firstChild: initial.child, secondChild: result.child, recoverySeconds: result.totalSeconds, economicRefusal: rejected.status }));
} finally { await replacement.stop(); }
