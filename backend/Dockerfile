# Backend image, multi-stage.
#
# The build context is the repository root, so that the image copies shared/
# itself instead of trusting that `make sync-types` ran on the host. That removes
# a whole class of "it works on my machine" failures at the cost of one COPY.
#
# Stages:
#   base    dependency layer, cached on package.json and the lockfile
#   dev     bind-mounted during development; used by docker-compose.yml
#   build   Prisma client generation and TypeScript emit
#   runtime lean image with two entry points, used by docker-compose.prod.yml

# ---------------------------------------------------------------------------
FROM node:22-bookworm-slim AS base

ENV NPM_CONFIG_UPDATE_NOTIFIER=false \
    NPM_CONFIG_FUND=false \
    NPM_CONFIG_AUDIT=false
WORKDIR /app

# argon2 ships prebuilt binaries for linux/glibc, which is why this image is
# bookworm-slim and not alpine: on musl the package would need a toolchain.
COPY backend/package.json backend/package-lock.json ./
RUN npm ci

# ---------------------------------------------------------------------------
FROM base AS dev

ENV NODE_ENV=development
COPY backend/ ./
COPY shared/ ./src/shared/
EXPOSE 3000 9464
CMD ["npm", "run", "dev"]

# ---------------------------------------------------------------------------
FROM base AS build

ENV NODE_ENV=development
COPY backend/ ./
COPY shared/ ./src/shared/

# The schema lands with workflow W2. Guarded so the image also builds before it
# exists, which keeps the Dockerfile frozen from W1 onwards.
RUN if [ -f prisma/schema.prisma ]; then npx prisma generate; fi
RUN npm run build

# ---------------------------------------------------------------------------
FROM node:22-bookworm-slim AS runtime

ENV NODE_ENV=production \
    NPM_CONFIG_UPDATE_NOTIFIER=false
WORKDIR /app

# node_modules comes from the build stage rather than from a pruned production
# install, because the generated Prisma client lives inside it. Trading a larger
# image for a client that is guaranteed to be present is the right way round.
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/prisma ./prisma

USER node
EXPOSE 3000 9464
STOPSIGNAL SIGTERM

# docker-compose.prod.yml overrides this with dist/worker.js for the worker.
CMD ["node", "dist/server.js"]
