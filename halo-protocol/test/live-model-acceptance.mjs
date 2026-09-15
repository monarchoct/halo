import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { createPublicClient, decodeEventLog, http } from 'viem';
import { root } from '../scripts/compile.mjs';
import { kuboReplica, replicatedArtifacts, parseRawCid } from '../sdk/artifacts.mjs';
import { canonicalJson } from '../sdk/manifest.mjs';
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const agent = '0x532323de74BAb864b7005D910E5bD8562D038b9b';
const deployment = JSON.parse(fs.readFileSync(path.join(root, 'test-results/trading-deployment.json')));
assert.equal(deployment.rpcUrl, 'http://127.0.0.1:8547'); assert.equal(deployment.chainId, 31337);
const client = createPublicClient({ transport: http(deployment.rpcUrl) }); assert.equal(await client.getChainId(), 31337);
const abi = JSON.parse(fs.readFileSync(path.join(root, 'artifacts/AgentVault.json'))).abi;
const peers = JSON.parse(fs.readFileSync(path.join(root, 'test-results/local-ipfs.json'))).peers;
const replicas = peers.map(apiUrl => kuboReplica({ apiUrl })), store = replicatedArtifacts({ replicas });
const results = [], sources = new Set(), operators = new Set();
for (let nonce = 0; nonce < 3; nonce++) {
  const result = JSON.parse(fs.readFileSync(path.join(root, 'test-results', `model-cycle-${agent.toLowerCase()}-${nonce}.json`)));
  assert.equal(result.status, 'confirmed'); assert.equal(result.nonce, String(nonce));
  const receipt = await client.getTransactionReceipt({ hash: result.transactionHash });
  assert.equal(receipt.status, 'success'); assert.equal((await client.getBlock({ blockNumber: receipt.blockNumber })).hash, receipt.blockHash);
  const event = receipt.logs.filter(log => log.address.toLowerCase() === agent.toLowerCase()).map(log => { try { return decodeEventLog({ abi, ...log }); } catch { return null; } }).find(log => log?.eventName === 'ActionExecuted');
  assert(event); assert.equal(event.args.nonce, BigInt(nonce)); assert.equal(event.args.beneficiary.toLowerCase(), result.operator.toLowerCase());
  assert.equal(event.args.workReward.toString(), result.workReward);
  const evidenceBytes = await store.get(result.evidenceURI), evidence = JSON.parse(evidenceBytes);
  assert.equal(event.args.evidenceHash, `0x${sha(evidenceBytes)}`);
  const transcriptBytes = await store.get(evidence.inference.transcriptURI), transcript = JSON.parse(transcriptBytes);
  const releaseBytes = await store.get(evidence.inference.releaseURI);
  assert.equal(sha(releaseBytes), transcript.releaseSha256); assert.equal(transcript.requestSha256, sha(canonicalJson(transcript.request)));
  assert.deepEqual(JSON.parse(transcript.response.choices[0].message.content), evidence.proposal);
  assert.equal(transcript.response.model, 'halo-qwen35-4b-v1');
  assert.equal(transcript.response.system_fingerprint, 'b10809-5266f24da');
  for (const replica of replicas) assert.deepEqual(await replica.get(parseRawCid(evidence.inference.transcriptURI)), transcriptBytes);
  if (nonce < 2) {
    assert.equal(evidence.proposal.kind, 'launch'); operators.add(result.operator);
    for (const id of evidence.proposal.sourceIds) { assert(!sources.has(id)); sources.add(id); }
  } else { assert.equal(evidence.proposal.kind, 'hold'); assert.equal(JSON.parse(transcript.request.messages[1].content).canLaunch, false); }
  assert(BigInt(result.workReward) > BigInt(result.gasCostWei) + BigInt(result.computeBudgetWei));
  results.push({ nonce, kind: result.kind, child: result.child, name: result.name, transactionHash: result.transactionHash,
    modelSeconds: result.inference.elapsedSeconds, proofSeconds: result.proofSeconds, totalSeconds: result.totalSeconds,
    workReward: result.workReward, gasCostWei: result.gasCostWei, transcriptURI: result.inference.transcriptURI });
}
assert.equal(operators.size, 2); assert.equal(new Set(await Promise.all(replicas.map(replica => replica.identity()))).size, 3);
const report = { version: 'halo.live-model-acceptance.v1', agent, chainId: 31337, releaseSha256: JSON.parse(fs.readFileSync(path.join(root, 'test-results', `model-cycle-${agent.toLowerCase()}-0.json`))).inference.releaseSha256,
  results, modelBackend: 'Actual Qwen3.5-4B Q8_0 on local RTX 5090', sourceMode: 'Live public NASA/GitHub feeds',
  scope: 'Three actual model/proof/execution cycles, two local operators, three IPFS peers on one machine. No public deployment, trained profit strategy or independent cloud hosting.' };
fs.writeFileSync(path.join(root, 'test-results/live-model-acceptance.json'), JSON.stringify(report, null, 2));
console.log('PASS actual GPU inference -> three verified transcripts -> two independent-narrative launches + daily-limit hold -> canonical payments. No new transactions sent by this verification.');
