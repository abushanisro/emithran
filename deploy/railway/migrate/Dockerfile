# One-off job: apply the migrations after the baseline with the repo's own runner (backend/scripts/migrate.ts), then exit. The runner takes
# its settings from the environment when there is no env file (the way it supports a CI job): MIGRATE_ENV (stage|prd), APP_ENV,
# MIGRATE_DATABASE_URL, and MIGRATE_FLAGS (--confirm for production). Built by seed-environment.sh from a copy of backend/.
FROM node:24-alpine@sha256:8a32c8cf649a49915a66e81e7a609223c708d0adabf288ee3f4077d765542f85
RUN mkdir -p /app/backend && chown node:node /app/backend
USER node
WORKDIR /app/backend
COPY --chown=node:node package.json package-lock.json .npmrc tsconfig*.json ./
RUN npm ci --legacy-peer-deps --ignore-scripts --no-audit --no-fund
COPY --chown=node:node src ./src
COPY --chown=node:node scripts ./scripts
COPY --chown=node:node migrations ./migrations
CMD ["sh", "-c", "npx ts-node -r tsconfig-paths/register scripts/migrate.ts --env \"$MIGRATE_ENV\" $MIGRATE_FLAGS"]
