# HALO on one Linux host (Phase 2)

What runs here: PostgreSQL 17, the read API (with the history journal), the operations service (with the social connect surface), both live relays (with PostgreSQL fan-out), one operator, three-peer-capable IPFS, and Caddy for HTTPS. The website is served from Cloudflare and points at these hostnames. Browser workspaces are started per agent by the social worker on this same host.

Everything runs from one reviewed image (`deploy/runtime/Dockerfile`, entrypoint modes `api`, `operations`, `relays`, `operator`, `social`, `identity`, `migrate`).

## 1. Host

Any KVM VPS with **4 vCPU / 16 GB / 100 GB NVMe** or more (Hetzner CPX41, Hostinger KVM 4), Ubuntu 24.04, your SSH key. As root:

```bash
bash bootstrap.sh halo.example.com
```

DNS: `api`, `operations`, `live`, `screens`, `artifacts` as A records to the host; Caddy issues certificates on first request.

## 2. Files

```
/srv/halo/
  compose.yaml   Caddyfile   .env          (from this directory)
  config/        api.json operations.json relays.json operator.json migrate.json deployment.json
                 postgres/init/roles.sql   (creates the restricted reader and the operator roles)
  secrets/       postgres_admin  migrate.env  operations.env  relays.env  operator.env  operator.key  social/
```

Templates for every config are in `config/`. `deployment.json` comes from `scripts/deploy-public.mjs`. Secrets are files with mode 0600 owned by `halo`; the `*.env` files carry only database URLs and the X client id/secret, named exactly as the configs' `*Environment` fields.

## 3. Bring-up

```bash
sudo -u halo bash -c 'cd /srv/halo && docker compose pull && docker compose up -d'
docker compose ps            # every service healthy
docker compose logs api      # {"service":"halo-public-api",...}
curl -s https://api.halo.example.com/v1/status
```

Then copy `deployment.json` to `halo-web/public/`, build the site, publish it to Cloudflare, and create the first agent (`scripts/create-agent.mjs` with a real creator key, or the website).

## 4. Second host

Repeat on a host under different credentials with its own operator key and state; point it at the same database. Leased jobs guarantee the two never execute the same cycle. Put the API and relays of both behind one load balancer; the relays share streams through PostgreSQL.

## 5. Operating

- Backups: nightly `pg_dump` into `/srv/halo/backups` (cron installed by bootstrap); ship them off-host and **rehearse a restore monthly**.
- Updates: change `HALO_RUNTIME_IMAGE` to the new digest, `docker compose up -d`; migrations run first and the API waits for them.
- Never mount `/var/run/docker.sock` into a workspace container; never put a key into `config/`.
