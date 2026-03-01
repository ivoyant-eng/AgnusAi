import type {
  AgentOutput,
  AgentRole,
  AgentTelemetry,
  ConsolidatedReview,
  ReviewComment,
  ReviewContext,
  ReviewResult,
} from '../types';
import type { LLMBackend } from '../llm/base';

const DEFAULT_AGENT_CONCURRENCY = 2;

const AGENT_DIRECTIVES: Record<AgentRole, string> = {
  security: 'Focus only on exploitable vulnerabilities, authn/authz gaps, unsafe data handling, and secrets exposure. Ignore style/perf unless it creates a concrete security risk.',
  correctness: 'Focus only on logic errors, race conditions, null/edge-case handling, and behavior regressions. Ignore stylistic feedback.',
  performance: 'Focus only on material performance issues: algorithmic complexity, redundant I/O, N+1 patterns, and hot-path inefficiencies.',
  style_maintainability: 'Focus only on maintainability that impacts future defects: complexity, readability of critical paths, and brittle abstractions. Avoid cosmetic nits.',
  ticket_compliance: 'Focus only on verifiable gaps: where the PR description or ticket explicitly claims a feature was implemented but the diff contains no evidence of it. Only flag what is definitively absent — you must be able to point to the missing code. Never post uncertainty or "verify this" comments. If the diff does not give you enough information to confirm an absence, stay silent.',
  blast_radius: 'Focus only on change impact in dependent callers/modules and identify missing adaptations or compatibility handling.',
};

function severityRank(level: ReviewComment['severity']): number {
  if (level === 'error') return 3;
  if (level === 'warning') return 2;
  return 1;
}

function pickStricterVerdict(a: ReviewResult['verdict'], b: ReviewResult['verdict']): ReviewResult['verdict'] {
  const order: Record<ReviewResult['verdict'], number> = {
    approve: 0,
    comment: 1,
    request_changes: 2,
  };
  return order[a] >= order[b] ? a : b;
}

function normalizeBody(body: string): string {
  return body
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[^\w\s:/.-]/g, '')
    .trim();
}

function dedupeComments(comments: ReviewComment[]): ReviewComment[] {
  const bestByKey = new Map<string, ReviewComment>();

  for (const comment of comments) {
    const key = `${comment.path}:${comment.line}:${normalizeBody(comment.body)}`;
    const existing = bestByKey.get(key);
    if (!existing) {
      bestByKey.set(key, comment);
      continue;
    }
    const existingConfidence = existing.confidence ?? 0;
    const nextConfidence = comment.confidence ?? 0;
    const existingScore = severityRank(existing.severity) * 10 + existingConfidence;
    const nextScore = severityRank(comment.severity) * 10 + nextConfidence;
    if (nextScore > existingScore) bestByKey.set(key, comment);
  }

  return Array.from(bestByKey.values());
}

function deterministicJudge(comments: ReviewComment[]): ReviewComment[] {
  // Judge pass: for same location, keep only the strongest single finding.
  const locationBest = new Map<string, ReviewComment>();
  for (const comment of comments) {
    const loc = `${comment.path}:${comment.line}`;
    const existing = locationBest.get(loc);
    if (!existing) {
      locationBest.set(loc, comment);
      continue;
    }
    const existingConfidence = existing.confidence ?? 0;
    const nextConfidence = comment.confidence ?? 0;
    const existingScore = severityRank(existing.severity) * 10 + existingConfidence;
    const nextScore = severityRank(comment.severity) * 10 + nextConfidence;
    if (nextScore > existingScore) locationBest.set(loc, comment);
  }
  return Array.from(locationBest.values());
}

function buildJudgePrompt(comments: ReviewComment[]): string {
  const numbered = comments.map((c, idx) => {
    const confidence = c.confidence ?? 0
    const agent = c.sourceAgent ?? 'unknown'
    return `${idx + 1}. [${c.path}:${c.line}] severity=${c.severity} confidence=${confidence} agent=${agent}\n${c.body}`
  }).join('\n\n')
  return [
    'You are the consolidation judge for PR review findings.',
    'Select only high-signal, non-duplicate, actionable findings.',
    'Prefer correctness/security/performance over style when conflicts exist.',
    'DISCARD any finding that uses hedging language such as "does not appear in the diff", "verify that", "not explicitly shown", "ensure this was implemented", or similar phrases that indicate the reviewer could not confirm the issue from the diff — these are not findings.',
    'Return output exactly in this format:',
    'KEEP: <comma-separated numbers or "none">',
    'VERDICT: approve|request_changes|comment',
    '',
    'Candidate findings:',
    numbered,
  ].join('\n')
}

function parseJudgeResponse(raw: string, maxIndex: number): { keep: number[]; verdict: ReviewResult['verdict'] } | null {
  const keepMatch = raw.match(/KEEP:\s*([^\n\r]+)/i)
  const verdictMatch = raw.match(/VERDICT:\s*(approve|request_changes|comment)/i)
  if (!keepMatch || !verdictMatch) return null
  const keepRaw = keepMatch[1].trim().toLowerCase()
  const keep = keepRaw === 'none'
    ? []
    : keepRaw
      .split(',')
      .map(v => Number.parseInt(v.trim(), 10))
      .filter(v => Number.isFinite(v) && v >= 1 && v <= maxIndex)
      .map(v => v - 1)
  return { keep: Array.from(new Set(keep)), verdict: verdictMatch[1].toLowerCase() as ReviewResult['verdict'] }
}

async function llmJudge(
  llm: LLMBackend,
  context: ReviewContext,
  comments: ReviewComment[],
): Promise<{ comments: ReviewComment[]; verdict?: ReviewResult['verdict'] } | null> {
  if (comments.length === 0) return { comments: [] }
  try {
    const prompt = buildJudgePrompt(comments)
    const response = await llm.generate(prompt, context)
    const parsed = parseJudgeResponse(response, comments.length)
    if (!parsed) return null
    return {
      comments: parsed.keep.map(i => comments[i]).filter(Boolean),
      verdict: parsed.verdict,
    }
  } catch {
    return null
  }
}

function buildEnabledRoles(context: ReviewContext): AgentRole[] {
  if (!context.config.multiAgentEnabled) return [];
  const mode = context.config.reviewMode ?? 'single';
  if (mode === 'single') return [];
  if (Array.isArray(context.config.enabledAgents) && context.config.enabledAgents.length > 0) {
    return context.config.enabledAgents;
  }
  const hasTickets = Array.isArray(context.tickets) && context.tickets.length > 0;
  const hasGraph = Boolean(context.graphContext);
  if (mode === 'fast') {
    return ['security', 'correctness'];
  }
  const base: AgentRole[] = ['security', 'correctness', 'performance', 'style_maintainability'];
  if (hasTickets) base.push('ticket_compliance');
  if (hasGraph) base.push('blast_radius');
  return base;
}

async function runWithConcurrency<T>(tasks: Array<() => Promise<T>>, concurrency: number): Promise<T[]> {
  const workerCount = Math.max(1, Math.min(concurrency, tasks.length));
  const results: T[] = new Array(tasks.length);
  let cursor = 0;
  async function worker(): Promise<void> {
    for (;;) {
      const i = cursor++;
      if (i >= tasks.length) return;
      results[i] = await tasks[i]();
    }
  }
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}

async function runSingleAgent(
  llm: LLMBackend,
  context: ReviewContext,
  role: AgentRole,
): Promise<AgentOutput> {
  const started = Date.now();
  try {
    const result = await llm.generateReview({
      ...context,
      agentRole: role,
      agentDirective: AGENT_DIRECTIVES[role],
    });
    const comments = result.comments.map(c => ({ ...c, sourceAgent: role }));
    const output: ReviewResult = { ...result, comments };
    const telemetry: AgentTelemetry = {
      role,
      durationMs: Date.now() - started,
      commentCount: comments.length,
      verdict: output.verdict,
      tokensUsed: result.tokensUsed,
    };
    return { role, result: output, telemetry };
  } catch (error: any) {
    const telemetry: AgentTelemetry = {
      role,
      durationMs: Date.now() - started,
      commentCount: 0,
      verdict: 'comment',
      error: error?.message || 'unknown agent error',
    };
    return {
      role,
      result: {
        summary: `${role} agent failed`,
        comments: [],
        suggestions: [],
        verdict: 'comment',
      },
      telemetry,
    };
  }
}

export async function runReviewWithSpecialists(
  llm: LLMBackend,
  context: ReviewContext,
): Promise<ConsolidatedReview | null> {
  const roles = buildEnabledRoles(context);
  if (roles.length === 0) return null;

  const concurrency = context.config.agentConcurrency ?? DEFAULT_AGENT_CONCURRENCY;
  const tasks = roles.map(role => () => runSingleAgent(llm, context, role));
  const outputs = await runWithConcurrency(tasks, concurrency);

  let verdict: ReviewResult['verdict'] = 'approve';
  const combinedComments: ReviewComment[] = [];
  const summaries: string[] = [];

  for (const output of outputs) {
    verdict = pickStricterVerdict(verdict, output.result.verdict);
    if (output.result.summary?.trim()) {
      summaries.push(`- ${output.role}: ${output.result.summary.trim()}`);
    }
    combinedComments.push(...output.result.comments);
  }

  const judgeEnabled = context.config.judgeEnabled !== false;
  const deduped = dedupeComments(combinedComments);
  let comments = deduped;
  if (judgeEnabled) {
    if (context.config.judgeMode === 'llm') {
      const judged = await llmJudge(llm, context, deduped);
      if (judged) {
        comments = judged.comments;
        if (judged.verdict) verdict = pickStricterVerdict(verdict, judged.verdict);
      } else {
        comments = deterministicJudge(deduped);
      }
    } else {
      comments = deterministicJudge(deduped);
    }
  }
  if (comments.length > 0 && verdict === 'approve') verdict = 'comment';

  const summary = summaries.length > 0
    ? `Multi-agent review summary\n${summaries.join('\n')}`
    : 'Multi-agent review completed with no findings.';

  return {
    summary,
    comments,
    suggestions: [],
    verdict,
    agentTelemetry: outputs.map(o => o.telemetry),
  };
}
