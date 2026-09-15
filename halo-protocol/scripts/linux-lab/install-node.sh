#!/usr/bin/env bash
set -euo pipefail
cd /home/halo/lab
curl --fail --location --proto '=https' --tlsv1.2 https://nodejs.org/dist/v22.23.2/node-v22.23.2-linux-x64.tar.xz --output node-v22.23.2-linux-x64.tar.xz
printf '%s\n' 'd60acfe00a2932254bb0ad20e01b0d74397a0875595de719654b214f4b03f307  node-v22.23.2-linux-x64.tar.xz' | sha256sum --check --strict
mkdir -p node
tar -xJf node-v22.23.2-linux-x64.tar.xz --strip-components=1 -C node
/home/halo/lab/node/bin/node --version
