#!/bin/sh
set -eu
# Run outside the browser container. flock releases automatically on process exit.
if [ "$#" -lt 1 ]; then
  printf '%s\n' 'Usage: run-forwarder.sh forwarding.json [--once] [--local-test]' >&2
  exit 64
fi
script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
config=$(realpath -e -- "$1")
shift
state=$(node --input-type=module -e '
  import fs from "node:fs";
  import path from "node:path";
  const file = process.argv[1], config = JSON.parse(fs.readFileSync(file));
  if (typeof config.stateFile !== "string") throw new Error("Missing forwarding state file");
  const state = path.resolve(path.dirname(file), config.stateFile);
  fs.mkdirSync(path.dirname(state), { recursive: true, mode: 0o700 });
  console.log(path.join(fs.realpathSync(path.dirname(state)), path.basename(state)));
' "$config")
exec flock --exclusive --nonblock --conflict-exit-code 75 "$state.lock" node "$script_dir/forward-cli.mjs" "$config" "$@"
