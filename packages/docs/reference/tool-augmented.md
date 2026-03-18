# Tool-Augmented Review

In multi-agent mode, review agents are not limited to the diff and upfront graph context injected into the prompt. They can actively explore the codebase mid-review using a set of read-only tools — fetching symbol implementations, tracing callers and callees, reading files, and looking up external library docs.

## Available Tools

| Tool | What It Does |
|------|-------------|
| `get_symbol_body` | Read the full implementation of a function or method from the symbol graph |
| `find_callers` | Find all code that calls a given symbol (1-hop blast radius) |
| `find_callees` | Find all symbols a given function calls (its dependencies) |
| `read_file` | Read a file with an optional line range. Lines changed in this PR are marked with ★ |
| `get_library_docs` | Fetch up-to-date docs for an npm package via Context7 |

## How Agents Use Tools

During review, agents emit `<tool_call>` markers in their response:

```
<tool_call>{"tool": "find_callers", "args": {"symbol_id": "lib/auth.ts:validateToken"}}</tool_call>
```

The tool executor intercepts these, runs each tool against the local symbol graph or filesystem, and injects the result back into the agent's context. The agent then continues its analysis with the new information.

Agents can call multiple tools across multiple rounds. The maximum number of rounds scales with PR size and is configurable via `AGENT_TOOL_MAX_ROUNDS`.

### Example: Security Agent Tracing Auth

```
Agent prompt: "Review this diff for security issues."

Agent calls: get_symbol_body(lib/auth.ts:validateToken)
  → returns: full implementation of validateToken()

Agent calls: find_callers(lib/auth.ts:validateToken)
  → returns: ["api/routes/users.ts:createUser", "api/routes/admin.ts:deleteUser"]

Agent output: "validateToken() does not verify token expiry. Called from 2 routes —
              both are unauthenticated in practice."
```

## Tool Call Deduplication

A `ToolCallCache` deduplicates identical tool calls across agents within a single review run. If the security agent and the correctness agent both call `find_callers` on the same symbol, the second call is served from cache at zero cost.

Per-agent stats (total calls, cache hits, per-tool breakdown) are included in `AgentTelemetry` and accessible in the dashboard.

## Context7 Library Documentation

`get_library_docs` integrates with [Context7](https://context7.com) to fetch current documentation for npm packages detected in the diff.

**How it works:**

1. Library detector scans imports in diff hunks and extracts package names
2. Resolves installed versions from the project's `package.json`
3. Agents call `get_library_docs(library, query, version?)` during review
4. Context7 returns relevant documentation snippets, cached locally

**Use cases:**
- Verifying that an API call matches the current package docs (not hallucinated)
- Checking whether a deprecated method was used
- Understanding expected behavior of a third-party function being reviewed

### Configuration

```env
# Enable Context7 integration (default: false)
CONTEXT7_ENABLED=true

# API key from context7.com
CONTEXT7_API_KEY=ctx7_...

# Max tokens per doc fetch (default: 4000)
CONTEXT7_MAX_TOKENS=4000

# Pre-fetch all detected library docs before review starts (default: false)
# Adds latency but reduces mid-review tool call overhead
CONTEXT7_PREEMPTIVE=false
```

## Configuration

```env
# Maximum tool call rounds per agent (auto-scales by PR size if unset)
AGENT_TOOL_MAX_ROUNDS=5
```

Tool-augmented review is automatically enabled when `MULTI_AGENT_ENABLED=true`. There is no separate toggle.
