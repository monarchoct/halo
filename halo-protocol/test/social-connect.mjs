import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodeEventLog, keccak256, parseEther, toHex } from 'viem';
import { startChain } from './helpers.mjs';
import { deploySettlement } from './settlement-fixture.mjs';
import { buildConnectMessage, buildDisconnectMessage, verifyConnectRequest, verifyDisconnectRequest } from '../runtime/social/connect-message.mjs';

// A real local Anvil chain and a real deployed AgentRegistry/AgentVault pair, not mocked
// contract calls. No public chain, external account or social post is touched.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const artifacts = Object.fromEntries(fs.readdirSync(path.join(root, 'artifacts')).filter(name => name.endsWith('.json'))
  .map(name => [name.slice(0, -5), JSON.parse(fs.readFileSync(path.join(root, 'artifacts', name)))]));
const env = await startChain();
const { client, wallet, accounts } = env;
const [deployer, creator, operations, stranger] = accounts;
const passed = [];

const read = (address, contract, functionName, args = []) => client.readContract({ address, abi: artifacts[contract].abi, functionName, args });
async function send(address, contract, functionName, args = [], account = deployer) {
  const { request } = await client.simulateContract({ address, abi: artifacts[contract].abi, functionName, args, account });
  const hash = await wallet.writeContract(request);
  const receipt = await client.waitForTransactionReceipt({ hash });
  assert.equal(receipt.status, 'success');
  return receipt;
}
async function deploy(name, args = []) {
  const hash = await wallet.deployContract({ abi: artifacts[name].abi, bytecode: artifacts[name].bytecode, args, account: deployer });
  const receipt = await client.waitForTransactionReceipt({ hash });
  assert.equal(receipt.status, 'success');
  return receipt.contractAddress;
}

try {
  const weth = await deploy('TestToken');
  const rootToken = await deploy('TestToken');
  const verifier = await deploy('TestDecisionVerifier');
  const adapter = await deploy('TestGraduationAdapter');
  const factory = await deploy('CurveFactory', [rootToken, deployer, adapter]);
  const { settlement } = await deploySettlement({ artifacts, client, accounts, halo: rootToken, weth, factory, deploy, send, read });
  const registry = await deploy('AgentRegistry', [factory, weth, verifier, settlement]);
  const policy = { maxPositionBps: 1000, maxDailyDebitBps: 1000, maxLaunchesPerDay: 1, maxSlippageBps: 300,
    intervalSeconds: 900, workReward: 1_000_000_000_000n, childGraduationTarget: parseEther('1000000') };
  const fees = { tradingBps: 100, operationsBps: 6000, haloBps: 2000, operations, creator };
  const manifestHash = keccak256(toHex('test-only-public-manifest:social-connect'));
  const created = await send(registry, 'AgentRegistry', 'createAgent', ['Nova scout', 'NOVA', manifestHash,
    'ipfs://test-agent-manifest', parseEther('1000000'), policy, fees], creator);
  const createdEvent = created.logs.map(log => { try { return decodeEventLog({ abi: artifacts.AgentRegistry.abi, ...log }); } catch { return null; } })
    .find(log => log?.eventName === 'AgentCreated');
  assert.ok(createdEvent);
  const agent = createdEvent.args.agent;
  assert.equal(await read(registry, 'AgentRegistry', 'isAgent', [agent]), true);
  assert.equal((await read(agent, 'AgentVault', 'creator')).toLowerCase(), creator.toLowerCase());
  passed.push('A real AgentRegistry.createAgent deploys an AgentVault whose immutable creator is the deploying wallet');

  const deployment = { chainId: 31337, environment: 'local', rpcUrl: env.client.transport.url ?? 'http://127.0.0.1', registry };
  let nonceCounter = 0;
  const nextNonce = () => (nonceCounter++).toString(16).padStart(32, '0');
  async function signedRequest({ signer = creator, platform = 'x', profileUrl = 'https://x.com/nova_halo', issuedAtOffsetMs = 0, chainId = deployment.chainId, registryValue = registry } = {}) {
    const payload = { chainId, registry: registryValue, agent, platform, profileUrl, issuedAt: new Date(Date.now() + issuedAtOffsetMs).toISOString(), nonce: nextNonce() };
    const message = buildConnectMessage(payload);
    const signature = await wallet.signMessage({ account: signer, message });
    return { version: 'halo.social-connect.v1', ...payload, signature };
  }

  const valid = await signedRequest();
  const verified = await verifyConnectRequest({ client, artifacts, deployment, request: valid });
  assert.equal(verified.agent, agent.toLowerCase());
  assert.equal(verified.connectedBy, creator.toLowerCase());
  assert.equal(verified.profileUrl, 'https://x.com/nova_halo');
  passed.push('A connect request signed by the real on-chain creator is accepted and its identity recovered correctly');

  await assert.rejects(verifyConnectRequest({ client, artifacts, deployment, request: await signedRequest({ signer: stranger }) }), /creator/);
  await assert.rejects(verifyConnectRequest({ client, artifacts, deployment, request: await signedRequest({ signer: operations }) }), /creator/);
  passed.push('A request signed by any wallet other than the immutable on-chain creator is rejected, including the fee-operations wallet');

  await assert.rejects(verifyConnectRequest({ client, artifacts, deployment, request: await signedRequest({ issuedAtOffsetMs: -11 * 60 * 1000 }) }), /expired/);
  await assert.rejects(verifyConnectRequest({ client, artifacts, deployment, request: await signedRequest({ issuedAtOffsetMs: 11 * 60 * 1000 }) }), /expired/);
  const borderline = await verifyConnectRequest({ client, artifacts, deployment, request: await signedRequest({ issuedAtOffsetMs: -9 * 60 * 1000 }) });
  assert.ok(borderline);
  passed.push('A connect request outside a ten-minute window is rejected in both directions; inside the window it is accepted');

  await assert.rejects(verifyConnectRequest({ client, artifacts, deployment, request: await signedRequest({ chainId: 46630 }) }), /deployment/);
  await assert.rejects(verifyConnectRequest({ client, artifacts, deployment, request: await signedRequest({ registryValue: `0x${'9'.repeat(40)}` }) }), /deployment/);
  passed.push('A request naming a different chain or registry than this deployment is rejected');

  for (const profileUrl of ['https://x.com/nova_halo?ref=share', 'https://x.com/nova_halo#pinned', 'https://user:pass@x.com/nova_halo',
    'https://x.com/', 'https://fomo.family/nova_halo', 'https://not-x.example/nova_halo', 'https://x.com/nova halo', 'not a url at all'])
    await assert.rejects(verifyConnectRequest({ client, artifacts, deployment, request: await signedRequest({ profileUrl }) }));
  passed.push('Query strings, fragments, credentials, the bare root, the wrong platform origin and malformed handles are all rejected');

  const randomAddress = `0x${'7'.repeat(40)}`;
  const notAnAgentRequest = { ...(await signedRequest()), agent: randomAddress };
  const reSigned = { ...notAnAgentRequest, signature: await wallet.signMessage({ account: creator,
    message: buildConnectMessage({ chainId: deployment.chainId, registry, agent: randomAddress, platform: 'x', profileUrl: 'https://x.com/nova_halo', issuedAt: notAnAgentRequest.issuedAt, nonce: notAnAgentRequest.nonce }) }) };
  await assert.rejects(verifyConnectRequest({ client, artifacts, deployment, request: reSigned }));
  passed.push('An address that is not a registered agent in this deployment is rejected even with a validly formed signature');

  // -- Disconnect mirrors connect, without a profile URL in the signed payload --------------
  async function signedDisconnect({ signer = creator, issuedAtOffsetMs = 0 } = {}) {
    const payload = { chainId: deployment.chainId, registry, agent, platform: 'x', issuedAt: new Date(Date.now() + issuedAtOffsetMs).toISOString(), nonce: nextNonce() };
    const message = buildDisconnectMessage(payload);
    const signature = await wallet.signMessage({ account: signer, message });
    return { version: 'halo.social-disconnect.v1', ...payload, signature };
  }
  const verifiedDisconnect = await verifyDisconnectRequest({ client, artifacts, deployment, request: await signedDisconnect() });
  assert.equal(verifiedDisconnect.connectedBy, creator.toLowerCase());
  await assert.rejects(verifyDisconnectRequest({ client, artifacts, deployment, request: await signedDisconnect({ signer: stranger }) }), /creator/);
  await assert.rejects(verifyDisconnectRequest({ client, artifacts, deployment, request: await signedDisconnect({ issuedAtOffsetMs: -20 * 60 * 1000 }) }), /expired/);
  passed.push('Disconnect requests are verified the same way: creator-only, freshness-checked, chain/registry-bound');

  fs.mkdirSync(path.join(root, 'test-results'), { recursive: true });
  fs.writeFileSync(path.join(root, 'test-results/social-connect.json'), JSON.stringify({ checkedAt: new Date().toISOString(),
    chainId: deployment.chainId, registry, agent, creator, scope: 'Real local Anvil chain and deployed AgentRegistry/AgentVault; no public chain or external account', passed }, null, 2));
  console.log(`PASS ${passed.length} social-connect scenarios`);
} finally { await env.stop(); }
