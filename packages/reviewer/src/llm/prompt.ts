// Shared prompt builder — provider-agnostic

import type { GraphReviewContext } from '@agnus-ai/shared';
import { ReviewContext, Diff, ReviewResult } from '../types';

export function buildReviewPrompt(context: ReviewContext): string {
  const { pr, diff, skills, config, graphContext } = context;
  const agentRole = context.agentRole;
  const agentDirective = context.agentDirective;

  const skillContext = skills.length > 0
    ? `\n## Review Skills Applied\n${skills.map(s => s.content).join('\n\n')}`
    : '';

  const bestPracticesSection = context.bestPractices
    ? `\n## Team Best Practices\nApply these team-specific guidelines when reviewing this PR:\n\n${context.bestPractices}\n`
    : '';

  const graphSection = graphContext ? serializeGraphContext(graphContext) : '';

  const examplesSection = (graphContext?.priorExamples?.length)
    ? `\n## Examples of feedback your team found helpful\n` +
      `These are past review comments on this repo that developers marked as useful. ` +
      `Use them as a guide for the style and depth of feedback that resonates with this team.\n\n` +
      graphContext.priorExamples.map(e => `---\n${e}`).join('\n\n') + '\n'
    : ''

  const rejectedSection = (graphContext?.rejectedExamples?.length)
    ? `\n## Examples of feedback this team found NOT helpful\n` +
      `Avoid writing comments similar to these — developers on this repo have explicitly marked them as unhelpful.\n\n` +
      graphContext.rejectedExamples.map(e => `---\n${e}`).join('\n\n') + '\n'
    : ''
  const rulesSection = (graphContext?.enforcedRules?.length)
    ? `\n## Rule Enforcement Requirements\n` +
      `These rules are enforced for this PR scope. Check each rule while reviewing.\n` +
      `If you find a violation tied to one of these rules, include a single line in the comment body exactly as:\n` +
      `Rule: <rule name>\n\n` +
      graphContext.enforcedRules.map(rule =>
        `- Rule: ${rule.name}\n` +
        `  Category: ${rule.category}\n` +
        `  Severity: ${rule.severity}\n` +
        `  Requirement: ${rule.content}`
      ).join('\n\n') + '\n'
    : ''

  const fileList = diff.files
    .map(f => `- ${f.path} (${f.status}, +${f.additions}/-${f.deletions})`)
    .join('\n');

  const maxChars = config?.maxDiffSize ?? 30000;
  const diffResult = buildDiffSummary(diff, maxChars);

  const truncationWarning = diffResult.truncated
    ? `\n⚠️ IMPORTANT: This diff was truncated. You have only seen the first portion (${diffResult.truncatedCount} more files not shown).\nDo NOT reference, guess, or comment on files not shown above.\nReview ONLY what is shown in the diff.\n`
    : '';
  const roleSection = agentRole
    ? `\n## Specialist Role\nRole: ${agentRole}\n${agentDirective ?? ''}\n`
    : '';

  const ticketsSection = (context.tickets && context.tickets.length > 0)
    ? `\n## Linked Tickets\n` +
      context.tickets.map(t =>
        `### ${t.key}: ${t.title}\n` +
        `- Status: ${t.status}\n` +
        `- Type: ${t.type}\n` +
        (t.labels.length > 0 ? `- Labels: ${t.labels.join(', ')}\n` : '') +
        (t.description ? `\n${t.description.slice(0, 500)}\n` : '') +
        (t.acceptanceCriteria?.length
          ? `\n**Acceptance Criteria:**\n${t.acceptanceCriteria.map(c => `- ${c}`).join('\n')}\n`
          : '')
      ).join('\n')
    : '';

  return `You are an expert code reviewer. Review this pull request and provide detailed, actionable feedback.

## PR Information
Title: ${pr.title}
Author: ${pr.author.username}
Branch: ${pr.sourceBranch} → ${pr.targetBranch}

## Description
${pr.description || 'No description provided.'}
${ticketsSection}
## Changed Files (${diff.files.length} files)
${fileList}

## Diff
${diffResult.content}
${graphSection}${bestPracticesSection}${skillContext}${examplesSection}${rejectedSection}${rulesSection}
${truncationWarning}${roleSection}

## Review Instructions
1. Analyse the diff for issues: correctness, security, performance, maintainability
2. Reference exact file paths and line numbers from the diff
3. Focus on real issues, not nitpicks
4. For each issue provide: severity, concrete impacts, a code suggestion, reproduction steps

## Output Format

SUMMARY:
[2-3 sentence overall assessment]

Then for each issue, output a [File:, Line:] marker followed immediately by the comment body. Use the EXACT file path from the diff.

[File: /src/api/services/publish_workflow/model.py, Line: 103]
**Suggestion:** With the current union type ordering, responses that include a \`diff\` field will always be parsed as the variant without \`diff\`, causing the diff payload to be silently dropped in FastAPI's response validation.

<details>
<summary><b>Severity Level:</b> Major ⚠️</summary>

- ⚠️ \`/publish_workflow/generate_change_logs\` never returns diff payloads.
- ⚠️ Clients requesting \`include_diff=true\` cannot access deterministic diffs.
- ⚠️ Server-side diff computation is wasted; results discarded in serialization.

</details>

\`\`\`suggestion
    ChangelogGeneratedWithDiffResult,
    ChangelogGeneratedResult,
\`\`\`

<details>
<summary><b>Steps to Reproduce</b></summary>

1. Send a POST request to \`/publish_workflow/generate_change_logs\` with \`"include_diff": true\`.
2. Observe the response body — the \`diff\` field is absent despite being computed server-side.

</details>

[Confidence: 0.91]

[File: /next/file/path.py, Line: 55]
... next comment body ...
[Confidence: 0.75]

VERDICT: approve|request_changes|comment

## Confidence Scoring (REQUIRED)
For EACH comment, include a self-assessed confidence score at the end of the comment body.

Format: add [Confidence: X.X] at the end of the comment body, where X.X is a decimal from 0.0 to 1.0.

Scoring guide:
- 0.9-1.0: Definite bug, security issue, or clear correctness problem
- 0.7-0.9: Likely issue with clear impact
- 0.5-0.7: Potential issue, may be stylistic
- 0.0-0.5: Speculative — omit these entirely unless critical

Example:
[File: /src/auth.ts, Line: 42]
**Suggestion:** The token is not validated before use.
[Confidence: 0.92]

RULES:
- The [File:, Line:] marker must use the EXACT path from the diff (including any leading slash)
- Every added line in the diff is prefixed with \`[Line N]\` showing its exact file line number. Use ONLY those numbers in your [File:, Line:] markers.
- ONLY comment on \`[Line N] +\` lines (added lines). Lines prefixed with \`[ctx N]\` are unchanged context lines shown so you can understand surrounding code (e.g. sibling elements) — do NOT place a comment on them. Lines starting with \`-\` are removals — do NOT place a comment on them either.
- You may use <details>/<summary> for collapsible sections. Inside <details> blocks, use only plain text and bullet lists — never triple-backtick code fences inside <details> as they break rendering on Azure DevOps and other platforms.
- If the PR looks good output VERDICT: approve with no comments
- NEVER comment on whether a specific package/library version number is valid, exists, or is outdated. Your training data has a knowledge cutoff and package versions change constantly — you will be wrong. Skip ALL observations about version numbers, semver ranges, or whether a version is "the latest". Focus only on code logic, patterns, and correctness.
- NEVER write vague advisory comments like "ensure compatibility", "verify this works", "check the documentation", "test thoroughly", or "this may have breaking changes" — these are noise. Only comment if you can point to a specific line of code that will break and explain exactly why.
- NEVER comment on lock files (pnpm-lock.yaml, package-lock.json, yarn.lock, go.sum, etc.) — they are auto-generated. If the only changed files are lock files and package.json version bumps, output VERDICT: approve with no comments.
- NEVER mention "blast radius", "graph context", "codebase context", or any internal tooling concepts in your review comments. Use the codebase context section only to understand impact — your comments must read as if written by a human reviewer who knows the codebase.
- UI Permission Attribution: When flagging a missing permission check on a UI element (button, action, menu item), reference the line where the disabled/enabled prop (e.g. \`buttonDisabled\`, \`disabled\`, \`isDisabled\`) is set in the render config — NOT the callback function it invokes. The callback is irrelevant to the authorization gap; the unconditional prop is the finding.
- UI Permission Consistency: If context lines show sibling buttons or actions in the same list/array where some apply \`hasPermission()\`, \`can()\`, or similar guards on their disabled state and others do not, flag the ungated element. A hardcoded \`buttonDisabled: false\` next to a properly-gated sibling is an access control bug.`;
}

export function serializeGraphContext(ctx: GraphReviewContext): string {
  const lines: string[] = [
    '\n## Codebase Context (internal — do NOT mention this section or any tooling names in your review output)',
    'Use this context silently to understand the impact of the changes. Do not reference "blast radius", "graph", or any internal tool terminology in your comments.\n',
  ];

  if (ctx.changedSymbols.length > 0) {
    lines.push('### Symbols changed in this PR');
    for (const s of ctx.changedSymbols) {
      lines.push(`- \`${s.qualifiedName}\` (${s.kind}): \`${s.signature}\``);
    }
  }

  const allCallers = [
    ...ctx.blastRadius.directCallers,
    ...ctx.blastRadius.transitiveCallers,
  ];

  if (allCallers.length > 0) {
    lines.push('\n### Known callers of changed symbols');
    lines.push('These symbols in the existing codebase depend on what was changed. If the change is breaking, they will be affected:');
    for (const s of allCallers) {
      lines.push(`- \`${s.qualifiedName}\` in \`${s.filePath}\`: \`${s.signature}\``);
    }
  }

  const otherFiles = ctx.blastRadius.affectedFiles.filter(
    f => !ctx.changedSymbols.some(s => s.filePath === f)
  );
  if (otherFiles.length > 0) {
    lines.push('\n### Other files likely affected');
    for (const f of otherFiles) {
      lines.push(`- \`${f}\``);
    }
  }

  if (ctx.callees.length > 0) {
    lines.push('\n### Dependencies of changed symbols');
    for (const s of ctx.callees) {
      lines.push(`- \`${s.qualifiedName}\`: \`${s.signature}\``);
    }
  }

  if (ctx.semanticNeighbors.length > 0) {
    lines.push('\n### Semantically related symbols');
    for (const s of ctx.semanticNeighbors) {
      lines.push(`- \`${s.qualifiedName}\` (${s.kind}): \`${s.signature}\``);
    }
  }

  return lines.join('\n') + '\n';
}

/** Files that are auto-generated or carry no reviewable logic — excluded from LLM diff. */
const SKIP_FILE_PATTERNS = [
  /^pnpm-lock\.yaml$/,
  /^package-lock\.json$/,
  /^yarn\.lock$/,
  /^bun\.lockb$/,
  /^composer\.lock$/,
  /^Gemfile\.lock$/,
  /^Pipfile\.lock$/,
  /^poetry\.lock$/,
  /^go\.sum$/,
  /^Cargo\.lock$/,
  /\.tsbuildinfo$/,
  /\.snap$/, // jest snapshots
]

export function shouldSkipFile(path: string): boolean {
  const base = path.split('/').pop() ?? path
  return SKIP_FILE_PATTERNS.some(p => p.test(base) || p.test(path))
}

export function buildDiffSummary(diff: Diff, maxChars: number = 30000): { content: string; truncated: boolean; truncatedCount: number } {
  let content = '';
  let currentSize = 0;
  const reviewableFiles = diff.files.filter(f => !shouldSkipFile(f.path));
  const skippedCount = diff.files.length - reviewableFiles.length;
  if (skippedCount > 0) {
    content += `[${skippedCount} generated/lock file(s) excluded from review]\n`;
  }

  for (let i = 0; i < reviewableFiles.length; i++) {
    const file = reviewableFiles[i];
    const hunksWithHeaders = file.hunks
      .map(h => {
        // Annotate each + line with its explicit new-file line number.
        // Context lines are stripped — the LLM only sees added/removed lines.
        const lines = h.content.split('\n');
        let newLineNo = h.newStart;
        const annotated: string[] = [];
        for (const line of lines) {
          if (line.startsWith('+')) {
            annotated.push(`[Line ${newLineNo}] ${line}`);
            newLineNo++;
          } else if (line.startsWith('-')) {
            annotated.push(line); // keep removals for context, no line number
          } else {
            // context line — include so agents can see surrounding code (e.g. sibling elements)
            annotated.push(`[ctx ${newLineNo}] ${line}`);
            newLineNo++;
          }
        }
        return `@@ -${h.oldStart},${h.oldLines} +${h.newStart},${h.newLines} @@\n${annotated.join('\n')}`;
      })
      .join('\n');
    const fileDiff = `--- ${file.path}\n+++ ${file.path}\n${hunksWithHeaders}\n`;

    if (currentSize + fileDiff.length > maxChars) {
      const truncatedCount = reviewableFiles.length - i;
      content += `\n... [Diff truncated — ${truncatedCount} more files]`;
      return { content, truncated: true, truncatedCount };
    }

    content += fileDiff;
    currentSize += fileDiff.length;
  }

  return { content, truncated: false, truncatedCount: 0 };
}

export function buildAskPrompt(question: string, context: ReviewContext): string {
  const { pr, diff } = context;
  const maxChars = context.config?.maxDiffSize ?? 30000;
  const diffResult = buildDiffSummary(diff, maxChars);
  const graphSection = context.graphContext ? serializeGraphContext(context.graphContext) : '';

  return `You are an expert code reviewer answering a question about a pull request.
Answer the question below using the diff and codebase context provided.
Be concise, accurate, and reference specific file paths and line numbers from the diff where relevant.

## Question
${question}

## PR
Title: ${pr.title}
Branch: ${pr.sourceBranch} → ${pr.targetBranch}
Author: ${pr.author.username}

## Diff
${diffResult.content}
${graphSection}
Answer the question directly. Do not repeat the question. Use markdown.`;
}

export function buildPRDescriptionPrompt(context: ReviewContext, review: ReviewResult): string {
  const { pr, diff, config } = context;
  const maxChars = config?.maxDiffSize ?? 30000;
  const diffResult = buildDiffSummary(diff, maxChars);

  const fileList = diff.files
    .map(f => `- ${f.path} (${f.status}, +${f.additions}/-${f.deletions})`)
    .join('\n');

  return `You are generating a high-quality pull request description for humans.

## Current PR
Title: ${pr.title}
Author: ${pr.author.username}
Branch: ${pr.sourceBranch} -> ${pr.targetBranch}

## Existing Description
${pr.description || 'No description provided.'}

## Changed Files (${diff.files.length} files)
${fileList}

## Diff
${diffResult.content}

## Review Signal (for context)
Summary: ${review.summary}
Verdict: ${review.verdict}
Comment Count: ${review.comments.length}

## Task
Generate:
1) An improved PR title
2) A complete PR body in markdown with these sections:
   - ## What Changed
   - ## Why It Changed
   - ## Walkthrough
3) Change type category: bug|feature|refactor|docs|tests|chore
4) 2-6 labels (short slugs)

## Walkthrough Rules
- Use one bullet per materially changed file or module.
- Keep each bullet concise and specific.
- Mention concrete components/functions from the diff when available.

## Output Format (STRICT)
TITLE: <single line>
CHANGE_TYPE: bug|feature|refactor|docs|tests|chore
LABELS: label-one, label-two, label-three
BODY:
<full markdown body>

Rules:
- Do not include any extra sections outside the format above.
- The markdown body must be valid and reviewer-friendly.
- Avoid generic filler text.`;
}
