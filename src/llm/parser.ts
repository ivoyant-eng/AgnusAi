// Shared response parser — provider-agnostic

import { ReviewResult, ReviewComment } from '../types';

export function parseReviewResponse(response: string): ReviewResult {
  const summaryMatch = response.match(/SUMMARY:\s*([\s\S]*?)(?=\[File:|VERDICT:|$)/i);
  const summary = summaryMatch ? summaryMatch[1].trim() : response.slice(0, 500);

  // Detect truncated response: has [File: markers but no VERDICT at all
  const hasFileMarker = /\[File:/i.test(response);
  const hasVerdict = /VERDICT:/i.test(response);
  if (hasFileMarker && !hasVerdict) {
    console.warn('[AgnusAI] LLM response appears truncated — contains [File: markers but no VERDICT. Some comments may be incomplete.');
  }

  const comments = parseCommentBlocks(response);

  const verdictMatch = response.match(/VERDICT:\s*(approve|request_changes|comment)/i);
  if (!verdictMatch) {
    console.warn('[AgnusAI] No VERDICT in LLM response, defaulting to comment');
  }
  const verdict = verdictMatch
    ? (verdictMatch[1].toLowerCase() as ReviewResult['verdict'])
    : 'comment';

  return { summary, comments, suggestions: [], verdict };
}

export function parseCommentBlocks(response: string): ReviewComment[] {
  const comments: ReviewComment[] = [];

  // Match [File: /path, Line: N] and capture everything until the next marker or VERDICT
  const pattern = /\[File:\s*([^\],]+),\s*Line:\s*(\d+)\]([\s\S]*?)(?=\[File:|VERDICT:|$)/gi;
  let match;

  while ((match = pattern.exec(response)) !== null) {
    const [, path, line, body] = match;
    const trimmedBody = body.trim();
    if (!trimmedBody) continue;

    const lineNum = parseInt(line, 10);
    if (!isFinite(lineNum) || lineNum < 1) {
      console.warn(`[AgnusAI] Skipping comment with invalid line number "${line}" in file "${path.trim()}"`);
      continue;
    }

    comments.push({
      path: path.trim(),
      line: lineNum,
      body: trimmedBody,
      severity: detectSeverity(trimmedBody),
    });
  }

  return comments;
}

function detectSeverity(body: string): 'info' | 'warning' | 'error' {
  if (/Critical\s*🔴|severity.*critical/i.test(body)) return 'error';
  if (/Major\s*⚠️|severity.*major/i.test(body)) return 'warning';
  return 'info';
}

export function labelToLevel(label: string): 'info' | 'warning' | 'error' {
  switch (label.toLowerCase()) {
    case 'critical': return 'error';
    case 'major':    return 'warning';
    default:         return 'info';
  }
}
