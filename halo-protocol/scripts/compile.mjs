import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import solc from 'solc';
import { compileCore } from './compile-core.mjs';

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
function walk(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const full = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(full) : full.endsWith('.sol') ? [full] : [];
  });
}

export function compile({ test = false } = {}) {
  const sources = Object.fromEntries([
    ...walk(path.join(root, 'contracts')),
    ...(test && fs.existsSync(path.join(root, 'test/fixtures')) ? walk(path.join(root, 'test/fixtures')) : []),
  ].map(file => [path.relative(root, file).replaceAll('\\', '/'), { content: fs.readFileSync(file, 'utf8') }]));
  const input = { language: 'Solidity', sources, settings: {
    optimizer: { enabled: true, runs: 200 }, viaIR: true, evmVersion: 'cancun',
    outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object', 'evm.deployedBytecode.object'] } },
  } };
  const output = JSON.parse(solc.compile(JSON.stringify(input), { import: name => {
    const file = path.join(root, 'node_modules', name);
    return fs.existsSync(file) ? { contents: fs.readFileSync(file, 'utf8') } : { error: `Missing import ${name}` };
  } }));
  for (const error of output.errors ?? []) console.log(error.formattedMessage);
  if ((output.errors ?? []).some(error => error.severity === 'error')) throw new Error('Solidity compilation failed');
  fs.mkdirSync(path.join(root, 'artifacts'), { recursive: true });
  const artifacts = { Halo2Verifier: compileCore() };
  for (const [source, contracts] of Object.entries(output.contracts)) {
    if (!source.startsWith('contracts/') && !source.startsWith('test/')) continue;
    for (const [name, contract] of Object.entries(contracts)) {
      const artifact = { contractName: name, sourceName: source, compiler: solc.version(),
        abi: contract.abi, bytecode: `0x${contract.evm.bytecode.object}`,
        deployedBytecode: `0x${contract.evm.deployedBytecode.object}` };
      if (contract.evm.deployedBytecode.object.length / 2 > 24576) throw new Error(`${name} exceeds EIP-170 code size`);
      artifacts[name] = artifact;
      fs.writeFileSync(path.join(root, 'artifacts', `${name}.json`), `${JSON.stringify(artifact, null, 2)}\n`);
    }
  }
  console.log(`Compiled ${Object.keys(artifacts).length} HALO artifacts with ${solc.version()}`);
  return artifacts;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) compile({ test: process.argv.includes('--test') });
