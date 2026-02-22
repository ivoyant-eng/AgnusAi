FROM node:20-alpine AS base
RUN npm install -g pnpm

WORKDIR /app

# Copy workspace manifests first (layer cache optimization)
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages/shared/package.json ./packages/shared/
COPY packages/reviewer/package.json ./packages/reviewer/
COPY packages/core/package.json ./packages/core/
COPY packages/api/package.json ./packages/api/

# Install all dependencies (no devDependencies in production)
RUN pnpm install --frozen-lockfile --prod

# Copy tsconfig files
COPY tsconfig.base.json tsconfig.json ./
COPY packages/shared/tsconfig.json ./packages/shared/
COPY packages/reviewer/tsconfig.json ./packages/reviewer/
COPY packages/core/tsconfig.json ./packages/core/
COPY packages/api/tsconfig.json ./packages/api/

# Install devDeps for building (TypeScript compiler)
RUN pnpm install --frozen-lockfile

# Copy sources
COPY packages/shared/src ./packages/shared/src
COPY packages/reviewer/src ./packages/reviewer/src
COPY packages/reviewer/skills ./packages/reviewer/skills
COPY packages/core/src ./packages/core/src
COPY packages/api/src ./packages/api/src

# Build all packages in dependency order
RUN pnpm --filter @agnus-ai/shared build && \
    pnpm --filter @agnus-ai/reviewer build && \
    pnpm --filter @agnus-ai/core build && \
    pnpm --filter @agnus-ai/api build

# Copy optional dashboard build if it exists
COPY packages/dashboard/dist ./packages/dashboard/dist 2>/dev/null || true

EXPOSE 3000

ENV NODE_ENV=production

CMD ["node", "packages/api/dist/index.js"]
