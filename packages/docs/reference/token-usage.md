# Token Usage

Ryv tracks LLM token consumption per agent run and aggregates it at the org level so you can monitor costs, understand usage patterns, and plan capacity.

## What Is Tracked

For every agent run in a multi-agent review, the following is recorded in `review_agent_telemetry`:

| Field | Description |
|-------|-------------|
| `tokens_used` | Total tokens = prompt tokens + completion tokens |
| `agent_role` | Which specialist agent consumed the tokens |
| `org_id` / `repo_id` | Used for org-level and repo-level aggregation |
| `created_at` | Timestamp for date-range filtering |

Token counts are provided by the underlying LLM provider SDK (`inputTokens + outputTokens` from the Vercel AI SDK). If a provider does not return usage data, the field is `null`.

## Viewing Token Usage

### Settings → Token Usage

The **Token Usage** page in Settings (`/app/settings` → Token Usage) provides:

- **Custom date range picker** with quick presets (7d / 30d / 90d / 365d)
- **Grand total** tokens for the period
- **By Agent** — breakdown per specialist agent (runs, total tokens, avg per run)
- **By Repository** — which repos are consuming the most tokens
- **Daily breakdown** — day-by-day token and run counts

This page is visible to org admins only.

### API

```bash
GET /api/orgs/:orgKey/token-usage?from=2026-01-01&to=2026-02-01
```

**Query parameters:**

| Parameter | Format | Default | Description |
|-----------|--------|---------|-------------|
| `from` | `YYYY-MM-DD` | 30 days ago | Start of date range (inclusive) |
| `to` | `YYYY-MM-DD` | Today | End of date range (inclusive) |

**Response:**

```json
{
  "orgKey": "default",
  "from": "2026-01-01",
  "to": "2026-02-01",
  "totalTokens": 284500,
  "byAgent": [
    { "role": "security",    "runs": 42, "totalTokens": 63200, "avgTokens": 1504 },
    { "role": "correctness", "runs": 42, "totalTokens": 61800, "avgTokens": 1471 },
    { "role": "performance", "runs": 40, "totalTokens": 58400, "avgTokens": 1460 },
    { "role": "style_maintainability", "runs": 42, "totalTokens": 57400, "avgTokens": 1366 },
    { "role": "blast_radius", "runs": 38, "totalTokens": 43700, "avgTokens": 1150 }
  ],
  "byRepo": [
    { "repoId": "...", "repoUrl": "https://github.com/org/api", "runs": 112, "totalTokens": 178000 },
    { "repoId": "...", "repoUrl": "https://github.com/org/web", "runs": 90,  "totalTokens": 106500 }
  ],
  "daily": [
    { "date": "2026-01-15", "totalTokens": 8400, "runs": 5 },
    { "date": "2026-01-16", "totalTokens": 12600, "runs": 8 }
  ]
}
```

Token data is also included in the repo-level agent telemetry endpoint:

```bash
GET /api/repos/:id/agent-telemetry?days=30
```

Each agent row includes `totalTokens` for that agent over the selected period.

## Token Estimates

Approximate token usage per review at different configurations:

| Mode | Agents | Diff size | Est. tokens/PR |
|------|--------|-----------|---------------|
| `single` (default) | 1 | 50k chars | ~4–8k |
| `fast` | 2 | 50k chars | ~8–16k |
| `thorough` | 5 | 50k chars | ~20–40k |
| `thorough` | 5 | 150k chars (max) | ~60–100k |

Actual usage depends on graph context depth, rules count, and number of prior examples injected.

## Controlling Costs

| Setting | Effect |
|---------|--------|
| `REVIEW_MODE=single` | Single agent — lowest token use |
| `REVIEW_MODE=fast` | Two agents — balanced |
| `REVIEW_MODE=thorough` | All agents — highest coverage |
| `MAX_DIFF_SIZE=75000` | Cap diff chars sent to LLM (default 150000) |
| `REVIEW_DEPTH=fast` | 1-hop graph only — reduces context tokens |
| `ENABLED_AGENTS=security,correctness` | Run specific agents only |
