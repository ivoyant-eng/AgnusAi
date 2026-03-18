# Self-Reflection Quality Gate

Self-reflection is an optional second LLM pass that re-scores every review comment on a 0–10 quality scale and drops findings that fall below a configurable threshold. It runs after the judge consolidation step and before comments are posted.

## Why It Exists

The precision filter catches low-confidence comments at the individual comment level, but some comments may have high confidence yet still be low signal — vague suggestions, style nits, or findings without concrete evidence. Self-reflection adds a second dimension: *quality*, not just confidence.

## How It Works

```
Judge output (consolidated comments)
        │
        ▼
  Self-reflection LLM call
  — re-scores each comment 0–10
  — returns sorted list with scores
        │
        ▼
  Drop comments below SELF_REFLECTION_THRESHOLD
  (at least 1 comment always survives)
        │
        ▼
  Post to PR
```

Each comment is scored against this rubric:

| Score | Meaning |
|-------|---------|
| 9–10 | Concrete bug or security issue with direct evidence in the diff |
| 7–8 | Likely real, well-evidenced, minor uncertainty |
| 5–6 | Plausible but evidence is indirect or partial |
| 3–4 | Speculative, stylistic, missing context |
| 0–2 | Vague, unverifiable, pure noise |

## Configuration

```env
# Enable self-reflection (default: false)
SELF_REFLECTION_ENABLED=true

# Drop comments below this score (0–10, default: 5)
SELF_REFLECTION_THRESHOLD=6
```

**Threshold guidance:**

| Threshold | Effect |
|-----------|--------|
| `4` | Drops only noise; most comments survive |
| `6` | Balanced — drops speculative findings |
| `8` | Strict — only concrete, well-evidenced bugs survive |

Self-reflection guarantees a minimum of one comment survives per PR. If the threshold would drop everything, the single highest-scoring comment is kept.

## Token Cost

Self-reflection adds one extra LLM call per review (all consolidated comments sent in a single prompt). It uses the same `LLM_MODEL` as the main review.

Approximate overhead per PR:

| Mode | Extra tokens |
|------|-------------|
| Single-agent | ~3–5k |
| Multi-agent (thorough) | ~8–12k |

## Combining with the Precision Filter

Self-reflection and the precision filter are independent:

- **Precision filter** (`PRECISION_THRESHOLD`) — drops comments where the LLM self-reported low confidence during generation
- **Self-reflection** (`SELF_REFLECTION_THRESHOLD`) — drops comments that score poorly on a post-hoc quality rubric

Both can be enabled simultaneously. The precision filter runs first, then self-reflection operates on the surviving set.
