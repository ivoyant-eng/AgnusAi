# What is AgnusAI?

AgnusAI is a fully open-source, self-hostable AI code reviewer that understands your codebase's **dependency graph** before it reviews a PR.

## The Problem with Naive LLM Review

Most AI reviewers show the LLM only the diff. That means the LLM has no idea:

- Which other functions **call** the function you just changed
- How many files would break if your change introduces a bug
- Whether a similar pattern was already solved elsewhere in the codebase

AgnusAI solves this by indexing your repo into an in-memory symbol graph. When a PR arrives, it computes the **blast radius** of every changed symbol and injects that context into the LLM prompt before the review starts.

## Two Modes of Operation

### CLI (Layer 0 — Stateless)

The original mode. Run directly in CI/CD. No server required.

```bash
node dist/cli.js review --pr 42 --repo owner/repo
```

It fetches the diff, optionally loads skills, builds a prompt, and posts inline comments. No database, no indexing.

### Hosted Service (Layer 1+ — Stateful)

A long-running Fastify server that:

1. Receives GitHub / Azure DevOps webhooks
2. On every push → incrementally re-indexes only changed files
3. On every PR → assembles graph context → runs the LLM review → posts comments automatically

This is the mode that enables blast radius analysis and semantic neighbor search.

## Key Capabilities

| Feature | CLI | Hosted |
|---------|-----|--------|
| Inline comments with line numbers | ✅ | ✅ |
| Incremental review (checkpoint) | ✅ | ✅ |
| Smart deduplication | ✅ | ✅ |
| Skills system | ✅ | ✅ |
| Blast radius (graph traversal) | ❌ | ✅ |
| Semantic neighbors (embeddings) | ❌ | deep mode |
| Auto-triggered on PR open/sync | ❌ | ✅ |
| Auto-indexed on push | ❌ | ✅ |

## What It Doesn't Do

- **Chat with your codebase** — symbol embeddings are for blast-radius expansion, not a general Q&A interface
- **Store raw source code** — only signatures, edges, and embedding vectors are persisted (privacy by design)
- **Replace code review** — it's a first-pass assistant, not a substitute for human judgment
