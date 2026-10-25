# syntax=docker/dockerfile:1
# One image definition for both services: `--target api` (Fastify) and `--target web` (static PWA behind Caddy).

FROM node:24-alpine AS deps
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY scripts/enforce-pnpm.mjs scripts/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile

FROM deps AS api-build
COPY apps/api apps/api
RUN pnpm --filter @olowo/api build

FROM node:24-alpine AS api
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY scripts/enforce-pnpm.mjs scripts/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile --prod --filter @olowo/api
COPY --from=api-build /app/apps/api/dist apps/api/dist
COPY apps/api/sql apps/api/sql
ENV NODE_ENV=production HOST=0.0.0.0 PORT=8787
WORKDIR /app/apps/api
USER node
EXPOSE 8787
CMD ["node", "dist/server.js"]

FROM deps AS web-build
# Mapbox public tokens are designed to ship in the browser bundle.
ARG VITE_MAPBOX_ACCESS_TOKEN
COPY apps/web apps/web
RUN pnpm --filter @olowo/web exec tsc && pnpm --filter @olowo/web exec vite build

FROM caddy:2-alpine AS web
COPY apps/web/Caddyfile /etc/caddy/Caddyfile
COPY --from=web-build /app/apps/web/dist/client /srv
