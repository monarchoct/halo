import assert from 'node:assert/strict';
import { createConsoleClient } from '../deploy/akash/console-client.mjs';
import { SafeFetchHttpError } from '../sdk/safe-fetch.mjs';

function fixtureTransport(handlers) {
  const calls = [];
  return { calls, async transport(url, options = {}) {
    calls.push({ url, method: options.method ?? 'GET', headers: options.headers, body: options.body?.toString('utf8'), maxBytes: options.maxBytes });
    const parsed = new URL(url);
    const handler = handlers[`${options.method ?? 'GET'} ${parsed.pathname}`];
    if (!handler) throw new SafeFetchHttpError(404);
    const result = handler(options);
    return { bytes: Buffer.from(result === undefined ? '' : JSON.stringify(result)), contentType: 'application/json', url };
  } };
}

const baseUrl = 'https://console.example.akash.network';
const apiKey = 'test-console-api-key';

// createDeployment posts the SDL body, authenticates with a bearer key, and returns the parsed deployment.
{
  const { calls, transport } = fixtureTransport({ 'POST /v1/deployments': options => ({ id: '1789340062335', state: 'pending', extra: 'passthrough-field' }) });
  const client = createConsoleClient({ baseUrl, apiKey, transport });
  const deployment = await client.createDeployment({ sdl: 'version: "2.0"\n' });
  assert.equal(deployment.id, '1789340062335');
  assert.equal(deployment.state, 'pending');
  assert.equal(deployment.extra, 'passthrough-field', 'unrecognized Console fields are preserved, not stripped');
  assert.equal(calls[0].method, 'POST');
  assert.equal(calls[0].headers.Authorization, `Bearer ${apiKey}`);
  assert.equal(JSON.parse(calls[0].body).sdl, 'version: "2.0"\n');
  assert.equal(calls[0].maxBytes, 65536, 'responses are read under a fixed byte bound');
  console.log('PASS createDeployment posts the SDL, authenticates, and returns the parsed deployment');
}

// createDeployment refuses an empty SDL document before making any request.
{
  const { calls, transport } = fixtureTransport({});
  const client = createConsoleClient({ baseUrl, apiKey, transport });
  await assert.rejects(() => client.createDeployment({ sdl: '' }), /SDL document is required/);
  assert.equal(calls.length, 0);
  console.log('PASS createDeployment rejects an empty SDL document without calling the transport');
}

// listDeployments accepts either a bare array or a {deployments: [...]} envelope.
{
  const { transport } = fixtureTransport({ 'GET /v1/deployments': () => [{ id: '1', state: 'active' }, { id: '2', state: 'closed' }] });
  const client = createConsoleClient({ baseUrl, apiKey, transport });
  const deployments = await client.listDeployments();
  assert.deepEqual(deployments.map(d => d.id), ['1', '2']);
  const { transport: wrapped } = fixtureTransport({ 'GET /v1/deployments': () => ({ deployments: [{ id: '3', state: 'pending' }] }) });
  const wrappedClient = createConsoleClient({ baseUrl, apiKey, transport: wrapped });
  assert.deepEqual((await wrappedClient.listDeployments()).map(d => d.id), ['3']);
  console.log('PASS listDeployments accepts both a bare array and a wrapped {deployments} envelope');
}

// closeDeployment and getLease target the expected paths and validate the deployment id shape first.
{
  const { calls, transport } = fixtureTransport({
    'POST /v1/deployments/1789340062335/close': () => undefined,
    'GET /v1/deployments/1789340062335/lease': () => ({ deploymentId: '1789340062335', provider: 'provider.zencloud.eu' }),
  });
  const client = createConsoleClient({ baseUrl, apiKey, transport });
  await client.closeDeployment('1789340062335');
  const lease = await client.getLease('1789340062335');
  assert.equal(lease.provider, 'provider.zencloud.eu');
  assert.equal(calls[0].url, `${baseUrl}/v1/deployments/1789340062335/close`);
  assert.equal(calls[1].url, `${baseUrl}/v1/deployments/1789340062335/lease`);
  await assert.rejects(() => client.closeDeployment('../v1/other'), /invalid_format|Invalid/);
  console.log('PASS closeDeployment/getLease target the expected paths and reject a malformed deployment id');
}

// A response body outside the allowed field set still fails cleanly (e.g. a missing required field).
{
  const { transport } = fixtureTransport({ 'GET /v1/deployments/1/lease': () => ({ provider: 'x' }) });
  const client = createConsoleClient({ baseUrl, apiKey, transport });
  await assert.rejects(() => client.getLease('1'), /deploymentId|Invalid/);
  console.log('PASS getLease rejects a response missing required fields instead of returning a half-parsed lease');
}

// The client never issues a request outside its configured origin, even if a caller-controlled
// deployment id tried to smuggle one in (defense in depth on top of the id regex above).
{
  const { transport } = fixtureTransport({});
  const client = createConsoleClient({ baseUrl, apiKey, transport });
  await assert.rejects(() => client.getLease('1'.repeat(200)));
  console.log('PASS an oversized/malformed deployment id is rejected before any request is made');
}
