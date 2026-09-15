import fs from 'node:fs';
import path from 'node:path';
import solc from 'solc';
import { keccak256 } from 'viem';
import { fileURLToPath } from 'node:url';

export function compileCore() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  if (!solc.version().startsWith('0.8.30+commit.73712a01')) throw new Error('Unexpected Solidity compiler');
  // EZKL's generated assembly uses its own memory layout and must use the legacy pipeline.
  // Do not label it memory-safe to make viaIR compilation pass.
  const source = fs.readFileSync(path.join(root, 'models/core-v1/Halo2Verifier.sol'), 'utf8');
  const output = JSON.parse(solc.compile(JSON.stringify({ language: 'Solidity',
    sources: { 'Halo2Verifier.sol': { content: source } }, settings: {
      optimizer: { enabled: true, runs: 200 }, viaIR: false, evmVersion: 'cancun',
      outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object', 'evm.deployedBytecode.object'] } },
    } })));
  if ((output.errors ?? []).some(error => error.severity === 'error')) {
    throw new Error(output.errors.map(error => error.formattedMessage).join('\n'));
  }
  const value = output.contracts['Halo2Verifier.sol'].Halo2Verifier;
  const artifact = { contractName: 'Halo2Verifier', sourceName: 'Halo2Verifier.sol', compiler: solc.version(),
    abi: value.abi, bytecode: `0x${value.evm.bytecode.object}`, deployedBytecode: `0x${value.evm.deployedBytecode.object}` };
  if (value.evm.deployedBytecode.object.length / 2 > 24576) throw new Error('Core verifier exceeds EIP-170');
  artifact.runtimeCodeHash = keccak256(artifact.deployedBytecode);
  fs.mkdirSync(path.join(root, 'artifacts'), { recursive: true });
  fs.writeFileSync(path.join(root, 'artifacts/Halo2Verifier.json'), JSON.stringify(artifact, null, 2) + '\n');
  return artifact;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(compileCore().runtimeCodeHash);
}
