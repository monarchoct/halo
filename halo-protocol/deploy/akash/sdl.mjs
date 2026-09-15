import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import { z } from 'zod';
import { emitYaml, parseYaml } from './yaml-lite.mjs';

// Akash SDL v2.0 exposes only this field set per service/compute-profile/placement/deployment
// entry (see deploy/akash/README.md). This schema is the allowed-field-set assertion required
// before any generated document is serialized: a generator bug that adds an unsupported key
// (privileged, cap_add, a Docker socket mount, ...) fails here instead of reaching a provider.
const imageRef = z.string().regex(/^[a-z0-9]+(?:[._-][a-z0-9]+)*(?:\/[a-z0-9]+(?:[._-][a-z0-9]+)*)*@sha256:[a-f0-9]{64}$/, 'Use an immutable repository@sha256 digest');
const sdlName = z.string().regex(/^[a-z]([a-z0-9-]*[a-z0-9])?$/);
const sizeString = z.string().regex(/^[1-9]\d*(\.\d+)?(Mi|Gi|Ti)$/);
const envEntry = z.string().regex(/^[A-Z][A-Z0-9_]*=.*$/);
const exposeEntrySchema = z.object({
  port: z.number().int().min(1).max(65535),
  as: z.number().int().min(1).max(65535).optional(),
  proto: z.enum(['TCP', 'UDP']).optional(),
  to: z.array(z.object({ global: z.literal(true) }).strict()).min(1),
}).strict();
const paramsSchema = z.object({
  storage: z.record(sdlName, z.object({ mount: z.string().min(1), readOnly: z.boolean().optional() }).strict()),
}).strict();
const serviceSchema = z.object({
  image: imageRef,
  command: z.array(z.string()).optional(),
  args: z.array(z.string()).optional(),
  env: z.array(envEntry).optional(),
  expose: z.array(exposeEntrySchema).optional(),
  params: paramsSchema.optional(),
}).strict();
const computeStorageSchema = z.object({
  size: sizeString, name: sdlName.optional(),
  attributes: z.object({ persistent: z.literal(true), class: z.enum(['beta1', 'beta2', 'beta3']) }).strict().optional(),
}).strict();
const computeResourcesSchema = z.object({
  cpu: z.object({ units: z.number().positive() }).strict(),
  memory: z.object({ size: sizeString }).strict(),
  storage: z.array(computeStorageSchema).min(1),
  gpu: z.object({
    units: z.number().int().min(0).max(8),
    attributes: z.object({ vendor: z.record(z.string().min(1), z.array(z.object({ model: z.string().min(1) }).strict()).min(1))
      .refine(v => Object.keys(v).every(key => ['nvidia', 'amd'].includes(key)), 'Unsupported GPU vendor') }).strict(),
  }).strict().optional(),
}).strict();
const placementPricingEntry = z.object({ denom: z.string().min(1), amount: z.number().int().positive() }).strict();
const sdlDocumentSchema = z.object({
  version: z.literal('2.0'),
  services: z.record(sdlName, serviceSchema).refine(v => Object.keys(v).length > 0, 'At least one service is required'),
  profiles: z.object({
    compute: z.record(sdlName, z.object({ resources: computeResourcesSchema }).strict()),
    placement: z.record(sdlName, z.object({
      attributes: z.record(z.string(), z.string()).optional(),
      pricing: z.record(sdlName, placementPricingEntry),
    }).strict()),
  }).strict(),
  deployment: z.record(sdlName, z.record(sdlName, z.object({ profile: sdlName, count: z.number().int().min(1).max(50) }).strict())),
}).strict();

/** Validate a plain-object SDL document against the allowed Akash SDL v2.0 field set and serialize it. */
export function servicesSdl({ services, compute, placement, deployment }) {
  const document = sdlDocumentSchema.parse({ version: '2.0', services, profiles: { compute, placement }, deployment });
  for (const [name, entry] of Object.entries(document.deployment)) for (const placementName of Object.keys(entry)) {
    if (!document.profiles.placement[placementName]) throw new Error(`Deployment references unknown placement "${placementName}"`);
    if (!document.profiles.compute[entry[placementName].profile]) throw new Error(`Deployment references unknown compute profile for "${name}"`);
    if (!document.profiles.placement[placementName].pricing[name]) throw new Error(`Placement "${placementName}" has no pricing for service "${name}"`);
  }
  return emitYaml(document);
}

/** Re-parse a generated SDL string and re-validate it, catching any emitter/parser asymmetry. */
export function validateSdlYaml(yamlText) {
  return sdlDocumentSchema.parse(parseYaml(yamlText));
}

const agentAddress = z.string().regex(/^0x[0-9a-fA-F]{40}$/);
const workspaceConfigSchema = z.object({
  agents: z.array(agentAddress).min(1),
  agentsPerDeployment: z.number().int().min(1).max(50).default(10),
  image: imageRef,
  chainId: z.number().int().positive(),
  registry: agentAddress,
  relayUrl: z.string().url(),
  egressListUrl: z.string().url(),
  snapshotBucket: z.string().min(1).max(200),
  volumeSizeGi: z.number().int().min(1).max(1000).default(4),
  volumeClass: z.enum(['beta1', 'beta2', 'beta3']).default('beta2'),
  cpuUnits: z.number().positive().default(0.5),
  memoryGi: z.number().positive().default(1.5),
  ephemeralStorageGi: z.number().positive().default(4),
  pricingDenom: z.string().min(1).default('uakt'),
  pricingAmount: z.number().int().positive().default(1000),
  placementName: sdlName.default('akash'),
}).strict();

/**
 * One workspace shard: up to `agentsPerDeployment` agent "virtual PC" services in one deployment,
 * each with its own persistent profile volume and no inbound expose (egress only, through the
 * configured egress allowlist URL — see runtime/browser/container/egress.example.json).
 */
export function workspaceShardSdl(input) {
  const config = workspaceConfigSchema.parse(input);
  if (config.agents.length > config.agentsPerDeployment) throw new Error(`A workspace shard holds at most ${config.agentsPerDeployment} agents; split the agent list across multiple shards`);
  const services = {}, compute = {}, pricing = {}, deployment = {};
  config.agents.forEach((agent, index) => {
    const name = `agent-${index}`;
    services[name] = {
      image: config.image,
      env: [
        `HALO_AGENT_ADDRESS=${agent}`,
        `HALO_CHAIN_ID=${config.chainId}`,
        `HALO_REGISTRY_ADDRESS=${config.registry}`,
        `HALO_RELAY_URL=${config.relayUrl}`,
        `HALO_EGRESS_LIST_URL=${config.egressListUrl}`,
        `HALO_SNAPSHOT_BUCKET=${config.snapshotBucket}`,
      ],
      params: { storage: { profile: { mount: '/profile', readOnly: false } } },
    };
    compute[name] = { resources: {
      cpu: { units: config.cpuUnits }, memory: { size: `${config.memoryGi}Gi` },
      storage: [{ size: `${config.ephemeralStorageGi}Gi` },
        { size: `${config.volumeSizeGi}Gi`, name: 'profile', attributes: { persistent: true, class: config.volumeClass } }],
    } };
    pricing[name] = { denom: config.pricingDenom, amount: config.pricingAmount };
    deployment[name] = { [config.placementName]: { profile: name, count: 1 } };
  });
  return servicesSdl({ services, compute, placement: { [config.placementName]: { pricing } }, deployment });
}

/** Split an agent list into `agentsPerDeployment`-sized shards and render one SDL document per shard. */
export function workspaceShards(input) {
  const config = workspaceConfigSchema.parse(input);
  const shards = [];
  for (let i = 0; i < config.agents.length; i += config.agentsPerDeployment) shards.push(workspaceShardSdl({ ...config, agents: config.agents.slice(i, i + config.agentsPerDeployment) }));
  return shards;
}

const inferenceConfigSchema = z.object({
  image: imageRef,
  serviceName: sdlName.default('inference'),
  models: z.array(z.string().regex(/^[a-z][a-z0-9]*$/)).min(1).max(16).default(['rtx4090', 'a5000', 'l4', 'a6000']),
  gpuUnits: z.number().int().min(1).max(8).default(1),
  weightsVolumeSizeGi: z.number().int().min(24).max(4000).default(24),
  volumeClass: z.enum(['beta1', 'beta2', 'beta3']).default('beta3'),
  cpuUnits: z.number().positive().default(4),
  memoryGi: z.number().positive().default(24),
  ephemeralStorageGi: z.number().positive().default(8),
  containerPort: z.number().int().min(1).max(65535).default(8080),
  exposedPort: z.number().int().min(1).max(65535).default(443),
  pricingDenom: z.string().min(1).default('uakt'),
  pricingAmount: z.number().int().positive().default(6000),
  placementName: sdlName.default('akash'),
}).strict();

/**
 * Shared GPU inference: one vLLM/llama.cpp-style OpenAI-compatible service with an NVIDIA GPU
 * attribute filter, a persistent weights volume, and an HTTP gateway. The bearer API key that
 * gates this endpoint is provisioned out of band (Console/CLI deploy-time secret), never baked
 * into this generated, version-controlled SDL.
 */
export function inferenceSdl(input) {
  const config = inferenceConfigSchema.parse(input);
  const name = config.serviceName;
  const services = { [name]: {
    image: config.image,
    env: [`HALO_INFERENCE_MODELS=${config.models.join(',')}`],
    expose: [{ port: config.containerPort, as: config.exposedPort, to: [{ global: true }] }],
    params: { storage: { weights: { mount: '/models', readOnly: false } } },
  } };
  const compute = { [name]: { resources: {
    cpu: { units: config.cpuUnits }, memory: { size: `${config.memoryGi}Gi` },
    storage: [{ size: `${config.ephemeralStorageGi}Gi` },
      { size: `${config.weightsVolumeSizeGi}Gi`, name: 'weights', attributes: { persistent: true, class: config.volumeClass } }],
    gpu: { units: config.gpuUnits, attributes: { vendor: { nvidia: config.models.map(model => ({ model })) } } },
  } } };
  const placement = { [config.placementName]: { pricing: { [name]: { denom: config.pricingDenom, amount: config.pricingAmount } } } };
  const deployment = { [name]: { [config.placementName]: { profile: name, count: 1 } } };
  return servicesSdl({ services, compute, placement, deployment });
}

function parseArgs(argv) {
  const flags = {};
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i];
    if (!key?.startsWith('--')) throw new Error(`Unexpected argument: ${key}`);
    flags[key.slice(2)] = argv[i + 1];
  }
  return flags;
}

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  const flags = parseArgs(rest);
  if (command === 'workspace') {
    const shards = workspaceShards({
      agents: (flags.agents ?? '').split(',').map(value => value.trim()).filter(Boolean),
      image: flags.image, chainId: Number(flags['chain-id']), registry: flags.registry,
      relayUrl: flags['relay-url'], egressListUrl: flags['egress-list-url'], snapshotBucket: flags['snapshot-bucket'],
      ...(flags['agents-per-deployment'] ? { agentsPerDeployment: Number(flags['agents-per-deployment']) } : {}),
      ...(flags['volume-size-gi'] ? { volumeSizeGi: Number(flags['volume-size-gi']) } : {}),
    });
    if (!flags.out) throw new Error('Provide --out <file.yaml>');
    if (shards.length === 1) fs.writeFileSync(flags.out, shards[0]);
    else shards.forEach((shard, index) => fs.writeFileSync(flags.out.replace(/(\.ya?ml)?$/, `.shard-${index}$1`), shard));
    console.log(JSON.stringify({ shards: shards.length }));
  } else if (command === 'inference') {
    const yaml = inferenceSdl({ image: flags.image, ...(flags.models ? { models: flags.models.split(',').map(value => value.trim()) } : {}) });
    if (!flags.out) throw new Error('Provide --out <file.yaml>');
    fs.writeFileSync(flags.out, yaml);
    console.log(JSON.stringify({ shards: 1 }));
  } else throw new Error('Usage: node deploy/akash/sdl.mjs workspace|inference --out file.yaml [...flags]');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
