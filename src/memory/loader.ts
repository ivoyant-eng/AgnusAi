/**
 * Memory Loader - Loads and matches rules for review context
 * 
 * Loads relevant rules at review time and injects them as 
 * team-specific constraints for the LLM to enforce.
 */

import { minimatch } from 'minimatch';
import { MemoryRule, LoadedRules, ListRulesOptions } from './types';
import { listRules } from './store';

/**
 * Check if a file path matches any of the glob patterns
 */
function matchesPattern(filePath: string, patterns: string[]): boolean {
  return patterns.some(pattern => {
    // Support both standard glob and ** patterns
    return minimatch(filePath, pattern, { 
      matchBase: true,
      dot: true,
    });
  });
}

/**
 * Get unique set of file paths from file diffs
 */
function extractFilePaths(files: Array<{ path: string; oldPath?: string }>): string[] {
  const paths = new Set<string>();
  
  for (const file of files) {
    paths.add(file.path);
    if (file.oldPath) {
      paths.add(file.oldPath);
    }
  }
  
  return Array.from(paths);
}

/**
 * Load rules that are relevant to the given file paths
 */
export function loadRulesForFiles(
  filePaths: string[],
  options: { activeOnly?: boolean } = {}
): LoadedRules {
  const allRules = listRules({ activeOnly: options.activeOnly !== false });
  
  // Filter rules that match at least one file
  const matched = allRules.filter(rule => {
    // Skip inactive rules
    if (rule.active === false) {
      return false;
    }
    
    // Check if any file matches the rule's file patterns
    return filePaths.some(filePath => matchesPattern(filePath, rule.files));
  });
  
  return {
    matched,
    total: allRules.length,
    files: filePaths,
  };
}

/**
 * Load rules for a review context (convenience function)
 */
export function loadRulesForReview(context: {
  files: Array<{ path: string; oldPath?: string }>;
}): LoadedRules {
  const filePaths = extractFilePaths(context.files);
  return loadRulesForFiles(filePaths);
}

/**
 * Format rules for inclusion in the LLM prompt
 */
export function formatRulesForPrompt(rules: MemoryRule[]): string {
  if (rules.length === 0) {
    return '';
  }
  
  const lines: string[] = [
    '## Team Decisions (Institutional Memory)',
    'The following rules were decided by the team in previous reviews.',
    'Enforce them and cite the original decision when relevant:',
    '',
  ];
  
  for (let i = 0; i < rules.length; i++) {
    const rule = rules[i];
    const num = i + 1;
    const filePatterns = rule.files.map(f => `[${f}]`).join(', ');
    
    lines.push(`${num}. ${filePatterns} ${rule.rule}`);
    lines.push(`   Decided: ${rule.decided}`);
    
    if (rule.threadUrl) {
      lines.push(`   Source: ${rule.threadUrl}`);
    }
    
    if (rule.decidedBy) {
      lines.push(`   By: ${rule.decidedBy}`);
    }
    
    lines.push('');
  }
  
  return lines.join('\n');
}

/**
 * Create a concise summary of rules for token efficiency
 */
export function summarizeRules(rules: MemoryRule[]): string {
  if (rules.length === 0) {
    return '';
  }
  
  const lines: string[] = rules.map(rule => {
    const patterns = rule.files.length === 1 && rule.files[0] === '**'
      ? '*'
      : rule.files.join(', ');
    return `[${patterns}] ${rule.rule}`;
  });
  
  return `Team Rules:\n${lines.map(l => `- ${l}`).join('\n')}`;
}

/**
 * Find rules that might be related to a specific code pattern or keyword
 */
export function findRelatedRules(keyword: string, options: ListRulesOptions = {}): MemoryRule[] {
  const rules = listRules(options);
  const keywordLower = keyword.toLowerCase();
  
  return rules.filter(rule => {
    return (
      rule.rule.toLowerCase().includes(keywordLower) ||
      rule.tags?.some(tag => tag.toLowerCase().includes(keywordLower)) ||
      rule.notes?.toLowerCase().includes(keywordLower)
    );
  });
}

/**
 * Validate a rule's file patterns
 */
export function validatePatterns(patterns: string[]): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  
  for (const pattern of patterns) {
    try {
      // Test pattern with a dummy path
      minimatch('test/path.js', pattern);
    } catch (e) {
      errors.push(`Invalid pattern "${pattern}": ${e}`);
    }
  }
  
  return {
    valid: errors.length === 0,
    errors,
  };
}