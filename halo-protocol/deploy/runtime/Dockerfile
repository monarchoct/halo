# Build only from the allowlisted context produced by scripts/package-runtime.py.
FROM node:22.23.2-bookworm-slim@sha256:83f487e0a63425e5b4d146fb5e5be574bcbe1b7b843d3ebafdd95eaf7767a7e5 AS node
FROM python:3.12-slim-bookworm@sha256:782412e85d0f0984994c290652577d4018aff08145c85b262bb63dc0c7522254
COPY --from=node /usr/local/bin/node /usr/local/bin/node
COPY --from=node /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/npm
RUN ln -s ../lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm \
 && ln -s ../lib/node_modules/npm/bin/npx-cli.js /usr/local/bin/npx
WORKDIR /opt/halo
COPY package.json package-lock.json ./
COPY services/persistence/package.json services/persistence/package-lock.json ./services/persistence/
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund \
 && npm ci --prefix services/persistence --omit=dev --ignore-scripts --no-audit --no-fund \
 && npm cache clean --force
COPY models/core-v1/requirements.txt ./models/core-v1/requirements.txt
COPY runtime/requirements.txt ./runtime/requirements.txt
RUN pip install --no-cache-dir --only-binary=:all: -r models/core-v1/requirements.txt -r runtime/requirements.txt \
 && pip check
COPY . .
RUN groupadd --gid 1000 halo && useradd --uid 1000 --gid 1000 --no-create-home --home-dir /state halo \
 && mkdir /state && chown 1000:1000 /state \
 && node deploy/runtime/verify-release.mjs
ENV NODE_ENV=production PYTHONNOUSERSITE=1 PYTHONDONTWRITEBYTECODE=1 PYTHONUTF8=1 HOME=/state
USER 1000:1000
STOPSIGNAL SIGTERM
ENTRYPOINT ["node", "deploy/runtime/entrypoint.mjs"]
CMD ["check"]
