# Backend API. Two stages: the build stage has the full toolchain and every dependency; the runtime stage carries only
# compiled output and production dependencies, runs as a non-root user and has no compiler or package manager cache.
# Base images are pinned by digest so a rebuild gets the same bytes; Dependabot proposes digest bumps.

FROM node:24-alpine@sha256:8a32c8cf649a49915a66e81e7a609223c708d0adabf288ee3f4077d765542f85 AS build
# No native module here needs a compiler (sharp ships prebuilt binaries for x86 and ARM, glibc and musl).
WORKDIR /app
COPY package.json package-lock.json ./
# Strict and reproducible: the lock file is the truth, and a mismatch fails the build instead of installing something else.
RUN npm ci --legacy-peer-deps --no-audit --no-fund
COPY . .
RUN npm run build && npm prune --omit=dev --legacy-peer-deps

FROM node:24-alpine@sha256:8a32c8cf649a49915a66e81e7a609223c708d0adabf288ee3f4077d765542f85 AS runtime
# A runtime image runs `node` and nothing else: no npm or corepack (a package manager is attack surface, and ships its own
# vulnerable copies of libraries). Patched OS packages are applied at build time.
RUN apk upgrade --no-cache && rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack
RUN apk add --no-cache dumb-init
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/package.json ./
# The only writable path (error log files); everything else runs read-only.
RUN mkdir -p /app/logs && chown node:node /app/logs
USER node
EXPOSE 4000
ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "dist/main.js"]
