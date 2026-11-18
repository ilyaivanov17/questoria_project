# syntax=docker/dockerfile:1.7

FROM node:22.23.5-bookworm-slim AS base
WORKDIR /app
ENV PNPM_HOME=/pnpm
ENV COREPACK_HOME=/pnpm/corepack
ENV PATH=${PNPM_HOME}:${PATH}
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates openssl && rm -rf /var/lib/apt/lists/* \
    && corepack enable && corepack prepare pnpm@12.17.0 --activate

# Resolve dependencies from the committed lockfile before copying application sources.
FROM base AS dependencies
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY apps/api/package.json ./apps/api/package.json
COPY apps/web/package.json ./apps/web/package.json
COPY packages/contracts/package.json ./packages/contracts/package.json
RUN pnpm install --frozen-lockfile

# Generate the Prisma client and build both workspace applications.
# DATABASE_URL here is deliberately a build-only placeholder; no network connection is made.
FROM dependencies AS build
COPY . .
ENV DATABASE_URL=postgresql://questoria:build_only@127.0.0.1:5432/questoria?schema=public
ARG API_INTERNAL_URL=http://api:4000
ENV API_INTERNAL_URL=${API_INTERNAL_URL}
ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm db:generate && pnpm build && test -f apps/api/dist/generated/prisma/client.js

# Production dependency sets keep devDependencies out of the web and API runtime images.
FROM base AS api-production-dependencies
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY apps/api/package.json ./apps/api/package.json
COPY apps/web/package.json ./apps/web/package.json
COPY packages/contracts/package.json ./packages/contracts/package.json
RUN pnpm install --prod --filter '@questoria/api...' --frozen-lockfile

FROM base AS web-production-dependencies
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY apps/api/package.json ./apps/api/package.json
COPY apps/web/package.json ./apps/web/package.json
COPY packages/contracts/package.json ./packages/contracts/package.json
RUN pnpm install --prod --filter '@questoria/web...' --frozen-lockfile

# API runtime. The database is external and supplied through DATABASE_URL at runtime.
FROM base AS api
ENV NODE_ENV=production
ENV API_PORT=4000
COPY --from=api-production-dependencies --chown=node:node /app/node_modules ./node_modules
# apps/api/src/main.ts imports dotenv/config at runtime although the workspace
# currently declares dotenv only as a root development dependency.
COPY --from=dependencies --chown=node:node /app/node_modules/.pnpm/dotenv@17.4.2/node_modules/dotenv ./node_modules/dotenv
RUN node --input-type=module -e "await import('dotenv/config')"
COPY --from=api-production-dependencies --chown=node:node /app/apps/api/node_modules ./apps/api/node_modules
COPY --from=api-production-dependencies --chown=node:node /app/packages/contracts ./packages/contracts
COPY --from=api-production-dependencies --chown=node:node /app/apps/api/package.json ./apps/api/package.json
COPY --from=build --chown=node:node /app/apps/api/dist ./apps/api/dist
USER node
EXPOSE 4000
CMD ["node", "apps/api/dist/main.js"]

# Next.js runtime. The internal API origin is also baked into the rewrite at build time.
FROM base AS web
ARG API_INTERNAL_URL=http://api:4000
ENV NODE_ENV=production
ENV API_INTERNAL_URL=${API_INTERNAL_URL}
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=web-production-dependencies --chown=node:node /app/node_modules ./node_modules
COPY --from=web-production-dependencies --chown=node:node /app/apps/web/node_modules ./apps/web/node_modules
COPY --from=web-production-dependencies --chown=node:node /app/apps/web/package.json ./apps/web/package.json
COPY --from=web-production-dependencies --chown=node:node /app/packages/contracts ./packages/contracts
COPY --from=web-production-dependencies --chown=node:node /app/package.json ./package.json
COPY --from=web-production-dependencies --chown=node:node /app/pnpm-workspace.yaml ./pnpm-workspace.yaml
COPY --from=build --chown=node:node /app/apps/web/.next ./apps/web/.next
COPY --from=build --chown=node:node /app/apps/web/app ./apps/web/app
COPY --from=build --chown=node:node /app/apps/web/components ./apps/web/components
COPY --from=build --chown=node:node /app/apps/web/next.config.ts ./apps/web/next.config.ts
RUN test -f apps/web/node_modules/next/dist/bin/next && test -f apps/web/.next/BUILD_ID
USER node
WORKDIR /app/apps/web
EXPOSE 3000
# pnpm is a build-time tool only. Run the installed Next.js CLI directly so
# the runtime user does not need to mutate the root-owned Corepack cache.
# The working directory must be the Next.js app root containing its .next build.
CMD ["node", "node_modules/next/dist/bin/next", "start", "--hostname", "0.0.0.0", "--port", "3000"]

# Explicit one-shot migration image. Compose only runs this target on request.
FROM dependencies AS migrate
COPY . .
ENV NODE_ENV=production
USER node
CMD ["./node_modules/.bin/prisma", "migrate", "deploy", "--config", "prisma7.config.ts"]
