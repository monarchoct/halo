#!/usr/bin/env bash
set -euo pipefail
umask 077
cd /home/halo/lab/protocol
mkdir -p test-results
if test -e test-results/persistence.json; then
  echo 'Existing acceptance evidence found. Do not overwrite a previous database drill.' >&2
  exit 1
fi
node -e 'const fs=require("fs"),c=require("crypto");for(const [p,h]of Object.entries(JSON.parse(fs.readFileSync("source-manifest.json")))){if(c.createHash("sha256").update(fs.readFileSync(p)).digest("hex")!==h)throw Error("Source hash mismatch: "+p)}console.log("All exported source hashes verified")'
cp scripts/linux-lab/postgres.compose.yaml /home/halo/lab/postgres.compose.yaml
if ! test -e /home/halo/lab/database-password.txt; then
  node -e 'require("fs").writeFileSync("/home/halo/lab/database-password.txt",require("crypto").randomBytes(32).toString("hex"),{mode:0o600,flag:"wx"})'
fi
sudo docker compose -p halo-linux-acceptance -f /home/halo/lab/postgres.compose.yaml up -d --wait --wait-timeout 180
npm ci --ignore-scripts --no-audit --no-fund
npm ci --prefix services/persistence --ignore-scripts --no-audit --no-fund
HALO_TEST_DATABASE_URL="postgresql://halo_lab:$(cat /home/halo/lab/database-password.txt)@127.0.0.1:54329/halo_lab"
export HALO_TEST_DATABASE_URL
node test/persistence.mjs
POSTGRES_CONTAINER=$(sudo docker compose -p halo-linux-acceptance -f /home/halo/lab/postgres.compose.yaml ps -q postgres)
test -n "$POSTGRES_CONTAINER"
sudo docker inspect --format '{{json .Mounts}}' "$POSTGRES_CONTAINER" > test-results/linux-volume-before.json
sudo docker inspect --format '{{.Image}}' "$POSTGRES_CONTAINER" > test-results/linux-postgres-image.txt
sudo docker kill --signal=KILL "$POSTGRES_CONTAINER"
sudo docker start "$POSTGRES_CONTAINER"
node test/persistence-restart.mjs
sudo docker inspect --format '{{json .Mounts}}' "$POSTGRES_CONTAINER" > test-results/linux-volume-after.json
cmp test-results/linux-volume-before.json test-results/linux-volume-after.json
sudo docker logs "$POSTGRES_CONTAINER" > test-results/linux-postgres.log 2>&1
node -e 'const fs=require("fs"),os=require("os");fs.writeFileSync("test-results/linux-platform.json",JSON.stringify({checkedAt:new Date().toISOString(),platform:os.platform(),release:os.release(),node:process.version,scope:"Actual local Linux VM; not independent hosting or GitHub CI"},null,2))'
printf '%s\n' 'PASS same-volume Linux database crash and recovery'
