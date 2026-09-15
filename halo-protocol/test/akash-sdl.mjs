import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { workspaceShardSdl, workspaceShards, inferenceSdl, servicesSdl, validateSdlYaml } from '../deploy/akash/sdl.mjs';

const image = `ghcr.io/halo/browser-workspace@sha256:${'a'.repeat(64)}`;
const inferenceImage = `ghcr.io/halo/inference@sha256:${'b'.repeat(64)}`;
const registry = `0x${'2'.repeat(40)}`;
const agents = Array.from({ length: 3 }, (_, i) => `0x${String(i + 1).padStart(40, '0')}`);
const base = { agents, image, chainId: 4663, registry, relayUrl: 'https://relay.halo.example/v1',
  egressListUrl: 'https://cdn.halo.example/browser-egress.json', snapshotBucket: 'halo-agent-profiles' };

// Workspace shard: three agent services, each its own persistent volume, no inbound expose.
{
  const yaml = workspaceShardSdl(base);
  const document = validateSdlYaml(yaml);
  assert.equal(document.version, '2.0');
  assert.equal(Object.keys(document.services).length, 3);
  for (const [name, service] of Object.entries(document.services)) {
    assert.equal(service.expose, undefined, `${name} must not expose an inbound port`);
    assert.equal(service.image, image);
    assert.ok(service.env.some(entry => entry.startsWith('HALO_AGENT_ADDRESS=0x')));
    assert.ok(service.env.some(entry => entry === 'HALO_RELAY_URL=https://relay.halo.example/v1'));
    assert.ok(service.env.some(entry => entry === 'HALO_SNAPSHOT_BUCKET=halo-agent-profiles'));
    assert.deepEqual(document.profiles.compute[name].resources.cpu, { units: 0.5 });
    assert.deepEqual(document.profiles.compute[name].resources.memory, { size: '1.5Gi' });
    const persistent = document.profiles.compute[name].resources.storage.find(entry => entry.attributes?.persistent);
    assert.deepEqual(persistent, { size: '4Gi', name: 'profile', attributes: { persistent: true, class: 'beta2' } });
    assert.deepEqual(service.params.storage.profile, { mount: '/profile', readOnly: false });
  }
  console.log('PASS workspace shard: N agent services, own persistent volume each, no inbound expose');
}

// Distinct agents never share a compute/pricing/deployment key, and the field set stays exact.
{
  const yaml = workspaceShardSdl({ ...base, volumeSizeGi: 8, volumeClass: 'beta3', cpuUnits: 1, memoryGi: 2 });
  const document = validateSdlYaml(yaml);
  assert.deepEqual(Object.keys(document.services), ['agent-0', 'agent-1', 'agent-2']);
  assert.deepEqual(Object.keys(document.deployment), Object.keys(document.services));
  const persistent = document.profiles.compute['agent-0'].resources.storage.find(entry => entry.attributes?.persistent);
  assert.equal(persistent.size, '8Gi'); assert.equal(persistent.attributes.class, 'beta3');
  assert.throws(() => workspaceShardSdl({ ...base, agents: [...agents, ...agents, ...agents, ...agents], agentsPerDeployment: 10 }), /at most 10 agents/);
  console.log('PASS workspace shard: configurable volume size/class and shard-size enforcement');
}

// 100 agents split into 10 shards of 10 agents each.
{
  const hundred = Array.from({ length: 100 }, (_, i) => `0x${(i + 1).toString(16).padStart(40, '0')}`);
  const shards = workspaceShards({ ...base, agents: hundred });
  assert.equal(shards.length, 10);
  const seen = new Set();
  for (const yaml of shards) {
    const document = validateSdlYaml(yaml);
    assert.equal(Object.keys(document.services).length, 10);
    for (const service of Object.values(document.services)) {
      const agentEnv = service.env.find(entry => entry.startsWith('HALO_AGENT_ADDRESS='));
      const agent = agentEnv.slice('HALO_AGENT_ADDRESS='.length);
      assert.ok(!seen.has(agent), 'agent address reused across shards');
      seen.add(agent);
    }
  }
  assert.equal(seen.size, 100);
  console.log('PASS 100-agent config produces 10 workspace shards covering every agent exactly once');
}

// Inference: GPU attributes, persistent weights volume >= 24Gi, HTTP expose.
{
  const yaml = inferenceSdl({ image: inferenceImage });
  const document = validateSdlYaml(yaml);
  const service = document.services.inference;
  assert.deepEqual(service.expose, [{ port: 8080, as: 443, to: [{ global: true }] }]);
  const compute = document.profiles.compute.inference.resources;
  assert.deepEqual(compute.gpu.attributes.vendor.nvidia.map(entry => entry.model), ['rtx4090', 'a5000', 'l4', 'a6000']);
  const weights = compute.storage.find(entry => entry.name === 'weights');
  assert.equal(weights.attributes.persistent, true);
  assert.ok(parseInt(weights.size, 10) >= 24);
  console.log('PASS inference SDL: GPU vendor attributes, >=24Gi persistent weights volume, HTTP expose');
}

// Inference: configurable model list and GPU unit count.
{
  const yaml = inferenceSdl({ image: inferenceImage, models: ['h100'], gpuUnits: 2, weightsVolumeSizeGi: 48 });
  const document = validateSdlYaml(yaml);
  const compute = document.profiles.compute.inference.resources;
  assert.deepEqual(compute.gpu.attributes.vendor.nvidia, [{ model: 'h100' }]);
  assert.equal(compute.gpu.units, 2);
  assert.equal(compute.storage.find(entry => entry.name === 'weights').size, '48Gi');
  console.log('PASS inference SDL: configurable model list and GPU unit count');
}

// The allowed-field-set assertion rejects an unsupported SDL field before serialization.
{
  assert.throws(() => servicesSdl({
    services: { web: { image: inferenceImage, privileged: true } },
    compute: { web: { resources: { cpu: { units: 1 }, memory: { size: '1Gi' }, storage: [{ size: '1Gi' }] } } },
    placement: { akash: { pricing: { web: { denom: 'uakt', amount: 100 } } } },
    deployment: { web: { akash: { profile: 'web', count: 1 } } },
  }), /Unrecognized key|privileged/);
  console.log('PASS servicesSdl rejects fields outside the Akash SDL v2.0 allowed set');
}

// A deployment/placement/pricing reference that does not resolve is rejected even though each
// section is individually well-formed.
{
  assert.throws(() => servicesSdl({
    services: { web: { image: inferenceImage } },
    compute: { web: { resources: { cpu: { units: 1 }, memory: { size: '1Gi' }, storage: [{ size: '1Gi' }] } } },
    placement: { akash: { pricing: { other: { denom: 'uakt', amount: 100 } } } },
    deployment: { web: { akash: { profile: 'web', count: 1 } } },
  }), /no pricing for service/);
  console.log('PASS servicesSdl rejects a deployment that references unpriced or unknown profiles');
}

// The CLI writes 10 shard files for a 100-agent workspace request.
{
  const hundred = Array.from({ length: 100 }, (_, i) => `0x${(i + 1).toString(16).padStart(40, '0')}`);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'halo-akash-sdl-'));
  const out = path.join(dir, 'workspace.yaml');
  try {
    const cli = path.resolve('deploy/akash/sdl.mjs');
    const result = JSON.parse(execFileSync(process.execPath, [cli, 'workspace',
      '--agents', hundred.join(','), '--image', image, '--chain-id', '4663', '--registry', registry,
      '--relay-url', base.relayUrl, '--egress-list-url', base.egressListUrl, '--snapshot-bucket', base.snapshotBucket,
      '--out', out], { encoding: 'utf8' }));
    assert.equal(result.shards, 10);
    const files = fs.readdirSync(dir).filter(name => name.startsWith('workspace.shard-'));
    assert.equal(files.length, 10);
    for (const file of files) validateSdlYaml(fs.readFileSync(path.join(dir, file), 'utf8'));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  console.log('PASS CLI: workspace --agents (100) --out writes 10 valid shard files');
}
