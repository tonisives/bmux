FROM node:22-bookworm-slim AS build
RUN corepack enable
WORKDIR /opt/bmux
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY patches ./patches
RUN pnpm install --frozen-lockfile && node node_modules/electron/install.js
COPY . .
RUN pnpm build && pnpm remote:build

FROM node:22-bookworm-slim AS base
RUN apt-get update && apt-get install -y --no-install-recommends \
    xvfb xauth tini dbus libnss3 libatk-bridge2.0-0 libgtk-3-0 libgbm1 \
    libasound2 libxss1 libdrm2 libxshmfence1 fonts-liberation ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && mkdir -p /data && chown node:node /data
WORKDIR /opt/bmux
ENV BMUX_DATA_DIR=/data

FROM base AS test
COPY --from=build /opt/bmux /opt/bmux
RUN chown root:root node_modules/electron/dist/chrome-sandbox && chmod 4755 node_modules/electron/dist/chrome-sandbox
USER node
ENTRYPOINT ["tini", "--", "xvfb-run", "-a"]

FROM build AS packaged
RUN pnpm exec electron-builder --linux --dir --publish never && node scripts/stage-linux.mjs

FROM build AS service-build
RUN pnpm exec esbuild remote/server.ts --platform=node --format=esm --outfile=remote/server.mjs && pnpm prune --prod
FROM node:22-bookworm-slim AS service
WORKDIR /opt/bmux
COPY --from=service-build /opt/bmux/node_modules ./node_modules
COPY --from=service-build /opt/bmux/package.json ./package.json
COPY --from=service-build /opt/bmux/remote/server.mjs ./remote/server.mjs
COPY --from=service-build /opt/bmux/remote/schema.sql ./remote/schema.sql
COPY --from=service-build /opt/bmux/remote/dist ./remote/dist
USER node
EXPOSE 8788
CMD ["node", "remote/server.mjs"]

FROM base AS host
COPY --from=packaged /opt/bmux/release/runtime /opt/bmux
RUN ln -s /opt/bmux/resources/bin/bmux.mjs /usr/local/bin/bmux \
    && chown root:root chrome-sandbox && chmod 4755 chrome-sandbox
USER node
HEALTHCHECK --interval=15s --timeout=5s --start-period=30s CMD node resources/scripts/host-health.mjs
ENTRYPOINT ["tini", "--", "xvfb-run", "-a", "-s", "-screen 0 1280x900x24 -nolisten tcp", "bmux", "host"]
