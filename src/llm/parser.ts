// Shared response parser — provider-agnostic

import { ReviewResult, ReviewComment } from '../types';

export function parseReviewResponse(response: string): ReviewResult {
  const summaryMatch = response.match(/SUMMARY:\s*([\s\S]*?)(?=\[File:|VERDICT:|$)/i);
  const summary = summaryMatch ? summaryMatch[1].trim() : response.slice(0, 500);

  const comments = parseCommentBlocks(response);

  const verdictMatch = response.match(/VERDICT:\s*(approve|request_changes|comment)/i);
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

    comments.push({
      path: path.trim(),
      line: parseInt(line),
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
