// Shared prompt builder — provider-agnostic

import { ReviewContext, Diff } from '../types';

export function buildReviewPrompt(context: ReviewContext): string {
  const { pr, diff, skills, config } = context;

  const skillContext = skills.length > 0
    ? `\n## Review Skills Applied\n${skills.map(s => s.content).join('\n\n')}`
    : '';

  const fileList = diff.files
    .map(f => `- ${f.path} (${f.status}, +${f.additions}/-${f.deletions})`)
    .join('\n');

  const maxChars = config?.maxDiffSize ?? 30000;
  const diffResult = buildDiffSummary(diff, maxChars);

  const truncationWarning = diffResult.truncated
    ? `\n⚠️ IMPORTANT: This diff was truncated. You have only seen the first portion (${diffResult.truncatedCount} more files not shown).\nDo NOT reference, guess, or comment on files not shown above.\nReview ONLY what is shown in the diff.\n`
    : '';

  return `You are an expert code reviewer. Review this pull request and provide detailed, actionable feedback.

## PR Information
Title: ${pr.title}
Author: ${pr.author.username}
Branch: ${pr.sourceBranch} → ${pr.targetBranch}

## Description
${pr.description || 'No description provided.'}

## Changed Files (${diff.files.length} files)
${fileList}

## Diff
${diffResult.content}
${skillContext}
${truncationWarning}

## Review Instructions
1. Analyse the diff for issues: correctness, security, performance, maintainability
2. Reference exact file paths and line numbers from the diff
3. Focus on real issues, not nitpicks
4. For each issue provide: severity, concrete impacts, a code suggestion, reproduction steps

## Output Format

SUMMARY:
[2-3 sentence overall assessment]

Then for each issue, output a [File:, Line:] marker followed immediately by the full markdown body of the comment, exactly like the example below. Use the EXACT file path from the diff.

[File: /src/api/services/publish_workflow/model.py, Line: 103]
**Suggestion:** With the current union type ordering, responses that include a \`diff\` field will always be parsed as the variant without \`diff\`, causing the diff payload to be silently dropped in FastAPI's response validation; reordering the union to try the diff-carrying variant first ensures clients receive the requested diff when \`include_diff\` is true. [logic-error]

<details>
<summary><b>Severity Level:</b> Major ⚠️</summary>

\`\`\`mdx
- ⚠️ \`/publish_workflow/generate_change_logs\` never returns diff payloads.
- ⚠️ Clients requesting \`include_diff=true\` cannot access deterministic diffs.
- ⚠️ Server-side diff computation is wasted; results discarded in serialization.
\`\`\`
</details>

\`\`\`suggestion
    ChangelogGeneratedWithDiffResult,
    ChangelogGeneratedResult,
\`\`\`

**Steps of Reproduction:**

<details>
<summary><b>Steps of Reproduction ✅</b></summary>

\`\`\`mdx
1. Start the FastAPI application and send a POST request to
   \`/publish_workflow/generate_change_logs\` with \`"include_diff": true\`
   and versions where \`generate_diff()\` reports changes.

2. Observe the response body contains only \`resultType\` and \`changelog\`
   — the \`diff\` field is absent despite being computed server-side.
\`\`\`
</details>

<details>
<summary><b>Prompt for AI Agent 🤖</b></summary>

\`\`\`mdx
This is a comment left during a code review.

**Path:** /src/api/services/publish_workflow/model.py
**Line:** 103

**Comment:**
*Logic Error: With the current union type ordering, responses that include a \`diff\` field
will always be parsed as the variant without \`diff\`, causing the diff payload to be
silently dropped in FastAPI's response validation.

Validate the correctness of the flagged issue. If correct, how can I resolve this?
If you propose a fix, implement it and please make it concise.
\`\`\`
</details>

[File: /next/file/path.py, Line: 55]
... next comment body ...

VERDICT: approve|request_changes|comment

RULES:
- The [File:, Line:] marker must use the EXACT path from the diff (including any leading slash)
- The line number must appear in the diff
- Output the full markdown body for every comment — do not shorten or summarise the sections
- If the PR looks good output VERDICT: approve with no comments
- NEVER comment on whether a specific package/library version number is valid, exists, or is outdated. Your training data has a knowledge cutoff and package versions change constantly — you will be wrong. Skip ALL observations about version numbers, semver ranges, or whether a version is "the latest". Focus only on code logic, patterns, and correctness.`;
}

export function buildDiffSummary(diff: Diff, maxChars: number = 30000): { content: string; truncated: boolean; truncatedCount: number } {
  let content = '';
  let currentSize = 0;

  for (let i = 0; i < diff.files.length; i++) {
    const file = diff.files[i];
    const fileDiff = `--- ${file.path}\n+++ ${file.path}\n${file.hunks.map(h => h.content).join('\n')}\n`;

    if (currentSize + fileDiff.length > maxChars) {
      const truncatedCount = diff.files.length - i;
      content += `\n... [Diff truncated — ${truncatedCount} more files]`;
      return { content, truncated: true, truncatedCount };
    }

    content += fileDiff;
    currentSize += fileDiff.length;
  }

  return { content, truncated: false, truncatedCount: 0 };
}
