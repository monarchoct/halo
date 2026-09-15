import assert from 'node:assert/strict';
import http from 'node:http';
import { isPublicAddress, safeFetch } from '../sdk/safe-fetch.mjs';
import { publicPythonEnvironment } from '../sdk/python-process.mjs';
import { replicatedArtifacts, identify, evidenceUri } from '../sdk/artifacts.mjs';
import { proposalSchema, customProposal } from '../runtime/proposals.mjs';
import { assertSupportedDeployment } from '../sdk/networks.mjs';

for (const ip of ['127.0.0.1', '10.0.0.1', '169.254.169.254', '100.64.1.1', '192.168.0.1', '0.0.0.0', '224.0.0.1', '::1', 'fd00::1', 'fe80::1', '::ffff:127.0.0.1', '2001:db8::1']) assert.equal(isPublicAddress(ip), false, ip);
for (const ip of ['8.8.8.8', '1.1.1.1', '2606:4700:4700::1111']) assert.equal(isPublicAddress(ip), true);
for (const url of ['http://example.com', 'https://user:pass@example.com', 'https://example.com/#fragment', 'https://127.0.0.1', 'https://[::ffff:127.0.0.1]']) await assert.rejects(() => safeFetch(url));
await assert.rejects(() => safeFetch('https://example.com', { lookup: async () => [{ address: '8.8.8.8', family: 4 }, { address: '127.0.0.1', family: 4 }] }), /non-public/);
const server = http.createServer((request, response) => {
  if (request.url === '/redirect') { response.writeHead(302, { Location: 'http://169.254.169.254/' }); response.end(); }
  else if (request.url === '/large') response.end('x'.repeat(300000));
  else response.end('{"ok":true}');
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
try {
  assert.deepEqual(JSON.parse((await safeFetch(origin, { localOrigins: [origin] })).bytes), { ok: true });
  await assert.rejects(() => safeFetch(`${origin}/redirect`, { localOrigins: [origin] }), /302/);
  await assert.rejects(() => safeFetch(`${origin}/large`, { localOrigins: [origin] }), /byte limit/);
} finally { await new Promise(resolve => server.close(resolve)); }
process.env.HALO_OPERATOR_PRIVATE_KEY = 'test-secret-must-not-inherit';
process.env.AWS_SECRET_ACCESS_KEY = 'test-cloud-key-must-not-inherit';
assert.equal(publicPythonEnvironment().HALO_OPERATOR_PRIVATE_KEY, undefined);
assert.equal(publicPythonEnvironment().AWS_SECRET_ACCESS_KEY, undefined);
delete process.env.HALO_OPERATOR_PRIVATE_KEY; delete process.env.AWS_SECRET_ACCESS_KEY;
const bytes = Buffer.from('{"test":true}'), id = await identify(bytes);
assert.equal(evidenceUri(`0x${id.sha256}`), `ipfs://${id.cid}`);
const fake = name => ({ identity: async () => name, put: async () => id.cid, get: async () => bytes });
await assert.rejects(() => replicatedArtifacts({ replicas: [fake('same-peer-id'), fake('same-peer-id'), fake('same-peer-id')] }).putBytes(bytes), /1\/3/);
const store = replicatedArtifacts({ replicas: [fake('first-peer-id'), fake('second-peer-id'), fake('third-peer-id')] });
assert.equal((await store.putBytes(bytes)).replicas.length, 3);
assert.deepEqual(await store.get(`ipfs://${id.cid}`), bytes);
await assert.rejects(() => replicatedArtifacts({ replicas: [{ ...fake('corrupt-peer'), get: async () => Buffer.from('changed') }], minimumCopies: 1 }).get(`ipfs://${id.cid}`));
const proposal = { version: 'halo.proposal.v1', module: 'test-provider', kind: 'launch', name: 'Orbital Gardens', symbol: 'GARDEN', sourceIds: ['a'.repeat(64)], rationale: 'Test narrative' };
assert.deepEqual(await customProposal('https://example.com/propose', { interests: 'gardens' }, { transport: async () => ({ bytes: Buffer.from(JSON.stringify(proposal)) }) }), proposal);
assert.throws(() => proposalSchema.parse({ ...proposal, transferTo: '0x1234' }));
assert.throws(() => proposalSchema.parse({ ...proposal, kind: 'hold' }));
assert.throws(() => proposalSchema.parse({ ...proposal, name: '💚'.repeat(25) }));
const trade = { ...proposal, kind: 'buy', name: '', symbol: '', child: '0x' + '1'.repeat(40), amount: '1000000000000000000' };
assert.equal(proposalSchema.parse(trade).kind, 'buy');
assert.equal(proposalSchema.parse({ ...trade, kind: 'sell' }).kind, 'sell');
for (const fields of [{ amount: 1 }, { amount: '0' }, { amount: '1e18' }, { amount: '-1' }, { amount: '1.5' },
  { name: 'Launch payload' }, { child: undefined }, { sourceIds: [] }, { recipient: '0x' + '2'.repeat(40) },
  { minOutput: '1' }, { pool: '0x' + '2'.repeat(40) }]) assert.throws(() => proposalSchema.parse({ ...trade, ...fields }));
assert.throws(() => proposalSchema.parse({ ...proposal, amount: '1' }));
await assert.rejects(() => customProposal('http://127.0.0.1/propose', {}));
for (const [environment, chainId] of [['testnet', 46630], ['mainnet', 4663], ['local', 31337]]) assertSupportedDeployment({ environment, chainId, rpcUrl: 'http://127.0.0.1:8545' });
assert.throws(() => assertSupportedDeployment({ environment: 'mainnet', chainId: 1 }));
console.log('PASS runtime boundaries: public egress, private/mapped IP rejection, redirect and size limits, credential isolation, replica identity and content integrity');
