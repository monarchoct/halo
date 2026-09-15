#!/usr/bin/env bash
# Stamp the public domain into every host config and the testnet deploy config in one go.
#   bash deploy/host/set-domain.sh halo.example.com [/srv/halo]
# Rewrites: .env HALO_DOMAIN, allowedOrigins + X redirectUri + inference backend in config/*.json,
# and the six public URLs in deploy/testnet/config.json (run from the repository).
set -euo pipefail
DOMAIN="${1:?Usage: set-domain.sh <public-domain> [host-directory]}"
HOST_DIR="${2:-$(cd "$(dirname "$0")" && pwd)}"
[[ "$DOMAIN" =~ ^[a-z0-9.-]+\.[a-z]{2,}$ ]] || { echo "not a bare domain: $DOMAIN" >&2; exit 1; }
for file in "$HOST_DIR"/config/*.json; do
  sed -i -e "s#halo\.example\.com#$DOMAIN#g" "$file"
done
if [[ -f "$HOST_DIR/.env" ]]; then
  grep -q '^HALO_DOMAIN=' "$HOST_DIR/.env" && sed -i -e "s#^HALO_DOMAIN=.*#HALO_DOMAIN=$DOMAIN#" "$HOST_DIR/.env" || echo "HALO_DOMAIN=$DOMAIN" >> "$HOST_DIR/.env"
fi
REPO="$(cd "$(dirname "$0")/../.." 2>/dev/null && pwd || true)"
if [[ -n "$REPO" && -f "$REPO/deploy/testnet/config.json" ]]; then
  sed -i -e "s#PLACEHOLDER-DOMAIN#$DOMAIN#g" -e "s#halo\.example\.com#$DOMAIN#g" "$REPO/deploy/testnet/config.json"
fi
echo "Domain $DOMAIN stamped into $HOST_DIR/config, $HOST_DIR/.env${REPO:+ and deploy/testnet/config.json}."
echo "DNS A records to create: api operations live screens artifacts inference -> this host; @ and www -> Cloudflare Pages."
