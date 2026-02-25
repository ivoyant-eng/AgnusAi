# Building the Hosted Service: Monorepo, Fastify, and the Dashboard

*Part 5 of 7 in the "Building AgnusAI" series*

---

For the first few days of the project, AgnusAI was a CLI tool. You ran it against a specific PR, it produced output, and you were done. That's a useful developer tool. It's not a product.

The pivot to a hosted service happened when we confronted the obvious question: how does a team actually use this? They're not going to run a CLI command for every PR. They need a service that watches for PRs, triggers reviews automatically, posts comments without manual intervention, and gives them visibility into what's been reviewed and what's been flagged.

That meant building a webhook-driven API server, a dashboard, a proper authentication system, and a deployment story that a team could actually adopt. This post covers how we built all of that — and the decisions behind the monorepo structure, the Fastify choice, and the dashboard design.

---

## Why a Hosted Service?

The CLI is the right interface for individual developers who want to run ad-hoc reviews or integrate into custom scripts. But teams need:

1. **Automatic reviews on PR open/update.** No manual trigger. GitHub or Azure DevOps sends a webhook, the review runs, comments appear.

2. **Visibility.** What PRs have been reviewed? What was the verdict? Which repos are indexed? What's the quality trend over time?

3. **Shared configuration.** One place to configure LLM backend, review depth, precision threshold, and per-repo settings. Not a `.env` file on every developer's machine.

4. **Auth.** Multiple team members need access to the dashboard. API keys for programmatic access. Invite-only registration so the server doesn't become a public endpoint.

Once you need all four, you need a server. The question is what kind.

---

## The Monorepo Structure

The pivot to a full-stack product meant more packages. We organized the project as a pnpm workspace:

```
packages/
├── shared/     — TypeScript types shared across packages
├── core/       — Tree-sitter parsers, graph, Indexer, Retriever
├── reviewer/   — CLI reviewer, PRReviewAgent, LLM backends, VCS adapters
├── api/        — Fastify server, webhooks, REST API, auth
├── dashboard/  — Vite React SPA
└── docs/       — VitePress documentation
```

The build order matters: `shared → core → reviewer → api`. The dashboard and docs are independent — they have no TypeScript dependencies on the server packages.

[Image]: {Vertical dependency chain diagram on dark background #131312. Five boxes stacked vertically with upward arrows: "shared" at bottom (orange border, labeled "TypeScript types"), then "core" (parsers, graph, indexer), then "reviewer" (PRReviewAgent, LLM backends), then "api" (Fastify server) at top. To the right, two independent boxes: "dashboard" (Vite React) and "docs" (VitePress), connected to "api" with horizontal arrows labeled "served at /". All boxes have hairline borders, 0px border-radius, monospace labels. Build order annotations on each arrow.}

The pnpm workspace protocol (`workspace:*`) lets packages reference each other as dependencies. When `@agnus-ai/api` imports `@agnus-ai/reviewer`, it's importing the built TypeScript output — not transpiling cross-package. This means build order is enforced: if `shared` hasn't been built, `core` fails to compile.

The practical implication: `pnpm build` at the root builds all packages in dependency order. In Docker, we do the same thing — build everything, then copy only the API output into the production image.

---

## Why Fastify Over Express

Express is the default choice for Node.js APIs. It's simple, well-documented, and has a massive ecosystem. We chose Fastify for two specific reasons.

**Schema validation.** Fastify integrates with JSON Schema (or TypeBox) for route validation and serialization. Every route declares its request and response shapes:

```typescript
app.post<{
  Params: { id: string };
  Body: { prNumber: number; dryRun?: boolean };
}>('/api/repos/:id/review', {
  schema: {
    params: Type.Object({ id: Type.String() }),
    body: Type.Object({
      prNumber: Type.Number(),
      dryRun: Type.Optional(Type.Boolean()),
    }),
  },
}, async (req, reply) => {
  // req.body.prNumber is typed and validated
});
```

This eliminates a class of bugs we've hit in Express projects: requests with missing or malformed parameters reach handler logic and produce confusing errors. With schema validation, invalid requests are rejected at the framework level with clear error messages.

**The plugin system.** Fastify's plugin system is cleaner than Express middleware. Each capability (JWT auth, CORS, static file serving, cookie handling) registers as a plugin with explicit dependencies and scoping. This makes it easy to understand what's registered where:

```typescript
// packages/api/src/index.ts
await app.register(fastifyCookie);
await app.register(fastifyJwt, { secret: process.env.SESSION_SECRET });
await app.register(fastifyCors, { origin: true, credentials: true });
await app.register(authRoutes);
await app.register(repoRoutes);
await app.register(webhookRoutes);
await app.register(feedbackRoutes);
```

**SSE for real-time indexing progress.** When a user adds a repo and triggers indexing, they want to see progress in real-time. Fastify's response streaming makes Server-Sent Events clean to implement:

```typescript
app.get('/api/repos/:id/index/progress', async (req, reply) => {
  reply.raw.setHeader('Content-Type', 'text/event-stream');
  reply.raw.setHeader('Cache-Control', 'no-cache');

  const send = (event: IndexProgress) => {
    reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
  };

  await indexer.fullIndex(repoPath, repoId, branch, send);
  reply.raw.end();
});
```

No WebSocket library. No Socket.io. Just HTTP/1.1 chunked transfer with SSE framing. Works in every browser, through every proxy, with no additional infrastructure.

---

## Auth: JWT HttpOnly Cookies

The auth system needed to be simple enough to self-host without an external identity provider, but secure enough for teams handling sensitive code.

The approach:

- **JWT httpOnly cookies** via `@fastify/jwt` and `@fastify/cookie`. Tokens are never accessible to client-side JavaScript.
- **Admin bootstrap.** On first startup, if no admin user exists, one is seeded from `ADMIN_EMAIL` and `ADMIN_PASSWORD` environment variables. First run sets up the admin; subsequent runs skip this.
- **Invite-only registration.** No public signup endpoint. The admin generates invite tokens; users register via `/auth/register?token=...`. This keeps the server from becoming a public credential endpoint.
- **API keys** for programmatic access (webhooks, CLI integration). Stored in the `system_api_keys` table, checked via the same auth middleware as cookie-based requests.

We explicitly decided against OAuth/OIDC. For a self-hosted tool, OAuth adds significant complexity: you need to configure an OAuth provider, handle redirect flows, manage refresh tokens. The teams using AgnusAI are managing their own infrastructure — they want to configure two environment variables on startup, not wire up a third-party identity provider.

The tradeoff: teams need to manage their own user list. For a 5-person security team, this is fine. For a 500-person org with frequent team changes, it might be a limitation. Enterprise SSO/SAML is on the roadmap.

---

## Webhook Handlers

The `packages/api/src/routes/webhooks.ts` handles both GitHub and Azure DevOps webhooks. The two events we care about:

**PR opened (`pull_request.opened` / `git.pullrequest.created`):** Trigger a full review. For GitHub, fetch the full diff. For Azure, use `$compareTo=0` to get the cumulative diff since PR creation.

**PR updated (`pull_request.synchronize` / `git.pullrequest.updated`):** Check for a checkpoint. If one exists and the SHA matches, run an incremental review. If not, run a full review.

The webhook signature validation is non-optional. GitHub signs webhook payloads with `GITHUB_WEBHOOK_SECRET`; Azure uses `AZURE_WEBHOOK_SECRET`. Any webhook without a valid signature is rejected with 401 before reaching the review logic.

```typescript
// Signature validation before any processing
const signature = req.headers['x-hub-signature-256'] as string;
const expected = `sha256=${crypto
  .createHmac('sha256', process.env.GITHUB_WEBHOOK_SECRET!)
  .update(JSON.stringify(req.body))
  .digest('hex')}`;

if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) {
  return reply.status(401).send({ error: 'Invalid webhook signature' });
}
```

---

## The Dashboard

The dashboard is a Vite + React SPA, served at the root (`/`) by the API server via `@fastify/static`. The design follows what we call the TinyFish editorial aesthetic — a set of design principles borrowed from financial terminal UIs:

- Off-white background (`#EBEBEA`)
- Black display type — no gray hierarchy except for secondary labels
- Orange accent (`#E85A1A`) for interactive elements, badges, and data highlights
- `border-radius: 0` everywhere — no rounded corners
- Hairline borders (`1px solid`) as structural elements
- Uppercase, tracked labels for section headers and metadata
- Dense information layout — no hero sections, no whitespace padding

The principle: this tool is used by engineers who want information density. They're not being marketed to. Every pixel of the dashboard should convey state.

[Image]: {Dashboard mockup on dark background. Left sidebar (narrow, dark #1C1C1A) with nav items in small uppercase tracked text: DASHBOARD, REPOS, FEEDBACK, SETTINGS. Orange dot on DASHBOARD indicating active. Main area: table with hairline row borders. Columns: PR TITLE, REPO, VERDICT, COMMENTS, CONFIDENCE, TIME. Row data: "fix: auth token expiry", "fintech-api", green APPROVED badge, "3 comments", "0.87", "2m ago". Second row with orange REQUEST CHANGES badge. All text in JetBrains Mono. No rounded corners anywhere. Orange highlights on action buttons.}

The main pages:

- **Dashboard** — review feed table with verdict badges, comment counts, confidence scores, and timestamps
- **Repos** — repository management: add a repo, trigger indexing, see indexing status via SSE
- **Feedback** — learning metrics chart: accepted vs rejected signals over time, per repo
- **Settings** — LLM backend configuration, precision threshold, review depth per repo

The dashboard is stateless from the server's perspective — it hits the REST API for all data. This means it could be hosted separately from the API server for teams that want a dedicated frontend domain, though the default deployment serves both from the same container.

---

## Docker: Multi-Stage Build

The `Dockerfile` uses a multi-stage build to keep the production image small:

**Stage 1 (builder):** Node 20 Alpine. Install pnpm, copy the full monorepo, run `pnpm install`, run `pnpm build` for all packages.

**Stage 2 (runner):** Node 20 Alpine. Copy the API package with a flat `node_modules` using `pnpm deploy --legacy`:

```dockerfile
FROM node:20-alpine AS builder
RUN npm install -g pnpm
WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm build

FROM node:20-alpine AS runner
WORKDIR /app
COPY --from=builder /app/packages/api/package.json ./package.json
# pnpm deploy resolves workspace symlinks into flat node_modules
RUN cd /app && pnpm deploy --legacy packages/api /app/production
COPY --from=builder /app/packages/dashboard/dist ./packages/dashboard/dist
COPY --from=builder /app/packages/docs/.vitepress/dist ./packages/docs/dist
```

`pnpm deploy --legacy` is the key step. In a monorepo, packages reference each other via workspace symlinks (`@agnus-ai/shared → packages/shared`). In production, you need these resolved to actual files in `node_modules`. The `deploy` command does this — it produces a flat `node_modules` directory with all dependencies resolved, no symlinks, no workspace protocol references.

The result: a production image that contains only the API server code and its dependencies. No source files, no TypeScript compiler, no parser dev tooling. The production container is around 400MB — reasonable for a Node.js service with the Tree-sitter WASM grammars included.

**Ollama runs on the host.** We made a deliberate choice not to include Ollama in the Docker image. Running an LLM with GPU acceleration requires CUDA libraries, GPU device mounting, and significant memory. This is better handled by Ollama running directly on the host machine, with the Docker container reaching it via `http://host.docker.internal:11434`. Teams that want to run purely in containers can override the `OLLAMA_URL` environment variable to point to a separate Ollama container.

---

## The Key Takeaway

The pivot from CLI to hosted service added four new packages and a significant surface area. What kept it manageable: the core business logic (graph analysis, review generation, precision filtering) remained unchanged in the `reviewer` and `core` packages. The API layer is primarily orchestration — it wires together the existing pieces and adds the delivery layer (webhooks, auth, SSE, dashboard).

The pnpm monorepo structure made this separation clean. The Fastify plugin system kept the server code modular. The multi-stage Docker build made deployment simple. None of these are exotic choices — they're the right tools for a full-stack TypeScript project that needs to be easy to deploy and operate.

---

*Previous: [Three Depths of Review: Fast, Standard, and Deep Mode ←](./04-three-depths-of-review.md)*
*Next: [Signal vs. Noise: Building the Precision Filter and RAG Feedback Loop →](./06-precision-filter-and-rag-feedback.md)*
