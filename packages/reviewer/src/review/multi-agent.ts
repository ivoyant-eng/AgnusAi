import type {
  AgentOutput,
  AgentRole,
  AgentTelemetry,
  ConsolidatedReview,
  ReviewComment,
  ReviewContext,
  ReviewResult,
  Ticket,
  TicketComplianceVerdict,
} from '../types';
import type { LLMBackend } from '../llm/base';
import { runSelfReflection } from './self-reflection';

const DEFAULT_AGENT_CONCURRENCY = 2;

// Per-agent sampling temperatures.
// Security and compliance stay near-deterministic (false positives are costly).
// Style gets more variance — creative suggestions are fine there.
const AGENT_TEMPERATURE: Record<AgentRole, number> = {
  security:              0.1,
  correctness:           0.2,
  performance:           0.2,
  style_maintainability: 0.4,
  ticket_compliance:     0.1,
  blast_radius:          0.2,
};

const AGENT_DIRECTIVES: Record<AgentRole, string> = {
  security: `Focus only on exploitable vulnerabilities, authn/authz gaps, unsafe data handling, and secrets exposure. Ignore style/perf unless it creates a concrete security risk.

UI Authorization: When reviewing UI components (React/JSX/TSX), check for inconsistent permission gating across sibling elements. If some buttons, menu items, or actions in the same list or array use a permission guard (e.g. \`buttonDisabled: !hasPermission(...)\`, \`disabled: !can(...)\`, \`scope: Permission.X\`) while a sibling hardcodes \`buttonDisabled: false\` or \`disabled={false}\` with no permission check, that is an authorization gap — the action is available to users who should not have access.

Attribution: When flagging a missing permission check on a UI element, reference the exact line where the disabled/buttonDisabled/enabled prop is set in the render config — NOT the callback function the element invokes. The callback itself is not the vulnerability; the unconditional access control prop is.`,
  correctness: 'Focus only on logic errors, race conditions, null/edge-case handling, and behavior regressions. Ignore stylistic feedback.',
  performance: 'Focus only on material performance issues: algorithmic complexity, redundant I/O, N+1 patterns, and hot-path inefficiencies.',
  style_maintainability: 'Focus only on maintainability that impacts future defects: complexity, readability of critical paths, and brittle abstractions. Avoid cosmetic nits.',
  ticket_compliance: 'Focus only on verifiable gaps: where the PR description or ticket explicitly claims a feature was implemented but the diff contains no evidence of it. Only flag what is definitively absent — you must be able to point to the missing code. Never post uncertainty or "verify this" comments. If the diff does not give you enough information to confirm an absence, stay silent. For each ticket gap you find, start your comment body with [Ticket: KEY] where KEY is the exact ticket key from ## Linked Tickets. This allows structured verdict generation.',
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

/**
 * Extract code identifiers from a comment body.
 * Primary: backtick-wrapped terms (e.g. `getUser`).
 * Secondary: camelCase/PascalCase words in plain text (catches un-backticked identifiers).
 */
function extractIdentifiers(body: string): string[] {
  const backtickIds = (body.match(/`([^`]+)`/g) || [])
    .map(m => m.replace(/`/g, '').trim().toLowerCase())
    .filter(t => t.length >= 3 && !/^\d+$/.test(t));
  const plainText = body.replace(/`[^`]*`/g, '');
  const camelCaseIds = (plainText.match(/\b[a-z][a-zA-Z]*[A-Z][a-zA-Z]*\b/g) || [])
    .map(m => m.toLowerCase())
    .filter(t => t.length >= 6);
  return [...new Set([...backtickIds, ...camelCaseIds])];
}

/**
 * Two comments share a theme when at least half of the smaller identifier set overlaps.
 * Falls back to normalized text prefix when neither comment has identifiers.
 */
function themesOverlap(idsA: string[], idsB: string[], bodyA: string, bodyB: string): boolean {
  if (idsA.length > 0 && idsB.length > 0) {
    const setB = new Set(idsB);
    const overlap = idsA.filter(id => setB.has(id)).length;
    const smaller = Math.min(idsA.length, idsB.length);
    return overlap >= Math.max(1, Math.ceil(smaller * 0.5));
  }
  if (idsA.length === 0 && idsB.length === 0) {
    return normalizeThemeText(bodyA) === normalizeThemeText(bodyB);
  }
  return false;
}

function normalizeThemeText(body: string): string {
  return body
    .replace(/<[^>]+>/g, '')
    .replace(/\*+/g, '')
    .replace(/\[Confidence:[^\]]+\]/gi, '')
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60);
}

/**
 * Removes comments that repeat the same theme within the same file.
 * Uses code identifier overlap (backtick terms + camelCase names) to detect
 * semantically equivalent comments even when wording differs.
 * Keeps the highest severity+confidence comment per theme.
 */
function themeDedupeComments(comments: ReviewComment[]): ReviewComment[] {
  const score = (c: ReviewComment) => severityRank(c.severity) * 10 + (c.confidence ?? 0);
  const sorted = [...comments].sort((a, b) => score(b) - score(a));
  const kept: { comment: ReviewComment; ids: string[] }[] = [];
  for (const comment of sorted) {
    const ids = extractIdentifiers(comment.body);
    const dominated = kept.some(k =>
      k.comment.path === comment.path && themesOverlap(k.ids, ids, k.comment.body, comment.body)
    );
    if (!dominated) {
      kept.push({ comment, ids });
    }
  }
  return kept.map(k => k.comment);
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
    'DISCARD theme duplicates: if multiple findings describe the same conceptual issue across different lines, agents, or angles in the same file, keep only the single highest-severity/confidence instance. Two findings share a theme when their core message — stripped of file names, line numbers, and code snippets — conveys the same fix. Examples of the same theme: "buttonDisabled: false has no permission check" at line 223 and "buttonDisabled: false bypasses hasPermission" at line 225 — same fix, discard the weaker one. "missing null check on X" and "X could be undefined" — same fix. "no try-catch" and "unhandled promise rejection" — same fix.',
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

// ---------------------------------------------------------------------------
// Ticket compliance verdict
// ---------------------------------------------------------------------------

function buildTicketComplianceVerdict(
  tickets: Ticket[],
  complianceComments: ReviewComment[],
): { table: string; verdicts: TicketComplianceVerdict[] } {
  const verdicts: TicketComplianceVerdict[] = [];
  const rows: string[] = [];

  for (const ticket of tickets) {
    const related = complianceComments.filter(
      (c) =>
        c.body.includes(ticket.key) ||
        c.body.toLowerCase().includes(ticket.title.slice(0, 30).toLowerCase()),
    );
    const status: TicketComplianceVerdict['status'] =
      related.length === 0
        ? 'compliant'
        : related.some((c) => c.severity === 'error')
        ? 'noncompliant'
        : 'partial';
    const statusEmoji = { compliant: '✅', partial: '🔶', noncompliant: '❌' }[status];
    const verdictLabel = {
      compliant: 'Fully Compliant',
      partial: 'Partially Compliant',
      noncompliant: 'Not Compliant',
    }[status];
    const gaps =
      related
        .map((c) => c.body.split('\n')[0].replace(/\*+/g, '').replace(/^\[Ticket:[^\]]+\]\s*/i, '').trim())
        .filter(Boolean)
        .join('; ') || '—';
    const shortTitle = ticket.title.slice(0, 40);

    rows.push(`| ${ticket.key}: ${shortTitle} | ${statusEmoji} ${verdictLabel} | ${gaps} |`);
    verdicts.push({ ticketKey: ticket.key, ticketTitle: ticket.title, status, gaps });
  }

  const table = [
    '\n## 📋 Ticket Compliance\n',
    '| Ticket | Verdict | Gaps |',
    '|--------|---------|------|',
    ...rows,
  ].join('\n');

  return { table, verdicts };
}

// ---------------------------------------------------------------------------
// Summary agent
// ---------------------------------------------------------------------------

const VERDICT_LABEL: Record<ReviewResult['verdict'], string> = {
  approve: '✅ Approved',
  comment: '💬 Comments Only',
  request_changes: '⚠️ Changes Requested',
};

const ROLE_LABEL: Record<AgentRole, string> = {
  security: '🔴 Security',
  correctness: '🟡 Correctness',
  performance: '🔵 Performance',
  style_maintainability: '⚪ Style / Maintainability',
  ticket_compliance: '📋 Ticket Compliance',
  blast_radius: '💥 Blast Radius',
};

export const SUMMARY_MARKER = '<!-- agnus-summary -->';

function buildSummaryPrompt(
  outputs: AgentOutput[],
  comments: ReviewComment[],
  context: ReviewContext,
): string {
  const changedFiles = context.diff.files.map(f => f.path).join(', ') || 'unknown';
  const agentInputs = outputs
    .filter(o => o.result.summary?.trim())
    .map(o => `[${o.role}]\n${o.result.summary.trim()}`)
    .join('\n\n');

  return [
    'You are writing two prose sections for a PR review summary.',
    'Respond with ONLY these two labeled lines. No other text, no markdown fences, no extra lines.',
    '',
    'WHAT_WAS_REVIEWED: <1-2 sentences describing what this PR does. Be concrete — mention the files and the type of change.>',
    'SUMMARY: <3-5 sentences synthesising what the review found. Write as a single coherent paragraph. No bullet points. Highlight the most important risks and what the author should fix first.>',
    '',
    `PR Title: ${context.pr.title}`,
    `PR Description: ${context.pr.description?.slice(0, 400) ?? 'N/A'}`,
    `Changed files: ${changedFiles}`,
    '',
    'Agent findings:',
    agentInputs,
  ].join('\n');
}

function parseSummaryProse(raw: string): { whatWasReviewed: string; summary: string } | null {
  const whatMatch = raw.match(/WHAT_WAS_REVIEWED:\s*(.+)/i);
  const summaryMatch = raw.match(/SUMMARY:\s*(.+)/is);
  if (!whatMatch || !summaryMatch) return null;
  return {
    whatWasReviewed: whatMatch[1].trim(),
    summary: summaryMatch[1].trim(),
  };
}

function assembleSummary(
  whatWasReviewed: string,
  summaryParagraph: string,
  outputs: AgentOutput[],
  comments: ReviewComment[],
  verdict: ReviewResult['verdict'],
  tickets?: Ticket[],
): string {
  const errorComments = comments.filter(c => c.severity === 'error');
  const warningComments = comments.filter(c => c.severity === 'warning');
  const infoComments = comments.filter(c => c.severity === 'info');

  const tableRows = outputs
    .map(o => {
      const count = comments.filter(c => c.sourceAgent === o.role).length;
      const status = count === 0 ? '✅ Clean' : `${count} issue${count > 1 ? 's' : ''}`;
      return `| ${ROLE_LABEL[o.role]} | ${status} |`;
    })
    .join('\n');

  const mustFix = errorComments.length > 0
    ? errorComments
        .slice(0, 5)
        .map(c => `- \`${c.path}\` — ${c.body.split('\n')[0].replace(/\*+/g, '').trim()}`)
        .join('\n')
    : '_None — all findings are suggestions._';

  // Build ticket compliance section if tickets are present
  const complianceComments = comments.filter((c) => c.sourceAgent === 'ticket_compliance');
  const complianceSection =
    tickets && tickets.length > 0 && complianceComments.length >= 0
      ? buildTicketComplianceVerdict(tickets, complianceComments).table
      : '';

  return [
    SUMMARY_MARKER,
    `🔄 **Review Summary**`,
    ``,
    `**Verdict:** ${VERDICT_LABEL[verdict]}`,
    ``,
    `### What was reviewed`,
    whatWasReviewed,
    ``,
    `### Findings at a glance`,
    `| Category | Status |`,
    `|----------|--------|`,
    tableRows,
    `| **Total** | **${errorComments.length} critical, ${warningComments.length} warnings, ${infoComments.length} suggestions** |`,
    ``,
    `### Must fix before merge`,
    mustFix,
    ``,
    `### Summary`,
    summaryParagraph,
    complianceSection,
  ].join('\n');
}

async function runSummaryAgent(
  llm: LLMBackend,
  context: ReviewContext,
  outputs: AgentOutput[],
  comments: ReviewComment[],
  verdict: ReviewResult['verdict'],
): Promise<string | null> {
  try {
    const prompt = buildSummaryPrompt(outputs, comments, context);
    const raw = await llm.generate(prompt, context, 0);
    const parsed = parseSummaryProse(raw);
    if (!parsed) return null;
    return assembleSummary(parsed.whatWasReviewed, parsed.summary, outputs, comments, verdict, context.tickets);
  } catch {
    return null;
  }
}

function buildFallbackSummary(
  outputs: AgentOutput[],
  comments: ReviewComment[],
  verdict: ReviewResult['verdict'],
  tickets?: Ticket[],
): string {
  return assembleSummary(
    'No description available.',
    'Review completed by specialist agents. See inline comments for details.',
    outputs,
    comments,
    verdict,
    tickets,
  );
}

// ---------------------------------------------------------------------------
// LLM judge
// ---------------------------------------------------------------------------

async function llmJudge(
  llm: LLMBackend,
  context: ReviewContext,
  comments: ReviewComment[],
): Promise<{ comments: ReviewComment[]; verdict?: ReviewResult['verdict'] } | null> {
  if (comments.length === 0) return { comments: [] }
  try {
    const prompt = buildJudgePrompt(comments)
    const response = await llm.generate(prompt, context, 0)
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
    }, AGENT_TEMPERATURE[role]);
    // Dedup within this agent's output before sending to the Judge.
    // Prevents a single agent from producing 3 near-identical variants of the same finding.
    const rawComments = result.comments.map(c => ({ ...c, sourceAgent: role }));
    const comments = themeDedupeComments(rawComments);
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
  comments = themeDedupeComments(comments);
  // Self-reflection second pass (re-scores comments, drops low-quality ones)
  if (context.config.selfReflectionEnabled) {
    const reflThreshold = context.config.selfReflectionThreshold ?? 5;
    comments = await runSelfReflection(llm, context, comments, reflThreshold, 1);
  }

  if (comments.length > 0 && verdict === 'approve') verdict = 'comment';

  const summary =
    (await runSummaryAgent(llm, context, outputs, comments, verdict)) ??
    buildFallbackSummary(outputs, comments, verdict, context.tickets);

  // Build compliance verdict for structured access
  const complianceComments = comments.filter((c) => c.sourceAgent === 'ticket_compliance');
  const complianceVerdict =
    context.tickets?.length > 0
      ? buildTicketComplianceVerdict(context.tickets, complianceComments).verdicts
      : undefined;

  return {
    summary,
    comments,
    suggestions: [],
    verdict,
    agentTelemetry: outputs.map(o => o.telemetry),
    complianceVerdict,
  };
}
