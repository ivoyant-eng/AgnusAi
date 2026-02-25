# The Graph Engine: Why We Chose Tree-sitter WASM Over a Language Server

*Part 3 of 7 in the "Building AgnusAI" series*

---

The single most important technical decision in AgnusAI wasn't the LLM backend abstraction or the monorepo structure or the choice of Fastify over Express. It was this: how do we build a symbol dependency graph that works deterministically across languages, in any environment, without requiring platform-specific binaries?

Everything else flows from getting this right or wrong.

Get it wrong and you have a code reviewer that only works on Linux, takes 30 seconds to start, fails silently when the language server isn't running, and requires per-language daemon management. Get it right and you have a code reviewer that starts in milliseconds, works identically in Docker, on macOS, on Alpine Linux, and produces the same output every time on the same input.

We got it right. This is how.

---

## The Core Insight

To understand blast radius — which callers of a changed function will break, which files will be affected, what the risk score of a change is — you need a symbol dependency graph. The graph has to tell you:

- What functions, classes, and methods exist in the codebase
- What calls what
- What imports what
- What the signatures are

There are two ways to build this: **language servers** (LSP) or **static parsing** (Tree-sitter or similar).

We chose Tree-sitter WASM. Here's why the other option doesn't work.

---

## Why Not an LSP?

Language Server Protocol was designed for IDE integration: stateful, long-running analysis processes that incrementally update as you type. It's a great tool for its intended use case. For building an offline dependency graph for batch code review, it's the wrong tool entirely.

**Startup time.** TypeScript Language Server takes 5–15 seconds to initialize on a medium-sized codebase. Pylance for Python is similar. This is acceptable for an IDE where the server starts once and stays running for hours. For a code review pipeline that needs to analyze a PR within seconds, it's a non-starter.

**State management.** LSPs are stateful processes. They need to be initialized with a project root, they need to receive file change notifications, and they maintain an in-memory model of your code. This statefulness makes them fast for IDE use but complex to manage in a batch pipeline. You need process lifecycle management, restart logic, timeout handling, and careful sequencing of operations.

**Platform specifics.** The TypeScript Language Server is a Node.js process. Pylance ships as a VS Code extension bundle. Gopls is a Go binary. Every language has a different runtime requirement, different installation method, and different configuration. Making this work reliably across Linux (Docker), macOS (dev machines), and Alpine Linux (the base image we use) would require significant platform-specific setup.

**Non-determinism.** LSPs are designed to be responsive, not deterministic. They can return partial results, update analyses over time, and prioritize based on cursor position. For a batch analysis pipeline, we need: same input always produces same output.

The summary: LSP = language-specific, stateful, heavy, slow to start, platform-sensitive. Wrong tool.

[Image]: {Split comparison diagram. Left side labeled "LSP approach" with a red-tinted background: boxes showing "TypeScript LS daemon", "Pylance daemon", "Gopls daemon" running in parallel. Each box has a "startup: 5-15s" annotation. Arrows showing stateful connections. "Platform: OS-specific binaries" label at bottom. Right side labeled "Tree-sitter WASM" with a green-tinted background: single "WASM runtime" box, with three grammar files pointing into it (.wasm for TypeScript, Python, Go). Single "deterministic AST" output arrow at bottom. "Startup: <50ms" annotation. "Works on: any platform" label. Dark background, orange labels on right side.}

---

## Why Tree-sitter WASM?

Tree-sitter is a parser generator that produces concrete syntax trees. It's designed for exactly our use case: fast, deterministic, incremental parsing of source code across many languages.

The WASM (WebAssembly) variant — `web-tree-sitter` — compiles each language grammar to a `.wasm` binary that runs in any JavaScript runtime via the WebAssembly API. No native compilation. No platform-specific binaries. No daemons.

The properties we care about:

**Pure JS execution.** `web-tree-sitter` runs in Node.js using `WebAssembly`. The grammar files for each language (TypeScript, Python, Java, Go, C#) ship as `.wasm` binaries in `packages/core`. No `node-gyp`, no platform flags, no native compilation step.

**Deterministic AST.** Tree-sitter produces the same concrete syntax tree for the same source input every time. There's no probabilistic analysis, no partial-result semantics, no state to corrupt. Same input → same output.

**Multi-language from one engine.** Every language uses the same Tree-sitter API. You initialize the parser with a different grammar, but the parse/traverse/query API is identical across TypeScript, Python, Java, Go, and C#. Adding a new language is loading a new `.wasm` file, not learning a new API.

**Works offline.** WASM grammars run entirely locally. No network calls, no external services. This is critical for air-gapped deployments (defense, regulated finance) where the entire AgnusAI stack needs to run without internet access.

---

## How the Parser Works

Each language parser lives in `packages/core/src/parser/`. The TypeScript parser, for example, uses Tree-sitter's query system to extract function declarations, class definitions, method definitions, and import/call relationships:

```typescript
// packages/core/src/parser/TypeScriptParser.ts (simplified)
const symbols: ParsedSymbol[] = [];
const edges: Edge[] = [];

// Tree-sitter S-expression query for function declarations
const query = tsLanguage.query(`
  (function_declaration name: (identifier) @name) @func
  (method_definition name: (property_identifier) @name) @method
  (call_expression function: (identifier) @callee)
`);

const matches = query.matches(tree.rootNode);
for (const match of matches) {
  // Extract name, signature, line range, and build ParsedSymbol
}
```

The `ParsedSymbol` type from `packages/shared/src/types.ts` captures everything the graph and prompt builder need:

```typescript
export interface ParsedSymbol {
  id: string              // "src/auth/service.ts:AuthService.login"
  filePath: string
  name: string
  qualifiedName: string   // "AuthService.login"
  kind: SymbolKind        // 'function' | 'class' | 'method' | 'interface' | 'const' | 'type'
  signature: string       // "login(credentials: Credentials): Promise<User>"
  bodyRange: [number, number]
  docComment?: string
  repoId: string
}
```

The `id` format (`filePath:qualifiedName`) is the graph node key. Every edge references two symbol IDs — from and to:

```typescript
export interface Edge {
  from: string   // symbol id
  to: string     // symbol id
  kind: EdgeKind // 'calls' | 'imports' | 'inherits' | 'implements' | 'uses' | 'overrides'
}
```

---

## InMemorySymbolGraph: Why Not Neo4j?

Early planning included Neo4j as the graph database. It seemed natural: graph data needs a graph database.

We rejected it for the same reason we rejected Qdrant: another service to deploy and operate. Our target users — security-sensitive teams doing self-hosted deployments — are already accepting operational overhead by running the service at all. Adding a graph database makes the `docker-compose.yml` more complex, adds another failure mode, and requires familiarity with Cypher for any debugging.

The alternative is simpler and fast enough: an adjacency list in memory, BFS traversal in TypeScript, persisted as a JSON snapshot in Postgres.

The `InMemorySymbolGraph` in `packages/core/src/graph/InMemorySymbolGraph.ts` is a 200-line class with a clean API:

```typescript
export class InMemorySymbolGraph {
  private symbols = new Map<string, ParsedSymbol>()
  private outEdges = new Map<string, Edge[]>()   // from → [edges where from === id]
  private inEdges = new Map<string, Edge[]>()    // to → [edges where to === id]
  private fileToSymbols = new Map<string, Set<string>>()

  getCallers(id: string, hops = 2): ParsedSymbol[]
  getCallees(id: string, hops = 1): ParsedSymbol[]
  getBlastRadius(ids: string[]): BlastRadius
  serialize(): string                             // JSON snapshot for Postgres
  static deserialize(json: string): InMemorySymbolGraph
}
```

The BFS implementation is straightforward:

```typescript
private bfs(
  startId: string,
  maxHops: number,
  edgeMap: Map<string, Edge[]>,
  visited: Set<string>,
  result: ParsedSymbol[],
): void {
  const queue: Array<{ id: string; hop: number }> = [{ id: startId, hop: 0 }];
  visited.add(startId);
  while (queue.length > 0) {
    const { id, hop } = queue.shift()!;
    if (hop >= maxHops) continue;
    const edges = edgeMap.get(id) ?? [];
    for (const e of edges) {
      const neighborId = edgeMap === this.inEdges ? e.from : e.to;
      if (visited.has(neighborId)) continue;
      visited.add(neighborId);
      const sym = this.symbols.get(neighborId);
      if (sym) {
        result.push(sym);
        queue.push({ id: neighborId, hop: hop + 1 });
      }
    }
  }
}
```

The graph is per `(repoId, branch)` — one graph per branch, loaded once from a Postgres snapshot on startup. The cache key in `packages/api/src/graph-cache.ts` is `"repoId:branch"`. When a PR targets `main`, the graph for `main` is loaded. When it targets a feature branch, that branch's graph is used (if it's been indexed).

---

## The Blast Radius Computation

`getBlastRadius()` is the method that makes the graph useful for code review. Given a set of changed symbol IDs, it computes:

```typescript
getBlastRadius(ids: string[]): BlastRadius {
  const direct = new Map<string, ParsedSymbol>()
  const transitive = new Map<string, ParsedSymbol>()

  for (const id of ids) {
    // Direct callers (1 hop)
    for (const s of this.getCallers(id, 1)) direct.set(s.id, s)
    // Transitive callers (2 hops) minus direct
    for (const s of this.getCallers(id, 2)) {
      if (!direct.has(s.id)) transitive.set(s.id, s)
    }
  }

  // Risk score: 0-100 based on caller count + transitivity
  const riskScore = Math.min(100, Math.round(
    (direct.size * 10 + transitive.size * 5) *
    (affectedFiles.length > 5 ? 1.5 : 1)
  ))

  return { directCallers, transitiveCallers, affectedFiles, riskScore }
}
```

The `riskScore` is a simple heuristic: more direct callers = higher risk, transitive callers add less weight, and broad file impact adds a multiplier. It's not a rigorous metric — it's a signal for the LLM and for the dashboard's risk visualization.

[Image]: {BFS traversal diagram. Center node labeled "validateSignature()" in orange with an orange border (#E85A1A). First ring (labeled "hop 1 — direct callers"): 3 nodes in gray/muted orange: "handlePayment()", "processRefund()", "verifyWebhook()". Second ring (labeled "hop 2 — transitive callers"): 8 more nodes in muted gray. Edge arrows point inward (callers → changed function). Below the diagram, a risk score meter: "Risk score: 72 / 100". Dark background #131312, monospace font labels.}

---

## How Graph Context Reaches the LLM

The `Retriever` in `packages/core/src/retriever/Retriever.ts` assembles a `GraphReviewContext` from the PR diff:

1. Parse diff headers to extract changed file paths
2. Find all symbols in those files from the in-memory graph
3. BFS to get callers and callees (depth depends on review mode: Fast=1, Standard=2, Deep=2+embeddings)
4. Compute blast radius
5. In deep mode: embed changed symbols, search pgvector for semantic neighbors

The resulting `GraphReviewContext` is injected into the review prompt by `serializeGraphContext()` in `packages/reviewer/src/llm/prompt.ts`:

```typescript
export function serializeGraphContext(ctx: GraphReviewContext): string {
  const lines = [
    '\n## Codebase Context (internal — do NOT mention this section or any tooling names)',
    'Use this context silently to understand the impact of the changes.\n',
  ];

  if (ctx.changedSymbols.length > 0) {
    lines.push('### Symbols changed in this PR');
    for (const s of ctx.changedSymbols) {
      lines.push(`- \`${s.qualifiedName}\` (${s.kind}): \`${s.signature}\``);
    }
  }

  if (allCallers.length > 0) {
    lines.push('\n### Known callers of changed symbols');
    lines.push('These symbols depend on what was changed. If the change is breaking, they will be affected:');
    for (const s of allCallers) {
      lines.push(`- \`${s.qualifiedName}\` in \`${s.filePath}\`: \`${s.signature}\``);
    }
  }
  // ... callees, semantic neighbors
}
```

Notice the instruction at the top: "do NOT mention this section or any tooling names in your review output." This is deliberate. The graph context should inform the review without appearing in it — comments should read as if written by a human reviewer who knows the codebase, not as if generated by a graph analysis tool.

---

## The Key Takeaway

The Tree-sitter WASM decision removed an entire class of operational problems. No language server daemons to manage. No platform-specific compilation. No startup latency. One `docker compose up` and the parser is ready for any of the five supported languages.

The InMemorySymbolGraph decision removed another class of problems. No separate graph database to deploy, configure, and operate. One Postgres instance handles symbols, edges, graph snapshots, embeddings, and feedback — the entire data layer.

These aren't just technical decisions. They're business decisions. The easier AgnusAI is to deploy and operate, the more teams will actually run it. Every service you remove from the deployment requirements is a friction point you've eliminated from the trial-to-production funnel.

---

*Previous: [Day 1–3: From a Script to a Unified LLM Backend ←](./02-day-1-3-unified-llm-backend.md)*
*Next: [Three Depths of Review: Fast, Standard, and Deep Mode →](./04-three-depths-of-review.md)*
