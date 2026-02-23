# ─── Stage 1: Build ──────────────────────────────────────────────────────────
FROM node:20-alpine AS builder

RUN npm install -g pnpm

WORKDIR /app

# Copy all package manifests first — these layers are cached until deps change
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages/shared/package.json      ./packages/shared/
COPY packages/reviewer/package.json    ./packages/reviewer/
COPY packages/core/package.json        ./packages/core/
COPY packages/api/package.json         ./packages/api/
COPY packages/dashboard/package.json   ./packages/dashboard/
COPY packages/docs/package.json        ./packages/docs/

# Install ALL deps (devDeps needed for TypeScript + Vite + VitePress)
RUN pnpm install --frozen-lockfile

# Copy tsconfig files
COPY tsconfig.base.json tsconfig.json ./
COPY packages/shared/tsconfig.json    ./packages/shared/
COPY packages/reviewer/tsconfig.json  ./packages/reviewer/
COPY packages/core/tsconfig.json      ./packages/core/
COPY packages/api/tsconfig.json       ./packages/api/
COPY packages/dashboard/tsconfig.json ./packages/dashboard/

# Copy all sources
COPY packages/shared/src               ./packages/shared/src
COPY packages/reviewer/src             ./packages/reviewer/src
COPY packages/reviewer/skills          ./packages/reviewer/skills
COPY packages/reviewer/tsup.config.ts  ./packages/reviewer/tsup.config.ts
COPY packages/core/src                 ./packages/core/src
COPY packages/api/src                  ./packages/api/src
COPY packages/dashboard/src            ./packages/dashboard/src
COPY packages/dashboard/index.html     ./packages/dashboard/index.html
COPY packages/dashboard/vite.config.ts ./packages/dashboard/vite.config.ts
COPY packages/dashboard/tailwind.config.js ./packages/dashboard/tailwind.config.js
COPY packages/dashboard/postcss.config.js  ./packages/dashboard/postcss.config.js

# Copy VitePress docs source (content dirs + config; node_modules/dist excluded by .dockerignore)
COPY packages/docs/.vitepress/config.ts  ./packages/docs/.vitepress/config.ts
COPY packages/docs/.vitepress/theme/     ./packages/docs/.vitepress/theme/
COPY packages/docs/api/                  ./packages/docs/api/
COPY packages/docs/architecture/         ./packages/docs/architecture/
COPY packages/docs/development/          ./packages/docs/development/
COPY packages/docs/guide/                ./packages/docs/guide/
COPY packages/docs/providers/            ./packages/docs/providers/
COPY packages/docs/reference/            ./packages/docs/reference/
COPY packages/docs/index.md              ./packages/docs/index.md

# Build all packages in dependency order, then dashboard + docs
RUN pnpm --filter @agnus-ai/shared    build && \
    pnpm --filter @agnus-ai/reviewer  build && \
    pnpm --filter @agnus-ai/core      build && \
    pnpm --filter @agnus-ai/api       build && \
    pnpm --filter @agnus-ai/dashboard build && \
    pnpm --filter @agnus-ai/docs      build

# Self-contained API deployment (prod deps only, workspace symlinks resolved)
RUN pnpm deploy --legacy --filter @agnus-ai/api --prod /deploy

# Copy static asset bundles separately
RUN cp -r packages/dashboard/dist /dashboard-dist && \
    cp -r packages/docs/.vitepress/dist /docs-dist

# ─── Stage 2: Runtime ─────────────────────────────────────────────────────────
FROM node:20-alpine AS runner

# git is needed for auto-cloning repos
RUN apk add --no-cache git

WORKDIR /app

# API bundle
COPY --from=builder /deploy .

# Dashboard static build — served by Fastify at /app/*
COPY --from=builder /dashboard-dist ./dashboard-dist

# Docs static build — served by Fastify at /docs/*
COPY --from=builder /docs-dist ./docs-dist

ENV NODE_ENV=production
ENV DASHBOARD_DIST=/app/dashboard-dist
ENV DOCS_DIST=/app/docs-dist

EXPOSE 3000

CMD ["node", "dist/index.js"]
