# ─── Stage 1: Build ──────────────────────────────────────────────────────────
FROM node:20-alpine AS builder

RUN npm install -g pnpm

WORKDIR /app

# Copy manifests first — these layers are cached until deps change
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages/shared/package.json      ./packages/shared/
COPY packages/reviewer/package.json    ./packages/reviewer/
COPY packages/core/package.json        ./packages/core/
COPY packages/api/package.json         ./packages/api/

# Install ALL deps (devDeps needed for TypeScript compiler)
RUN pnpm install --frozen-lockfile

# Copy tsconfig files
COPY tsconfig.base.json tsconfig.json ./
COPY packages/shared/tsconfig.json    ./packages/shared/
COPY packages/reviewer/tsconfig.json  ./packages/reviewer/
COPY packages/core/tsconfig.json      ./packages/core/
COPY packages/api/tsconfig.json       ./packages/api/

# Copy sources
COPY packages/shared/src               ./packages/shared/src
COPY packages/reviewer/src             ./packages/reviewer/src
COPY packages/reviewer/skills          ./packages/reviewer/skills
COPY packages/core/src                 ./packages/core/src
COPY packages/api/src                  ./packages/api/src

# Build all packages in dependency order
RUN pnpm --filter @agnus-ai/shared   build && \
    pnpm --filter @agnus-ai/reviewer build && \
    pnpm --filter @agnus-ai/core     build && \
    pnpm --filter @agnus-ai/api      build

# Create a self-contained deployment at /deploy —
# pnpm deploy resolves all prod deps, flattens symlinks, and bundles
# workspace packages with their dist/ included. No .pnpm virtual store needed.
RUN pnpm deploy --legacy --filter @agnus-ai/api --prod /deploy

# ─── Stage 2: Runtime ─────────────────────────────────────────────────────────
FROM node:20-alpine AS runner

WORKDIR /app

# Copy the self-contained bundle — flat node_modules, compiled dist only
COPY --from=builder /deploy .

ENV NODE_ENV=production

EXPOSE 3000

CMD ["node", "dist/index.js"]
