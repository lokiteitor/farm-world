# Frontend image, multi-stage.
#
# The build context is the repository root so that the image copies shared/
# itself (see backend/Dockerfile for the same reasoning).
#
# Stages:
#   base   dependency layer, cached on package.json and the lockfile
#   dev    Nuxt dev server, used by docker-compose.yml
#   build  static single-page application in .output/public
#   dist   nothing but the built assets; docker-compose.prod.yml runs it once to
#          publish them into the named volume that Caddy serves

# ---------------------------------------------------------------------------
FROM node:22-bookworm-slim AS base

ENV NPM_CONFIG_UPDATE_NOTIFIER=false \
    NPM_CONFIG_FUND=false \
    NPM_CONFIG_AUDIT=false
WORKDIR /app

# --ignore-scripts because the postinstall hook is `nuxt prepare`, which needs
# the sources that this layer deliberately does not have yet.
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --ignore-scripts

# ---------------------------------------------------------------------------
FROM base AS dev

ENV NODE_ENV=development
COPY frontend/ ./
COPY shared/ ./app/shared/
RUN npx nuxt prepare
EXPOSE 3001
CMD ["npm", "run", "dev"]

# ---------------------------------------------------------------------------
FROM base AS build

# NODE_ENV stays at development for the build itself: Nuxt needs its dev
# dependencies present, and the output is static either way.
ENV NODE_ENV=development
COPY frontend/ ./
COPY shared/ ./app/shared/
RUN npx nuxt prepare
# `generate` and not `build`: with ssr disabled the deliverable is a static
# directory, and there is no Nitro server in production (plan section 9).
RUN npm run generate

# ---------------------------------------------------------------------------
FROM alpine:3.21 AS dist

# No server here. docker-compose.prod.yml overrides the command with the copy
# into the shared volume; this default makes the image inspectable on its own.
COPY --from=build /app/.output/public /dist
CMD ["sh", "-c", "ls -1 /dist"]
