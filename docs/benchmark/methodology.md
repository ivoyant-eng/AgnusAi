# Benchmark Methodology

> How test PRs are selected, how comments are scored, and what the numbers mean.

---

## Dataset Curation Criteria

### Curated Tier (Tier 1)

A PR is included in the curated test suite if it meets all of these:

1. **Already merged** — no active debate, outcome is known
2. **Has a clear subsequent fix** (for bug/security categories) — a follow-up commit or issue proves the original PR introduced a problem
3. **Self-contained diff** — the change is understandable without deep domain knowledge
4. **300–3,000 lines changed** — small enough to review, large enough to be interesting
5. **Public repo** — fetchable without authentication issues

A PR is excluded if:
- The "bug" is purely aesthetic or opinion-based
- The fix required domain-specific knowledge no reviewer could reasonably have
- The diff is mostly generated/auto-formatted code

### SWE-bench Tier (Tier 2)

Pulled directly from [SWE-bench/SWE-bench_Verified](https://huggingface.co/datasets/SWE-bench/SWE-bench_Verified).
- The `patch` field (the bug fix diff) is used as the review target
- The `problem_statement` is used as context for the LLM judge
- Only entries with `difficulty: "15 min - 1 hour"` are included (avoids trivial and impossibly hard entries)

---

## LLM Judge

### Prompt

```
You are a senior software engineer evaluating an AI code review comment.

## PR Context
Repository: {repo}
PR Title: {title}
Diff (excerpt around the flagged location):
{diff_excerpt}

## Comment Being Evaluated
File: {file}
Line: {line}
Comment: {comment_body}

## Known Issue (Ground Truth)
{expected_issue_or_none}

## Your Task
Score this comment on three dimensions. Each dimension is scored 0–5:

ACCURACY (0–5): Is the concern raised by this comment real and technically correct?
  5 = Completely accurate, no factual errors
  4 = Mostly accurate, minor imprecision
  3 = Partially accurate, misses important nuance
  2 = Questionable — the concern might not be real
  1 = Technically incorrect
  0 = Factually wrong or hallucinated

ACTIONABILITY (0–5): Can a developer immediately act on this comment to improve the code?
  5 = Specific, clear fix is obvious from the comment
  4 = Clear direction, minor ambiguity
  3 = General direction, developer needs to figure out specifics
  2 = Vague — hard to know what to change
  1 = No actionable guidance
  0 = Actively misleading

RELEVANCE (0–5): Is this comment specifically about the code changed in this diff?
  5 = Directly about a changed line and its immediate context
  4 = About the changed file/function, not the specific line
  3 = About code nearby but not in the diff
  2 = Tangentially related
  1 = About a different part of the codebase
  0 = Completely unrelated

Respond with JSON only, no explanation outside the JSON:
{
  "accuracy": <0-5>,
  "actionability": <0-5>,
  "relevance": <0-5>,
  "reasoning": "<one sentence>"
}
```

### Composite Score

```
composite = (accuracy × 0.4) + (actionability × 0.35) + (relevance × 0.25)
```

Accuracy is weighted highest because an inaccurate comment is worse than no comment. Relevance is weighted lowest because a highly accurate comment about nearby code still has value.

---

## Detection Rate

For `bug` and `security` category PRs only.

**Algorithm:**
1. Each test entry has `expectedIssues: string[]` — 1 to 4 short descriptions of what a good reviewer should flag
2. For each expected issue, we check if any comment in the tool's output semantically matches it
3. Match is determined by the LLM judge: *"Does this comment address the following concern: {issue}? Answer yes or no."*
4. An issue is "detected" if at least one comment matches
5. Detection rate = detected issues ÷ total expected issues

---

## Noise Rate

For `clean_refactor` and `style_only` category PRs.

```
noise_rate = comments_scoring_below_2_on_relevance ÷ total_comments
```

A comment scoring 0 or 1 on relevance is flagged as noise — it's about something not in the diff.

For clean refactors (no intentional bugs): any comment scoring ≥ 3 on accuracy that also scores ≥ 4 on relevance is counted as a **false positive** — the reviewer raised a concern that wasn't there.

---

## Latency Measurement

- Measured from the moment the diff is handed to the runner until the structured output is returned
- Includes API round-trip time but excludes benchmark harness overhead
- Reported as p50 and p95 across the test suite for that tool
- AgnusAI without graph context (benchmark mode) is faster than production AgnusAI (which includes BFS graph traversal)

---

## Token Cost

Reported if the LLM backend returns token counts. For fair comparison:
- AgnusAI uses whatever `LLM_PROVIDER` is configured
- PR-Agent defaults to OpenAI GPT-4 (configurable)
- Cost is reported in raw token counts, not dollars (dollar rates change)

---

## Known Biases and Limitations

| Bias | Impact | Mitigation |
|------|--------|------------|
| LLM judge aligns with its own style | Tools using the same LLM as the judge may score higher | Run judge with a different provider than the reviewers |
| Curated PRs over-represent Python/JS | May not reflect enterprise Java/C# codebases | Expand test suite over time |
| AgnusAI runs without graph in benchmark | Under-represents AgnusAI's production quality | Add Tier 3: AgnusAI with full graph context |
| SWE-bench is all Python | Skews Tier 2 results | Use Tier 1 for JS/TS-specific claims |
| Ground truth is human-curated | `expectedIssues` may miss valid issues | Treat detection rate as a lower bound |

---

## Versioning Results

Each benchmark run produces a timestamped JSON file in `packages/benchmark/results/`:

```
results/
├── 2026-03-02T14:30:00Z_agnus-v3.1_pragent-v0.26.json
└── report-2026-03-02.md
```

Published results are committed to `docs/benchmark/results/` for historical comparison.
