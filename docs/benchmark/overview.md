# AgnusAI Benchmark Harness — Overview

> **Status:** Planned (`packages/benchmark/` — not yet implemented)
> **Goal:** Objectively compare AgnusAI review quality against PR-Agent, CodeRabbit, and GitHub Copilot on real PR diffs.

---

## Why We Built This

Marketing claims about review quality are cheap. Reproducible numbers are not. This harness exists to answer:

- Does AgnusAI catch more real bugs than PR-Agent on the same diff?
- How much noise does each tool generate on clean refactors?
- Does graph context (AgnusAI's moat) measurably improve detection rate?
- Do we regress after shipping new features?

---

## How to Run

```bash
# Install deps
pnpm install

# Run all tools on 30 PRs (requires GITHUB_TOKEN)
pnpm --filter @agnus-ai/benchmark run eval

# Run specific tools
pnpm --filter @agnus-ai/benchmark run eval -- --tools agnus,pragent --limit 30

# Debug a single PR
pnpm --filter @agnus-ai/benchmark run eval -- --entry astropy-pr-12907 --tools agnus

# Generate report from saved results
pnpm --filter @agnus-ai/benchmark run report
```

Results are written to `packages/benchmark/results/` (gitignored).

---

## What Gets Measured

| Metric | Definition |
|--------|------------|
| **Detection rate** | % of known issues flagged by at least one comment |
| **Avg comment score** | LLM judge scores each comment 0–5 on accuracy, actionability, relevance |
| **Noise rate** | % of comments that score below 2 on relevance (irrelevant to the diff) |
| **Comments per PR** | Average volume — too few misses issues, too many overwhelms developers |
| **Latency p50 / p95** | Time from diff submission to review posted |
| **Token cost** | Total tokens consumed per review (where reported) |

---

## Tools Compared

| Tool | How It Runs | Requirements |
|------|-------------|--------------|
| **AgnusAI** | Direct package import — no HTTP | `GITHUB_TOKEN` + LLM env vars |
| **PR-Agent** | CLI subprocess (`pr-agent --pr_url ... review`) | Python + `pip install pr-agent` + `OPENAI_KEY` |
| **CodeRabbit** | Manual (webhook-based, see `manual-runners.md`) | Free tier account |
| **GitHub Copilot** | Manual (GitHub subscription required) | GitHub Copilot subscription |

---

## Test Suite

Two tiers — both run together by default:

### Tier 1: Curated PRs (`data/test-suite.json`)
30–50 hand-picked, already-merged real PRs from popular open-source repos. Balanced across categories:

| Category | Count | What it tests |
|----------|-------|---------------|
| `bug` | 12 | Known logic/correctness issues — detection rate |
| `security` | 8 | CVE-linked or security-sensitive diffs — security coverage |
| `performance` | 6 | Algorithmic inefficiency — performance awareness |
| `clean_refactor` | 10 | No bugs — false positive / noise rate |
| `style_only` | 6 | Pure formatting — noise rate on trivial changes |

**Repos used:** astropy, django, flask, requests, next.js, express, fastify, prisma

Each entry has `expectedIssues` — a short list of what a good reviewer *should* flag. This is the ground truth for detection rate scoring.

### Tier 2: SWE-bench Verified
Auto-pulled from [SWE-bench/SWE-bench_Verified](https://huggingface.co/datasets/SWE-bench/SWE-bench_Verified) (500 entries, Python repos). Uses the `patch` diff and `problem_statement` as context. Useful for large-scale statistical comparisons but all Python — less representative of JS/TS teams.

---

## Scoring Methodology

See [`methodology.md`](./methodology.md) for the full rubric. Summary:

1. Each tool reviews every PR in the test suite
2. All comments are collected and stored as JSON
3. An LLM judge (same backend as AgnusAI — set via env vars) scores each comment:
   - **Accuracy (0–5):** Is the concern real and correct?
   - **Actionability (0–5):** Can a developer act on this immediately?
   - **Relevance (0–5):** Is this specifically about the code in the diff?
4. Detection rate is computed by matching comments against `expectedIssues` via LLM semantic match
5. Results are aggregated per tool, per category, and rendered as a markdown report

---

## Example Output

```
# AgnusAI Benchmark Report — March 2026
Test suite: 42 PRs | Tools: agnus, pragent

## Summary

| Tool       | Detection | Avg Score | Noise Rate | Comments/PR | p50 Latency |
|------------|-----------|-----------|------------|-------------|-------------|
| AgnusAI    | 78%       | 3.9 / 5   | 12%        | 8.2         | 18s         |
| PR-Agent   | 61%       | 3.1 / 5   | 28%        | 14.7        | 24s         |

## By Category

| Category        | AgnusAI Detection | PR-Agent Detection |
|-----------------|-------------------|--------------------|
| bug             | 83%               | 67%                |
| security        | 88%               | 50%                |
| performance     | 67%               | 58%                |
| clean_refactor  | —                 | —                  |
| style_only      | —                 | —                  |

## Noise Rate by Category

| Category       | AgnusAI | PR-Agent |
|----------------|---------|----------|
| clean_refactor | 9%      | 31%      |
| style_only     | 5%      | 22%      |
```

---

## Package Structure

```
packages/benchmark/
├── src/
│   ├── dataset/
│   │   ├── loader.ts        — loads curated test suite JSON
│   │   └── swebench.ts      — pulls SWE-bench Verified from HuggingFace
│   ├── runners/
│   │   ├── base.ts          — ReviewRunner interface
│   │   ├── agnus.ts         — direct PRReviewAgent call
│   │   ├── pragent.ts       — pr-agent CLI via child_process
│   │   └── coderabbit.ts    — stub + manual import docs
│   ├── scoring/
│   │   ├── rubric.ts        — score scale constants (AXIOM-inspired 0–5)
│   │   ├── judge.ts         — LLM-as-judge scorer
│   │   └── metrics.ts       — aggregate metric computation
│   ├── report/
│   │   └── markdown.ts      — renders markdown comparison table
│   └── cli.ts               — entry: pnpm benchmark run eval
├── data/
│   └── test-suite.json      — curated PR entries with ground truth
├── results/                 — gitignored output directory
└── package.json
```

---

## Environment Variables Required

| Variable | Used by | Description |
|----------|---------|-------------|
| `GITHUB_TOKEN` | All runners | Fetch PR diffs from GitHub API |
| `LLM_PROVIDER` | AgnusAI runner + Judge | Same as main stack (ollama / openai / anthropic) |
| `LLM_MODEL` | AgnusAI runner + Judge | Model to use |
| `OPENAI_API_KEY` | PR-Agent runner | PR-Agent requires OpenAI by default |
| `ANTHROPIC_API_KEY` | Optional | If using Claude as the judge |

---

## Limitations

- **AgnusAI without graph context:** The benchmark runs AgnusAI without a pre-indexed graph (no Postgres). This slightly disadvantages AgnusAI — a second tier with graph context enabled is planned.
- **LLM judge bias:** The judge LLM may favour comments written in a style similar to its own training data. Results should be validated with a sample of human scores.
- **CodeRabbit / Copilot:** Cannot be fully automated. Their results require manual collection (see `manual-runners.md`). Treat those columns as approximate.
- **SWE-bench is Python-only:** Weighted toward Python repos. The curated tier covers JS/TS.
