/**
 * Memory Store - Manages persistence of team decision rules
 * 
 * Rules are stored as YAML files in ~/.pr-review/memory/
 * Each rule is a separate file for easy versioning and editing.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import * as crypto from 'crypto';
import { 
  MemoryRule, 
  AddRuleOptions, 
  ListRulesOptions, 
  MemoryStats 
} from './types';

const MEMORY_DIR = '.pr-review';
const MEMORY_SUBDIR = 'memory';
const RULE_EXTENSION = '.yaml';

/**
 * Get the path to the memory directory
 */
export function getMemoryPath(): string {
  return path.join(process.env.HOME || '~', MEMORY_DIR, MEMORY_SUBDIR);
}

/**
 * Ensure the memory directory exists
 */
export function ensureMemoryDir(): void {
  const memoryPath = getMemoryPath();
  if (!fs.existsSync(memoryPath)) {
    fs.mkdirSync(memoryPath, { recursive: true });
  }
}

/**
 * Generate a unique ID for a rule
 */
function generateId(): string {
  const timestamp = Date.now().toString(36);
  const random = crypto.randomBytes(4).toString('hex');
  return `rule_${timestamp}_${random}`;
}

/**
 * Get the file path for a rule
 */
function getRulePath(id: string): string {
  return path.join(getMemoryPath(), `${id}${RULE_EXTENSION}`);
}

/**
 * Add a new memory rule
 */
export function addRule(options: AddRuleOptions): MemoryRule {
  ensureMemoryDir();
  
  const rule: MemoryRule = {
    id: generateId(),
    rule: options.rule,
    files: options.files || ['**'],
    decided: new Date().toISOString().split('T')[0],
    threadUrl: options.threadUrl,
    decidedBy: options.decidedBy,
    tags: options.tags,
    active: true,
    notes: options.notes,
  };
  
  const yamlContent = yaml.dump(rule, { 
    lineWidth: 100,
    quotingType: '"',
    forceQuotes: false,
  });
  
  fs.writeFileSync(getRulePath(rule.id), yamlContent, 'utf-8');
  
  return rule;
}

/**
 * Get a rule by ID
 */
export function getRule(id: string): MemoryRule | null {
  const rulePath = getRulePath(id);
  
  if (!fs.existsSync(rulePath)) {
    return null;
  }
  
  const content = fs.readFileSync(rulePath, 'utf-8');
  return yaml.load(content) as MemoryRule;
}

/**
 * Update a rule (partial update)
 */
export function updateRule(id: string, updates: Partial<MemoryRule>): MemoryRule | null {
  const rule = getRule(id);
  
  if (!rule) {
    return null;
  }
  
  const updated = { ...rule, ...updates };
  const yamlContent = yaml.dump(updated, { 
    lineWidth: 100,
    quotingType: '"',
    forceQuotes: false,
  });
  
  fs.writeFileSync(getRulePath(id), yamlContent, 'utf-8');
  
  return updated;
}

/**
 * Remove a rule by ID
 */
export function removeRule(id: string): boolean {
  const rulePath = getRulePath(id);
  
  if (!fs.existsSync(rulePath)) {
    return false;
  }
  
  fs.unlinkSync(rulePath);
  return true;
}

/**
 * List all rules
 */
export function listRules(options: ListRulesOptions = {}): MemoryRule[] {
  ensureMemoryDir();
  
  const memoryPath = getMemoryPath();
  const files = fs.readdirSync(memoryPath)
    .filter(f => f.endsWith(RULE_EXTENSION));
  
  let rules: MemoryRule[] = [];
  
  for (const file of files) {
    const content = fs.readFileSync(path.join(memoryPath, file), 'utf-8');
    try {
      const rule = yaml.load(content) as MemoryRule;
      rules.push(rule);
    } catch (e) {
      // Skip invalid YAML files
      console.error(`Warning: Invalid rule file ${file}: ${e}`);
    }
  }
  
  // Sort by decision date (newest first)
  rules.sort((a, b) => new Date(b.decided).getTime() - new Date(a.decided).getTime());
  
  // Apply filters
  if (options.activeOnly) {
    rules = rules.filter(r => r.active !== false);
  }
  
  if (options.tag) {
    rules = rules.filter(r => r.tags?.includes(options.tag!));
  }
  
  // Note: filePath filtering is handled by the loader, not here
  
  return rules;
}

/**
 * Clear all rules
 */
export function clearRules(): number {
  const memoryPath = getMemoryPath();
  
  if (!fs.existsSync(memoryPath)) {
    return 0;
  }
  
  const files = fs.readdirSync(memoryPath)
    .filter(f => f.endsWith(RULE_EXTENSION));
  
  for (const file of files) {
    fs.unlinkSync(path.join(memoryPath, file));
  }
  
  return files.length;
}

/**
 * Get memory store statistics
 */
export function getMemoryStats(): MemoryStats {
  const rules = listRules();
  
  return {
    totalRules: rules.length,
    activeRules: rules.filter(r => r.active !== false).length,
    inactiveRules: rules.filter(r => r.active === false).length,
    memoryPath: getMemoryPath(),
    createdAt: rules.length > 0 
      ? rules[rules.length - 1].decided 
      : undefined,
    updatedAt: rules.length > 0 
      ? rules[0].decided 
      : undefined,
  };
}

/**
 * Export rules for backup or sharing
 */
export function exportRules(): string {
  const rules = listRules();
  return yaml.dump(rules, { lineWidth: 120 });
}

/**
 * Import rules from a YAML string
 */
export function importRules(yamlContent: string, overwrite: boolean = false): number {
  const imported = yaml.load(yamlContent) as MemoryRule[];
  
  if (!Array.isArray(imported)) {
    throw new Error('Invalid import format: expected array of rules');
  }
  
  ensureMemoryDir();
  
  let count = 0;
  for (const rule of imported) {
    // Check if rule with same ID exists
    const existing = rule.id ? getRule(rule.id) : null;
    
    if (existing && !overwrite) {
      // Skip existing rules
      continue;
    }
    
    // Generate new ID if not present
    if (!rule.id) {
      rule.id = generateId();
    }
    
    const yamlStr = yaml.dump(rule, { lineWidth: 100 });
    fs.writeFileSync(getRulePath(rule.id), yamlStr, 'utf-8');
    count++;
  }
  
  return count;
}