# Day 1–3: From a Script to a Unified LLM Backend

*Part 2 of 7 in the "Building AgnusAI" series*

---

The first working version of AgnusAI was embarrassing. Not in a "humble origins" way — in a genuine "this is not a product" way. It was a single TypeScript file. It fetched a GitHub PR diff using a hardcoded personal access token, concatenated it with a hardcoded system prompt, sent it to OpenAI's API, and printed the response to stdout.

It worked. That was the only thing it had going for it.

The first commit that became AgnusAI was essentially: `fetch diff → call OpenAI → print result`. No structure. No error handling. No VCS abstraction. No multi-LLM support. Just enough to prove the loop was worth closing.

What happened over the next three days was the architecture crystallizing — not through up-front design, but through a series of concrete problems that forced the right abstractions.

---

## Day 0: The First Script

TypeScript was the right call from the start. The tooling for AST parsing (which we knew we'd need eventually), type safety for the complex data structures that a code reviewer requires, and the Node.js ecosystem's excellent library support made it the obvious choice over Python or Go.

The initial script looked roughly like this:

```typescript
const diff = await fetchGitHubDiff(PR_NUMBER, GITHUB_TOKEN);
const response = await openai.chat.completions.create({
  model: 'gpt-4',
  messages: [
    { role: 'system', content: REVIEW_SYSTEM_PROMPT },
    { role: 'user', content: diff }
  ]
});
console.log(response.choices[0].message.content);
```

Two things were immediately clear:
1. The loop worked. LLM + diff → useful review comments. The concept was sound.
2. This was not a product. It was a proof of concept that needed a structure around it.

The two problems that forced the first architectural decision were: (a) we wanted to try Ollama, not just OpenAI, and (b) a teammate was using GitHub but wanted to test on an Azure DevOps repo. Both problems had the same solution: interfaces.

---

## The Vercel AI SDK Experiment (And Why We Threw It Away)

The first attempt at a multi-LLM abstraction used the Vercel AI SDK. It seemed like the obvious choice — it already had adapters for OpenAI, Anthropic, and others, had decent streaming support, and had a well-documented API.

We spent about half a day with it before abandoning it.

The issues were practical, not philosophical:

**Streaming quirks.** The Vercel SDK's streaming API is designed around UI-first use cases (streaming text to a browser). Our use case is generate-and-parse: we want the full response as a string before we run it through the comment parser. Adapting the streaming API to a non-streaming use case added more code than writing a simple HTTP client.

**Limited Azure support.** Azure OpenAI has a non-standard API signature — different endpoint patterns, different auth headers, an `api-version` query parameter. The Vercel SDK's Azure adapter was incomplete at the time and required workarounds that negated the benefit of using the abstraction.

**Loss of control.** Review quality depends heavily on the exact prompts, parameters, and response handling. The SDK's opinionated approach to message formatting and parameter handling made it hard to control the exact request being sent.

The decision was: write our own `LLMBackend` interface. It's 15 lines of TypeScript. It does exactly what we need and nothing more.

---

## The LLMBackend Interface

The core abstraction that drives all of AgnusAI's review logic is simple:

```typescript
// packages/reviewer/src/llm/base.ts
export interface LLMBackend {
  generateReview(context: ReviewContext): Promise<ReviewResult>;
}
```

One method. One input type. One output type. Every LLM adapter implements this interface.

The four concrete implementations are `OllamaBackend`, `OpenAIBackend`, `ClaudeBackend`, and `AzureOpenAIBackend`. They share a common structure: take the `ReviewContext`, call `buildReviewPrompt()` to serialize it into a string, send it to the respective API, and run the response through `parseReviewResponse()` to extract structured comments.

```typescript
// Example: what every backend does internally
async generateReview(context: ReviewContext): Promise<ReviewResult> {
  const prompt = buildReviewPrompt(context);
  const rawResponse = await this.callLLMAPI(prompt);
  return parseReviewResponse(rawResponse);
}
```

The `buildReviewPrompt()` function (`packages/reviewer/src/llm/prompt.ts`) and `parseReviewResponse()` function (`packages/reviewer/src/llm/parser.ts`) are shared across all backends. The prompt format and response parser are LLM-agnostic. This means switching from OpenAI to Ollama doesn't change review behavior — only the inference engine changes.

[Image]: {Architecture diagram showing the LLM abstraction layer. A single "PRReviewAgent" box at the top, with a downward arrow labeled "generateReview(context)". Below it, a "LLMBackend interface" box in orange (#E85A1A border). Below that, four equal-sized boxes in a row: "OllamaBackend", "OpenAIBackend", "ClaudeBackend", "AzureOpenAIBackend". All four connected to the interface box with upward arrows. Dark terminal background #131312, monospace labels, hairline borders, 0px border-radius.}

The `UnifiedLLMBackend` sits on top of these adapters as a convenience layer — it reads the `PROVIDER` environment variable and instantiates the correct backend. Teams running in Docker just set `PROVIDER=ollama` or `PROVIDER=openai` and everything wires up automatically.

---

## VCS Adapters: The Same Pattern

The same abstraction pattern applies to version control. The `VCSAdapter` interface has methods like `getPR()`, `getDiff()`, `getFiles()`, `submitReview()`, and `getLinkedTickets()`. Both `GitHubAdapter` and `AzureDevOpsAdapter` implement it.

The diff between implementing GitHub and Azure DevOps support was instructive. GitHub's API is clean and consistent. Azure DevOps is... not.

The most interesting difference: how you get incremental diffs. On GitHub, we compare commit SHAs directly — `GET /repos/{owner}/{repo}/compare/{base}...{head}`. On Azure, you use the `$compareTo` parameter on the pull request iteration API:

- For a newly created PR: `$compareTo=0` — gives you the full cumulative diff
- For a PR update (new commits pushed): `$compareTo=latest.id - 1` — gives you only the delta since the last iteration

This turned out to be important for the incremental review feature we built later (covered in Post 4). Having the VCS adapter abstract this away meant the incremental review logic in `PRReviewAgent` didn't need to know anything about the underlying VCS.

---

## The PRReviewAgent Orchestrator

By end of day 2, the core flow had crystallized into `PRReviewAgent` — the main orchestrator that lives in `packages/reviewer/src/index.ts`.

Its `review()` method follows a clear sequence:

```typescript
async review(prId: string | number, graphContext?: GraphReviewContext): Promise<ReviewResult> {
  // 1. Fetch PR data
  const pr = await this.vcs.getPR(prId);
  const diff = await this.vcs.getDiff(prId);
  const files = await this.vcs.getFiles(prId);

  // 2. Get linked tickets
  const linkedTicketIds = await this.vcs.getLinkedTickets(prId);
  // ... fetch ticket content from Jira/Linear adapters

  // 3. Load applicable skills
  const applicableSkills = await this.skills.matchSkills(
    files.map(f => f.path)
  );

  // 4. Build context
  const context: ReviewContext = {
    pr, diff, files, tickets, skills: applicableSkills,
    config: this.config.review,
    graphContext,  // optional — injected from the API layer
  };

  // 5. Run review
  const result = await this.llm.generateReview(context);

  // 6. Precision filter — drop low-confidence comments
  const threshold = this.config.review?.precisionThreshold ?? 0.7;
  const { kept, filtered } = filterByConfidence(result.comments, { minConfidence: threshold });
  result.comments = kept.length > 0 ? kept : result.comments.filter(c => c.confidence === undefined);

  return result;
}
```

A few design decisions worth noting:

**`graphContext` is optional.** The CLI reviewer can run without a graph — it falls back to flat-diff review. The API layer injects graph context when it's available. This means the same `PRReviewAgent` code runs in both the CLI and the hosted service without modification.

**Skills are YAML files.** The `packages/reviewer/skills/` directory contains YAML files that define domain-specific review instructions — security checks, performance patterns, API design rules. The `SkillLoader` matches files in the diff against skill patterns and injects the relevant instructions into the prompt. Teams can add their own skill files without touching the core code.

**Precision filter is built in.** By day 3, we'd already noticed that LLM reviews produced noise — confident-sounding comments about things that weren't actually issues. The precision filter (covered in depth in Post 6) was added as a final step in the `review()` method. It's not optional; it runs on every review.

---

## The postReview Path Validation

One problem we hit early: the LLM would sometimes hallucinate file paths. It would reference a file like `/src/utils/helpers.ts` when the actual diff had the file at `src/utils/helpers.ts` (no leading slash). Or it would comment on a file that wasn't in the diff at all.

The `postReview()` method handles this with a path validation step before submitting:

```typescript
async postReview(prId: string | number, result: ReviewResult): Promise<void> {
  const diffPathMap = new Map<string, string>(); // normalised → original
  for (const f of diff.files) {
    diffPathMap.set(f.path.replace(/^\//, ''), f.path);
  }

  const validComments: ReviewComment[] = [];
  for (const comment of result.comments) {
    const normalised = comment.path.replace(/^\//, '');
    const resolvedPath = diffPathMap.get(normalised);
    if (!resolvedPath) {
      console.warn(`⚠️  Skipping comment — path not in diff: ${comment.path}`);
      continue;
    }
    validComments.push({ ...comment, path: resolvedPath });
  }
  // ...
}
```

This is the kind of defensive code that you only write after watching an LLM comment on a file that doesn't exist. It's not interesting architecture — it's just necessary.

---

## What We Threw Away

By end of day 3, we'd discarded three things we thought we'd use:

**Vercel AI SDK** — described above. Too opinionated for our use case.

**Qdrant as vector store** — early planning assumed we'd need a dedicated vector database for semantic search. We had a half-built Qdrant adapter before realizing: we're already depending on Postgres (for symbols, edges, and graph snapshots). The `pgvector` extension adds vector search to Postgres without adding another service to deploy. One `docker compose up`, not two.

**LSP for symbol analysis** — the original plan for understanding the codebase was to spin up language servers (TypeScript Language Server, Pylance, etc.) for symbol resolution. We discarded this within the first hour of serious thought. Language servers are stateful daemons with complex lifecycle management, slow startup, and platform-specific setup. The right tool was static parsing with Tree-sitter — covered in the next post.

---

## The Key Takeaway

The first three days weren't about building features. They were about finding the right shape for the problem.

The `LLMBackend` interface, `VCSAdapter` interface, and `PRReviewAgent` orchestrator pattern emerged from concrete friction — not from designing a clean architecture in advance. The Vercel SDK experiment, the Qdrant consideration, and the LSP exploration were all necessary detours that clarified what we actually needed.

The pattern that emerged — thin interfaces, concrete adapters, a single orchestrator — has remained stable through the entire project. Everything we've built since has plugged into this structure without requiring changes to it.

---

*Previous: [Why We Built AgnusAI ←](./01-why-we-built-agnus-ai.md)*
*Next: [The Graph Engine: Why We Chose Tree-sitter WASM Over a Language Server →](./03-graph-engine-tree-sitter.md)*
