/**
 * Institutional Memory Types
 * 
 * Memory rules store team decisions from review threads and replay them
 * as enforcement on future PRs.
 */

/**
 * Represents a team decision captured from a PR review.
 * Stored as YAML files in ~/.pr-review/memory/
 */
export interface MemoryRule {
  /** Unique identifier (auto-generated) */
  id: string;
  /** The rule description in natural language */
  rule: string;
  /** Glob patterns for files this rule applies to */
  files: string[];
  /** When this rule was decided (ISO date string) */
  decided: string;
  /** URL to the original PR thread where this was decided */
  threadUrl?: string;
  /** Commit SHA when this rule started being enforced */
  enforcedSince?: string;
  /** Who decided/approved this rule */
  decidedBy?: string;
  /** Tags for categorization */
  tags?: string[];
  /** Whether this rule is active (default: true) */
  active?: boolean;
  /** Notes or context about this rule */
  notes?: string;
}

/**
 * Options for adding a new memory rule
 */
export interface AddRuleOptions {
  /** The rule description */
  rule: string;
  /** Glob patterns for files */
  files?: string[];
  /** URL to the original discussion */
  threadUrl?: string;
  /** Who decided this rule */
  decidedBy?: string;
  /** Tags for categorization */
  tags?: string[];
  /** Additional notes */
  notes?: string;
}

/**
 * Options for listing memory rules
 */
export interface ListRulesOptions {
  /** Filter by file path (matches against rule file patterns) */
  filePath?: string;
  /** Filter by active status */
  activeOnly?: boolean;
  /** Filter by tag */
  tag?: string;
}

/**
 * Result of loading rules for a review
 */
export interface LoadedRules {
  /** All rules that matched the changed files */
  matched: MemoryRule[];
  /** Total rules in memory */
  total: number;
  /** Files that were analyzed */
  files: string[];
}

/**
 * Memory store statistics
 */
export interface MemoryStats {
  /** Total number of rules */
  totalRules: number;
  /** Number of active rules */
  activeRules: number;
  /** Number of inactive rules */
  inactiveRules: number;
  /** Memory directory path */
  memoryPath: string;
  /** When the store was created (first rule added) */
  createdAt?: string;
  /** When the store was last modified */
  updatedAt?: string;
}