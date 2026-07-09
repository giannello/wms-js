FROM node:26.5.0-slim AS base
WORKDIR /app

COPY package.json package-lock.json .npmrc ./
COPY packages/lib/package.json packages/lib/package.json
COPY packages/mqtt-bridge/package.json packages/mqtt-bridge/package.json
COPY packages/web/package.json packages/web/package.json
COPY packages/cli/package.json packages/cli/package.json

FROM base AS deps
RUN npm ci

FROM deps AS dev
