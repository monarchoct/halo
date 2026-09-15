import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import solc from 'solc';
import { decodeFunctionData, decodeFunctionResult, encodeFunctionData, keccak256, toHex } from 'viem';
import { startChain } from './helpers.mjs';
import { root } from '../scripts/compile.mjs';

const proofDir = path.resolve(process.argv[2] ?? path.join(root, '../../work/core-proof'));
const source = fs.readFileSync(path.join(proofDir, 'CoreVerifier.sol'), 'utf8');
const output = JSON.parse(solc.compile(JSON.stringify({ language: 'Solidity', sources: { 'CoreVerifier.sol': { content: source } },
  settings: { optimizer: { enabled: true, runs: 200 }, evmVersion: 'cancun',
    outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object', 'evm.deployedBytecode.object'] } } } })));
for (const error of output.errors ?? []) console.log(error.formattedMessage);
assert(!(output.errors ?? []).some(error => error.severity === 'error'), 'Generated verifier did not compile');
const verifier = output.contracts['CoreVerifier.sol'].Halo2Verifier;
assert(verifier.evm.deployedBytecode.object.length / 2 <= 24576, 'Verifier exceeds EIP-170');
const data = toHex(fs.readFileSync(path.join(proofDir, 'calldata.bytes')));
const decoded = decodeFunctionData({ abi: verifier.abi, data });
const [proof, instances] = decoded.args;
const benchmark = JSON.parse(fs.readFileSync(path.join(proofDir, 'benchmark.json')));
assert.equal(instances.length, 75);
const commitmentBytes = [...Buffer.from(benchmark.commitment, 'hex')].map(BigInt);
assert.deepEqual(instances.slice(0, 32), commitmentBytes);
assert.deepEqual(instances.slice(32, 42), Array(10).fill(1n));
assert.deepEqual(instances.slice(42, 74), commitmentBytes);
assert.equal(instances[74], 1n);

const env = await startChain();
const { client, wallet, accounts } = env;
try {
  const hash = await wallet.deployContract({ account: accounts[0], abi: verifier.abi,
    bytecode: `0x${verifier.evm.bytecode.object}` });
  const deployed = await client.waitForTransactionReceipt({ hash });
  assert.equal(deployed.status, 'success');
  const address = deployed.contractAddress;
  const verified = await client.call({ account: accounts[0], to: address, data, gas: 5_000_000n });
  assert.equal(decodeFunctionResult({ abi: verifier.abi, functionName: 'verifyProof', data: verified.data }), true);
  const tx = await wallet.sendTransaction({ account: accounts[0], to: address, data, gas: 5_000_000n });
  const receipt = await client.waitForTransactionReceipt({ hash: tx });
  assert.equal(receipt.status, 'success');
  const passed = ['Real EZKL proof accepted by the generated EVM verifier', 'Proof verification executed in a successful EVM transaction'];

  async function rejects(changedProof, changedInstances, label) {
    const changedData = encodeFunctionData({ abi: verifier.abi, functionName: 'verifyProof', args: [changedProof, changedInstances] });
    let rejected = false;
    try {
      const result = await client.call({ account: accounts[0], to: address, data: changedData, gas: 5_000_000n });
      rejected = decodeFunctionResult({ abi: verifier.abi, functionName: 'verifyProof', data: result.data }) === false;
    } catch (error) {
      if (!/revert/i.test(error.message)) throw error;
      rejected = true;
    }
    assert(rejected, label);
    passed.push(label);
    console.log(`PASS ${label}`);
  }
  const changedCommitment = [...instances]; changedCommitment[0] ^= 1n;
  await rejects(proof, changedCommitment, 'Changed action commitment rejected');
  const changedOutput = [...instances]; changedOutput[74] = 0n;
  await rejects(proof, changedOutput, 'Changed authorization output rejected');
  const changedProof = Buffer.from(proof.slice(2), 'hex'); changedProof[0] ^= 1;
  await rejects(toHex(changedProof), instances, 'Corrupted cryptographic proof rejected');
  const evidence = { completedAt: new Date().toISOString(), ezklVersion: benchmark.ezkl_version,
    compiler: solc.version(), modelSha256: benchmark.model_sha256, srsSha256: benchmark.srs_sha256,
    verifierCodeHash: keccak256(await client.getCode({ address })),
    verifierRuntimeBytes: verifier.evm.deployedBytecode.object.length / 2, calldataBytes: (data.length - 2) / 2,
    verificationGas: String(receipt.gasUsed), nativeProofSeconds: benchmark.timings_seconds.prove,
    passed, exclusions: ['Vault adapter binding and authoritative feature reconstruction remain a separate gate',
      'No production deployment, full LLM proof or external audit'] };
  fs.mkdirSync(path.join(root, 'test-results'), { recursive: true });
  fs.writeFileSync(path.join(root, 'test-results/real-proof.json'), `${JSON.stringify(evidence, null, 2)}\n`);
  console.log(`PASS real EZKL/EVM verification: ${receipt.gasUsed} gas, ${evidence.calldataBytes} calldata bytes`);
} finally { await env.stop(); }
