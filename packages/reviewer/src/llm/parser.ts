// Shared response parser — provider-agnostic

import { ReviewResult, ReviewComment } from '../types';

export function parseReviewResponse(response: string): ReviewResult {
  // Summary ends at first file marker OR VERDICT — supports both [File: and bare File: formats
  const summaryMatch = response.match(/SUMMARY:\s*([\s\S]*?)(?=\[?File:|VERDICT:|$)/i);
  const summary = summaryMatch ? summaryMatch[1].trim() : response.slice(0, 500);

  // Detect truncated response: has file markers but no VERDICT at all
  const hasFileMarker = /\[?File:/i.test(response);
  const hasVerdict = /VERDICT:/i.test(response);
  if (hasFileMarker && !hasVerdict) {
    console.warn('[AgnusAI] LLM response appears truncated — contains File: markers but no VERDICT. Some comments may be incomplete.');
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

  // Flexible marker that handles all LLM output variants:
  //   [File: path, Line: N]   — canonical format
  //   [File: path Line: N]    — no comma
  //   File: path, Line: N     — no brackets, comma
  //   File: path Line: N      — no brackets, no comma (e.g. codellama output)
  const FILE_MARKER = /\[?File:\s*([^\],\n]+?)[\s,]+Line:\s*(\d+)\]?/gi;

  // Collect all marker positions: markerStart = where "[File:" text begins,
  // contentStart = where the body begins (right after the closing "]" or last digit)
  type MarkerEntry = { path: string; line: number; markerStart: number; contentStart: number }
  const markers: MarkerEntry[] = []
  let m: RegExpExecArray | null
  FILE_MARKER.lastIndex = 0
  while ((m = FILE_MARKER.exec(response)) !== null) {
    const lineNum = parseInt(m[2], 10)
    if (!isFinite(lineNum) || lineNum < 1) {
      console.warn(`[AgnusAI] Skipping comment with invalid line number "${m[2]}" in file "${m[1].trim()}"`)
      continue
    }
    markers.push({
      path: m[1].trim(),
      line: lineNum,
      markerStart: m.index,
      contentStart: m.index + m[0].length,
    })
  }

  // Extract body between consecutive markers (body ends where the NEXT marker's text begins)
  const verdictIdx = /VERDICT:/i.exec(response)?.index ?? response.length
  for (let i = 0; i < markers.length; i++) {
    const start = markers[i].contentStart
    const end = i + 1 < markers.length ? markers[i + 1].markerStart : verdictIdx
    const body = response.slice(start, end).trim()
    if (!body) continue
    comments.push({
      path: markers[i].path,
      line: markers[i].line,
      body,
      severity: detectSeverity(body),
    })
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
