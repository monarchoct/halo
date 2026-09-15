# HALO on one Linux host (Phase 2)

What runs here: PostgreSQL 17, the read API (with the history journal), the operations service (with the social connect surface), both live relays (with PostgreSQL fan-out), one operator, three IPFS peers (the runtime replicates every artifact to at least three stores), and Caddy for HTTPS. The website is served from Cloudflare and points at these hostnames. Browser workspaces are started per agent by the social worker on this same host.

Everything runs from one reviewed image (`deploy/runtime/Dockerfile`, entrypoint modes `api`, `operations`, `relays`, `operator`, `social`, `identity`, `migrate`).

## 1. Host

Any KVM VPS with **4 vCPU / 16 GB / 100 GB NVMe** or more (Hetzner CPX41, Hostinger KVM 4), Ubuntu 24.04, your SSH key. As root:

```bash
bash bootstrap.sh halo.example.com
```

Then `bash set-domain.sh <domain> /srv/halo` stamps the domain into `.env`, every `config/*.json` and `deploy/testnet/config.json`.

DNS: `api`, `operations`, `live`, `screens`, `artifacts`, `inference`, `ipfs-one`, `ipfs-two`, `ipfs-three` as **DNS-only** A records to the host (no Cloudflare proxy); Caddy issues certificates on first request. `inference.<domain>` is only a TLS front for the Akash llama.cpp lease (`HALO_INFERENCE_UPSTREAM` in `.env`); the operator's `publicModels` entry points at it and sends `HALO_INFERENCE_AUTH` (`Bearer <key>`, in `secrets/operator.env`). The operator never speaks plain HTTP off loopback, so its three IPFS peers (`ipfs-one/two/three.<domain>`, bearer-gated RPC fronts) and the live relay (`live.<domain>`) are also reached through Caddy; the shared token lives in `secrets/caddy.env` (`HALO_IPFS_PEER_TOKEN`) and `secrets/operator.env` (`HALO_IPFS_PEER_AUTH=Bearer <token>`).

## 2. Files

```
/srv/halo/
  compose.yaml   Caddyfile   .env          (from this directory)
  config/        api.json operations.json relays.json operator.json migrate.json deployment.json
                 postgres/init/roles.sql   (creates the restricted reader and the operator roles)
  secrets/       postgres_admin  migrate.env  operations.env  relays.env  operator.env  caddy.env  operator.key  social/
```

Templates for every config are in `config/`. `deployment.json` comes from `scripts/deploy-public.mjs`. Secrets are files with mode 0600 owned by `halo`; the `*.env` files carry only database URLs and the X client id/secret, named exactly as the configs' `*Environment` fields.

## 3. Database TLS, migrations and roles (done once)

The runtime refuses unencrypted PostgreSQL outside local mode, so the container runs with `ssl=on`:

```bash
mkdir -p /srv/halo/tls && cd /srv/halo/tls
openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 -nodes -days 3650 -subj "/CN=HALO internal CA" -keyout ca.key -out ca.crt
openssl req -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 -nodes -subj "/CN=postgres" -keyout server.key -out server.csr
printf 'subjectAltName=DNS:postgres\nextendedKeyUsage=serverAuth\n' > san.cnf
openssl x509 -req -in server.csr -CA ca.crt -CAkey ca.key -CAcreateserial -days 3650 -extfile san.cnf -out server.crt
chown 999:999 server.key server.crt && chmod 600 server.key && cp ca.crt /srv/halo/config/postgres-ca.crt
```

Every config's `caFile` points at `postgres-ca.crt`. Then: `docker compose up -d postgres`, `docker compose run --rm migrate`, apply the grants from `services/persistence/README.md` (operator: DML on all tables; social writer: `halo_deployments`, `halo_social_bindings`), install the history journal schema (`psql -f services/history/schema.sql` as admin), and install the operations projection + restricted reader by calling `installOperationsProjection` from `services/operations/install.mjs` with the admin URL — its returned role/password become `HALO_OPERATIONS_READER_URL` in `secrets/operations.env`.

## 4. Bring-up

```bash
sudo -u halo bash -c 'cd /srv/halo && docker compose pull && docker compose up -d'
docker compose ps            # every service healthy
docker compose logs api      # {"service":"halo-public-api",...}
curl -s https://api.halo.example.com/v1/status
```

Then copy `deployment.json` to `halo-web/public/`, build the site, publish it to Cloudflare, and create the first agent (`scripts/create-agent.mjs` with a real creator key, or the website).

## 5. Second host

Repeat on a host under different credentials with its own operator key and state; point it at the same database. Leased jobs guarantee the two never execute the same cycle. Put the API and relays of both behind one load balancer; the relays share streams through PostgreSQL.

## 6. Operating

- Backups: nightly `pg_dump` into `/srv/halo/backups` (cron installed by bootstrap); ship them off-host and **rehearse a restore monthly**.
- Updates: change `HALO_RUNTIME_IMAGE` to the new digest, `docker compose up -d`; migrations run first and the API waits for them.
- Never mount `/var/run/docker.sock` into a workspace container; never put a key into `config/`.
