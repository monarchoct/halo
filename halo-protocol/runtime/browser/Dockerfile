# Verified MCR v1.62.0-noble multi-platform index, 13 September 2026.
FROM mcr.microsoft.com/playwright:v1.62.0-noble@sha256:baed2032d533817f3dbe6425de795788430ba345e819a1201337009ba17c9d07
WORKDIR /opt/halo-browser
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY worker.mjs social-driver.mjs schema.mjs report-writer.mjs egress-proxy.mjs desktop.mjs ./
RUN mkdir -p /profile /public && chown -R 1000:1000 /profile /public /opt/halo-browser
USER 1000:1000
ENV NODE_ENV=production
ENV HOME=/profile XDG_CACHE_HOME=/tmp/halo-cache XDG_CONFIG_HOME=/profile/config XDG_DATA_HOME=/profile/data
CMD ["node", "worker.mjs", "/run/job.json"]
