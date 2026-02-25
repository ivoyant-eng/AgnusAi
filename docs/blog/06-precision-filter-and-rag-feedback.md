# Signal vs. Noise: Building the Precision Filter and RAG Feedback Loop

*Part 6 of 7 in the "Building AgnusAI" series*

---

There's a problem with LLM-powered code review that nobody talks about because everyone is still in the "isn't this amazing" phase of the adoption curve: **the signal-to-noise ratio is terrible by default.**

LLMs are confident. They'll flag a potential null dereference with the same tone as "you might want to consider renaming this variable for clarity." They'll post 12 comments on a PR, 9 of which are style preferences and 3 of which are actual bugs. After a few PRs like this, developers stop reading the reviews. The tool becomes wallpaper.

This is the "cry wolf" problem applied to code review. And it's not a bug in the LLM — it's a fundamental characteristic of how these models generate output. They produce plausible-sounding observations at whatever confidence level gets them to the right output format.

We built two features specifically to address this: the **precision filter** and the **RAG feedback loop**. Together, they make AgnusAI reviews get better over time, and they make sure that every comment that reaches a developer is high-signal.

---

## The Noise Problem in Practice

In early testing without filtering, a typical AgnusAI review on a medium-sized PR looked like this:

- 3 comments about missing null checks (real issues)
- 2 comments about error handling that the LLM wasn't sure about
- 2 style preferences ("consider using const instead of let")
- 1 observation about a comment that "could be more descriptive"
- 1 note about a package import order
- 1 speculation about whether a function name was clear enough

The 3 null check comments were genuinely useful. The other 7 ranged from debatable to noise. But because everything was presented in the same format with the same apparent authority, the useful comments were buried.

The classic S/N problem: low-quality signals drown out high-quality ones. The solution needs to happen at the source, before comments reach the PR.

---

## The Precision Filter: Making the LLM Self-Assess

The insight: if the LLM is generating the confidence along with the comment, it can also generate a confidence score for that comment. Ask it to, and use the score to filter.

The prompt addition in `packages/reviewer/src/llm/prompt.ts`:

```
## Confidence Scoring (REQUIRED)
For EACH comment, include a self-assessed confidence score at the end of the comment body.

Format: add [Confidence: X.X] at the end of the comment body, where X.X is a decimal from 0.0 to 1.0.

Scoring guide:
- 0.9-1.0: Definite bug, security issue, or clear correctness problem
- 0.7-0.9: Likely issue with clear impact
- 0.5-0.7: Potential issue, may be stylistic
- 0.0-0.5: Speculative — omit these entirely unless critical
```

The parser in `packages/reviewer/src/llm/parser.ts` extracts the confidence score and removes it from the displayed comment body:

```typescript
// Extract confidence score from body (format: [Confidence: X.X])
const confidenceMatch = body.match(/\[Confidence:\s*([\d.]+)\]/i);
const confidence = confidenceMatch ? parseFloat(confidenceMatch[1]) : undefined;
// Remove confidence marker from body
const cleanBody = body.replace(/\[Confidence:\s*[\d.]+\]\s*/i, '').trim();

comments.push({
  path: markers[i].path,
  line: markers[i].line,
  body: cleanBody,
  severity: detectSeverity(body),
  confidence: confidence,  // stored on the comment object
});
```

The `confidence` field is stored on `ReviewComment` but never shown in the PR comment body. It's a internal signal, not developer-facing output.

Then `filterByConfidence()` in `packages/reviewer/src/review/precision-filter.ts` applies the threshold:

```typescript
export function filterByConfidence(
  comments: ReviewComment[],
  config: PrecisionFilterConfig = DEFAULT_PRECISION_CONFIG
): FilteredByConfidence {
  const kept: ReviewComment[] = [];
  const filtered: ReviewComment[] = [];

  for (const comment of comments) {
    // Keep comments without confidence scores (backward compatibility)
    if (comment.confidence === undefined) {
      kept.push(comment);
      continue;
    }

    if (comment.confidence >= config.minConfidence) {
      kept.push(comment);
    } else {
      filtered.push(comment);
    }
  }

  return { kept, filtered, stats: { total: comments.length, kept: kept.length, filtered: filtered.length } };
}
```

The default threshold is 0.7, configurable via the `PRECISION_THRESHOLD` environment variable. At 0.7, comments that the LLM rates as "style preferences" or "speculative" are dropped before they reach the PR. Only "likely issue with clear impact" and above are posted.

The filter runs in both `review()` and `incrementalReview()` in `PRReviewAgent`:

```typescript
// packages/reviewer/src/index.ts
const threshold = this.config.review?.precisionThreshold ?? 0.7;
const { kept, filtered } = filterByConfidence(result.comments, { minConfidence: threshold });
if (filtered.length > 0) {
  console.log(`🎯 Precision filter: ${kept.length}/${result.comments.length} comments kept (threshold ${threshold})`);
}
result.comments = kept.length > 0 ? kept : result.comments.filter(c => c.confidence === undefined);
```

[Image]: {Before/after split diagram on dark background. Left panel "Without Precision Filter": 8 PR comments listed vertically. Each has a colored dot: 3 orange dots (high confidence), 5 gray dots (low confidence). Gray comments labeled: "variable naming", "could add docstring", "import order", "consider const", "style preference". Right panel "With Precision Filter (threshold 0.7)": 3 comments remain, all orange dots. Labels: "null deref — auth token", "missing boundary check", "unhandled rejection path". Text at bottom of right panel: "3 of 8 comments posted". Clean editorial layout, monospace text, hairline dividers.}

---

## Does It Actually Work?

Yes, with a caveat.

The LLM's confidence self-assessment is not perfectly calibrated. It will sometimes rate a genuine bug at 0.65 (just below threshold) and a style preference at 0.75 (above threshold). The scoring is noisy.

But "noisy" doesn't mean "not useful." In practice, the LLM's confidence scores correlate well with what human reviewers consider actionable. The scoring guide in the prompt creates an anchor: "0.9-1.0 = definite bug" gives the model something specific to reason about. The result is that high-threshold comments lean toward correctness and security issues, and low-threshold comments lean toward stylistic observations.

The key insight: you don't need perfect calibration. You need good enough calibration that filtering at 0.7 significantly improves S/N. In testing, it reduced average comment count from 8-12 per review to 3-5, while keeping nearly all the comments that developers actually acted on.

Teams can tune the threshold via `PRECISION_THRESHOLD`. Security-conscious teams running `0.9` get only the highest-confidence flags. Teams who want more coverage and are willing to accept some noise can run `0.5`.

---

## The RAG Feedback Loop: Reviews That Learn From Your Team

Precision filtering is a static improvement — it applies the same threshold to every review. The feedback loop is a dynamic improvement: it uses each team's history of accepted review comments to make future reviews more relevant.

The mechanism:

1. **Feedback URL in every PR comment.** When AgnusAI posts a comment, it appends a thumbs-up link at the bottom: `Was this helpful? → [👍 Yes]`. The link encodes the comment ID and signal, signed with an HMAC.

2. **Developer clicks 👍.** The HMAC-signed URL hits `GET /api/feedback?id=X&signal=accepted&token=HMAC`. The server validates the token, upserts the signal to the `review_feedback` table.

3. **Accepted comments get embedded.** A background process (or on-demand at index time) embeds accepted comments and stores them in pgvector alongside the symbol embeddings.

4. **Next review retrieves top-5 similar examples.** The `Retriever` queries pgvector for past accepted comments that are semantically similar to the current diff, and injects them as `## Examples of feedback your team found helpful` in the prompt.

The prompt injection in `packages/reviewer/src/llm/prompt.ts`:

```typescript
const examplesSection = (graphContext?.priorExamples?.length)
  ? `\n## Examples of feedback your team found helpful\n` +
    `These are past review comments on this repo that developers marked as useful. ` +
    `Use them as a guide for the style and depth of feedback that resonates with this team.\n\n` +
    graphContext.priorExamples.map(e => `---\n${e}`).join('\n\n') + '\n'
  : '';
```

The `priorExamples` field on `GraphReviewContext` in `packages/shared/src/types.ts` carries these examples:

```typescript
export interface GraphReviewContext {
  changedSymbols: ParsedSymbol[]
  callers: ParsedSymbol[]
  callees: ParsedSymbol[]
  blastRadius: BlastRadius
  semanticNeighbors: ParsedSymbol[]
  priorExamples?: string[]  // injected from review_feedback + pgvector retrieval
}
```

[Image]: {Flywheel diagram on dark background. Four nodes arranged in a clockwise circle: 1. "LLM posts review comment" (top, orange border), 2. "Developer rates 👍 or 👎" (right, gray border), 3. "Accepted comment embedded + stored in pgvector" (bottom, gray border), 4. "Next review retrieves top-5 similar examples" (left, orange border). Orange arrows connecting them clockwise. Center label in orange: "Feedback Flywheel". Thin hairline arrows. Monospace labels.}

---

## The HMAC-Signed Feedback URL

The feedback URL design needed to solve a specific problem: preventing arbitrary signal injection. If the URL is just `GET /api/feedback?id=123&signal=accepted`, anyone who knows the URL structure can fake a thumbs-up on any comment. That would corrupt the training signal.

The solution: HMAC signing. When generating a feedback URL:

```typescript
const token = crypto
  .createHmac('sha256', process.env.FEEDBACK_SECRET!)
  .update(`${commentId}:${signal}`)
  .digest('hex');

const url = `${API_BASE}/api/feedback?id=${commentId}&signal=accepted&token=${token}`;
```

On the server side (`packages/api/src/routes/feedback.ts`):

```typescript
const expected = crypto
  .createHmac('sha256', secret)
  .update(`${id}:${signal}`)
  .digest('hex');

// Timing-safe comparison to prevent timing attacks
const valid = crypto.timingSafeEqual(
  Buffer.from(expected, 'hex'),
  Buffer.from(token, 'hex')
);
```

`crypto.timingSafeEqual` is important here. A naive string comparison (`expected === token`) leaks timing information that can be used to guess the HMAC byte by byte. Timing-safe comparison takes constant time regardless of where the comparison fails.

When the HMAC is valid, the feedback is upserted to Postgres:

```sql
INSERT INTO review_feedback (comment_id, signal)
VALUES ($1, $2)
ON CONFLICT (comment_id) DO UPDATE SET signal = EXCLUDED.signal, created_at = NOW()
```

`ON CONFLICT ... DO UPDATE` means a developer can change their vote — 👍 then 👎 — and only the most recent signal is stored.

---

## The Terminal Thank-You Page

When a developer clicks the feedback link, they shouldn't see a blank page or a JSON response. They should feel like the action completed. We built a small HTML page that renders in a terminal aesthetic — consistent with the AgnusAI brand:

```
> agnus feedback record --signal accepted
✓ signal recorded  accepted
✓ model will improve on next review

Thanks for your feedback! ▮
```

The page uses JetBrains Mono, a blinking cursor, and the project's dark-background terminal style. It takes about 300ms to render and gives a clear confirmation. There's no redirect, no loading state, no React — just a static HTML template rendered by the Fastify handler.

The detail that makes it feel complete: the cursor blinks at 1.1s intervals using a CSS animation. It's a tiny UX touch that makes the page feel alive rather than static.

---

## Learning Metrics in the Dashboard

The feedback loop produces measurable data. The dashboard's **Feedback** page shows:

- **Accepted vs. rejected over time** — a time series chart showing whether the acceptance rate is trending up (the model is improving) or flat (the feedback loop isn't providing useful signal yet).
- **Per-repo breakdown** — each repo builds its own knowledge base. A team with 3 months of feedback has a meaningfully better-tuned reviewer than a fresh deployment.
- **Comment count trend** — as the precision filter calibrates and prior examples improve prompt quality, you'd expect to see comment counts stabilize or decrease while acceptance rate increases.

These metrics aren't just informational — they're the proof of the value proposition. If a team can show "acceptance rate went from 40% to 75% over 3 months," that's a compelling argument for continued use and for enterprise expansion.

---

## The Key Takeaway

The precision filter and feedback loop address different timescales of the noise problem.

The precision filter solves the immediate S/N problem: right now, on every review, drop the low-confidence noise before it reaches developers. It's a static improvement that works from day one.

The feedback loop solves the long-term calibration problem: over time, teach the reviewer what this team considers actionable. It requires time and engagement to produce value, but the value compounds. After six months of feedback, an AgnusAI instance knows your team's conventions, your risk tolerance, and the kinds of issues you actually care about. That knowledge doesn't transfer to a competitor's tool. It's compounding defensibility.

---

*Previous: [Building the Hosted Service: Monorepo, Fastify, and the Dashboard ←](./05-hosted-service-monorepo-fastify.md)*
*Next: [Business Implications: Open-Source Moat, ICP, and the Path to Enterprise →](./07-business-implications.md)*
