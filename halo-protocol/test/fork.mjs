import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { keccak256 } from 'viem';
import { compile, root } from '../scripts/compile.mjs';
import { startChain } from './helpers.mjs';
import { runV4Scenarios } from './v4.test.mjs';
import { gasWithHeadroom } from '../sdk/transaction-gas.mjs';

// Upstream RPC is read-only. All deployments and trades run on isolated local chain 31337.
const rpcUrl = process.env.ROBINHOOD_RPC_URL ?? 'https://rpc.mainnet.chain.robinhood.com';
const manager = '0x8366a39cc670b4001a1121b8f6a443a643e40951';
async function upstream(method, params = []) {
  const response = await fetch(rpcUrl, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }), signal: AbortSignal.timeout(20000) });
  if (!response.ok) throw new Error(`Robinhood RPC HTTP ${response.status}`);
  const value = await response.json();
  if (value.error) throw new Error(JSON.stringify(value.error));
  return value.result;
}
assert.equal(await upstream('eth_chainId'), '0x1237');
const block = await upstream('eth_getBlockByNumber', ['latest', false]);
const code = await upstream('eth_getCode', [manager, block.number]);
assert(code.length > 2, 'Official PoolManager has no code');
console.log(`Robinhood read-only fork at block ${BigInt(block.number)}, PoolManager ${keccak256(code)}`);
const artifacts = process.argv.includes('--no-compile')
  ? Object.fromEntries(fs.readdirSync(path.join(root, 'artifacts')).filter(name => name.endsWith('.json'))
    .map(name => [name.slice(0, -5), JSON.parse(fs.readFileSync(path.join(root, 'artifacts', name)))]))
  : compile({ test: true });
const env = await startChain({ forkUrl: rpcUrl, forkBlock: BigInt(block.number) });
const { client, wallet, accounts } = env;
const [deployer] = accounts;
let transactions = 0;
const passed = [];
const read = (address, contract, functionName, args = []) => client.readContract({ address, abi: artifacts[contract].abi, functionName, args });
async function send(address, contract, functionName, args = [], account = deployer) {
  const { request } = await client.simulateContract({ address, abi: artifacts[contract].abi, functionName, args, account });
  const hash = await wallet.writeContract({ ...request, gas: gasWithHeadroom(await client.estimateContractGas(request)) });
  const receipt = await client.waitForTransactionReceipt({ hash });
  assert.equal(receipt.status, 'success'); transactions++;
  return receipt;
}
async function deploy(name, args = []) {
  const hash = await wallet.deployContract({ abi: artifacts[name].abi, bytecode: artifacts[name].bytecode, args, account: deployer });
  const receipt = await client.waitForTransactionReceipt({ hash });
  assert.equal(receipt.status, 'success'); transactions++;
  return receipt.contractAddress;
}
async function rejects(address, contract, functionName, args, reason, account = deployer) {
  await assert.rejects(() => client.simulateContract({ address, abi: artifacts[contract].abi, functionName, args, account }),
    error => error.message.includes(reason));
}
const pass = name => { passed.push(name); console.log(`PASS ${name}`); };
try {
  assert.equal(keccak256(await client.getCode({ address: manager })), keccak256(code));
  const rootToken = await deploy('TestToken');
  await runV4Scenarios({ artifacts, client, accounts, rootToken, deploy, send, read, rejects, pass, managerAddress: manager });
  const evidence = { completedAt: new Date().toISOString(), upstreamChain: 4663, localExecutionChain: 31337,
    forkBlock: String(BigInt(block.number)), blockHash: block.hash, poolManager: manager,
    poolManagerCodeHash: keccak256(code), transactions, passed, mainnetTransactions: 0,
    exclusions: ['Not a production deployment or external audit', 'No full agent/proof/runtime integration exercised by this fork test'] };
  fs.writeFileSync(path.join(root, 'test-results', 'robinhood-fork.json'), `${JSON.stringify(evidence, null, 2)}\n`);
  console.log(`PASS Robinhood fork: ${transactions} local transactions; zero mainnet transactions`);
} finally { await env.stop(); }
