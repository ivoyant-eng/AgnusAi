import type { ReviewComment, FileInfo } from '../types';

export type ParseFn = (code: string, language: string) => Promise<boolean>;

/**
 * Validates each suggestion block against tree-sitter syntax checking.
 * If the patched file would have parse errors, the suggestion is stripped
 * from the comment (the comment body text is preserved — only the fence is removed).
 *
 * @param comments - Review comments (may have suggestion field)
 * @param files    - Full file content fetched from VCS
 * @param parse    - Syntax check function; return true = valid, false = invalid
 */
export async function validateSuggestions(
  comments: ReviewComment[],
  files: FileInfo[],
  parse: ParseFn,
): Promise<ReviewComment[]> {
  return Promise.all(
    comments.map(async (comment) => {
      if (!comment.suggestion) return comment;

      const file = files.find((f) => f.path === comment.path);
      if (!file?.content || !file.language) return comment;

      const lines = file.content.split('\n');
      const patched = applyLinePatch(lines, comment.line, comment.suggestion);

      let syntaxOk: boolean;
      try {
        syntaxOk = await parse(patched, file.language);
      } catch {
        syntaxOk = true; // graceful degradation on parse error
      }

      if (!syntaxOk) {
        console.warn(
          `[suggestion-validator] Dropping syntactically invalid suggestion at ${comment.path}:${comment.line}`,
        );
        // Keep body, but remove the suggestion fence from it and clear the field
        const cleanBody = comment.body
          .replace(/```suggestion\s*\n[\s\S]*?\n```/gi, '')
          .trim();
        return { ...comment, body: cleanBody, suggestion: undefined };
      }

      return comment;
    }),
  );
}

function applyLinePatch(lines: string[], targetLine: number, suggestion: string): string {
  const idx = targetLine - 1;
  if (idx < 0 || idx >= lines.length) return lines.join('\n');
  const patched = [...lines];
  patched.splice(idx, 1, ...suggestion.split('\n'));
  return patched.join('\n');
}
