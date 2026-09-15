#!/usr/bin/env bash
# Prepare a fresh Ubuntu 24.04 host for the HALO stack. Run once as root: bash bootstrap.sh <public-domain>
# Installs Docker, creates the unprivileged service user, opens only 22/80/443, and lays out /srv/halo.
set -euo pipefail
DOMAIN="${1:?Usage: bootstrap.sh <public-domain>}"
export DEBIAN_FRONTEND=noninteractive
apt-get update -q && apt-get install -yq ca-certificates curl gnupg ufw unattended-upgrades fail2ban
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" > /etc/apt/sources.list.d/docker.list
apt-get update -q && apt-get install -yq docker-ce docker-ce-cli containerd.io docker-compose-plugin
# Chromium's user-namespace sandbox inside the browser workspaces needs unprivileged user namespaces.
sysctl -w kernel.unprivileged_userns_clone=1 >/dev/null 2>&1 || true
echo "kernel.unprivileged_userns_clone=1" > /etc/sysctl.d/90-halo.conf
id -u halo >/dev/null 2>&1 || useradd --uid 1000 --create-home --shell /bin/bash halo || useradd --create-home --shell /bin/bash halo
usermod -aG docker halo
ufw default deny incoming && ufw default allow outgoing && ufw allow 22/tcp && ufw allow 80/tcp && ufw allow 443/tcp && ufw --force enable
mkdir -p /srv/halo/{config/postgres/init,secrets/social,backups}
chown -R halo:halo /srv/halo && chmod 700 /srv/halo/secrets /srv/halo/secrets/social
echo "HALO_DOMAIN=$DOMAIN" > /srv/halo/.env
cat > /etc/cron.d/halo-backup <<'EOF'
# Nightly logical backup of the HALO database; copy /srv/halo/backups off-host (object storage) for the restore drill.
15 3 * * * halo cd /srv/halo && docker compose exec -T postgres pg_dump -U halo_admin -Fc halo > backups/halo-$(date +\%F).dump && find backups -name 'halo-*.dump' -mtime +14 -delete
EOF
echo "Host ready. Next: copy deploy/host/{compose.yaml,Caddyfile,config}, fill secrets/, then: sudo -u halo docker compose -f /srv/halo/compose.yaml up -d"
