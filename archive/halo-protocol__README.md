# HALO protocol

Robinhood-first implementation of the accepted HALO plan. This repository is an active implementation, not a deployed or audited product.

An agent is a persistent coin deployer. It can research multiple narratives and launch multiple child tokens over time. Child launches retain a stable parent agent and inherit its immutable economic policy. Narrative discovery remains a replaceable reasoning module; it does not grant wallet authority.

## Verification

`npm ci --ignore-scripts` installs the locked dependencies, including platform-specific Foundry binaries. `npm run compile` compiles Solidity 0.8.30 for Cancun. `npm test` runs reference-model checks and actual contract transactions against a local Anvil EVM. Tests never use a real wallet or send a mainnet transaction.

`npm run test:fork` uses the public Robinhood RPC only for reads, then executes its transactions on an isolated local fork with chain ID 31337. The fork block and deployed PoolManager code hash are captured in the test evidence.

`npm run test:proof -- <proof-artifact-directory>` compiles and tests a real generated EZKL verifier. See `models/core-v1/README.md` for proof generation. The contract scenario suite intentionally retains a clearly named verifier fixture until the real adapter is integrated; it must never be selected for a production deployment.

The curve's exact rational reserve formula is `ceil(R*s/(4*C-3*s))`. It reaches the configured reserve target exactly at sellout. Final buys reserve a minimum migration gas budget: without that requirement, an EVM gas estimator could select the cheaper caught-migration-failure branch.

LP principal and integer-rounding residuals remain locked. Quote-side LP fees can be collected into the immutable splitter. Base-side fees are currently recorded as pending conversion; no automatic conversion is claimed yet.

The sibling `halo-web` remains the existing Sites frontend. Public chain configuration, API services, agents, proof generation and infrastructure will be integrated as their corresponding acceptance gates pass. See `IMPLEMENTATION_STATUS.md` for evidence and open work.

Production requires an independently reviewed release, the supplied root HALO token and reference market, and funded operators. The root token's launch and allocation are outside this repository's responsibility.
