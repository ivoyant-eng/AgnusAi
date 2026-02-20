// Static Analysis Layer - Runs tsc, eslint, and semgrep before LLM review
// Findings are fed to the LLM as context to reduce hallucinations

import { spawn, spawnSync } from 'child_process';
import { readFileSync, existsSync } from 'fs';
import { join, dirname, relative } from 'path';
import { promisify } from 'util';
import { stat } from 'fs/promises';

import { StaticFinding } from '../types';

const execFile = promisify(require('child_process').execFile);

/**
 * Configuration for static analysis tools
 */
export interface StaticAnalysisConfig {
  /** Whether static analysis is enabled */
  enabled?: boolean;
  /** Which tools to run */
  tools?: ('tsc' | 'eslint' | 'semgrep')[];
  /** Timeout in milliseconds for each tool */
  timeout?: number;
}

/**
 * Default configuration
 */
const DEFAULT_CONFIG: Required<StaticAnalysisConfig> = {
  enabled: true,
  tools: ['tsc', 'eslint'],
  timeout: 30000, // 30 seconds
};

/**
 * Run TypeScript compiler with --noEmit flag
 * @param rootDir Root directory of the project
 * @returns Array of TypeScript findings
 */
async function runTsc(rootDir: string, timeout: number): Promise<StaticFinding[]> {
  if (!existsSync(join(rootDir, 'tsconfig.json'))) {
    return [];
  }

  const findings: StaticFinding[] = [];

  try {
    const { stdout, stderr, timedOut } = await executeCommand(
      'tsc',
      ['--noEmit', '--pretty', 'false'],
      rootDir,
      timeout
    );

    if (timedOut) {
      console.warn('tsc: Command timed out');
      return [];
    }

    if (stderr) {
      // Parse tsc output
      const lines = stderr.split('\n').filter(line => line.trim());
      for (const line of lines) {
        const finding = parseTscLine(line, rootDir);
        if (finding) {
          findings.push(finding);
        }
      }
    }
  } catch (error: any) {
    // tsc exits with non-zero status on errors, which is expected
    if (error.message && !error.message.includes('tsc')) {
      console.warn(`tsc: Unexpected error: ${error.message}`);
    }
  }

  return findings;
}

/**
 * Parse a single line of tsc output
 */
function parseTscLine(line: string, rootDir: string): StaticFinding | null {
  // tsc format: file.ts(10,5): error TS1234: message
  const match = line.match(/^(.+?)\((\d+),(\d+)\):\s+(error|warning)\s+TS(\d+):\s+(.+)$/);

  if (match) {
    const [, file, lineNum, col, severity, code, message] = match;
    const fullPath = resolvePath(file, rootDir);

    return {
      tool: 'tsc',
      path: fullPath,
      line: parseInt(lineNum, 10),
      column: parseInt(col, 10),
      message: `TS${code}: ${message.trim()}`,
      severity: severity === 'error' ? 'error' : 'warning',
      rule: `TS${code}`,
    };
  }

  return null;
}

/**
 * Run ESLint on the project
 * @param rootDir Root directory of the project
 * @returns Array of ESLint findings
 */
async function runEslint(rootDir: string, timeout: number): Promise<StaticFinding[]> {
  // Check if eslint config exists
  const eslintConfigPaths = [
    '.eslintrc.js',
    '.eslintrc.cjs',
    '.eslintrc.yaml',
    '.eslintrc.yml',
    '.eslintrc.json',
    'eslint.config.js',
    'eslint.config.cjs',
    'package.json', // Check for eslintConfig
  ];

  const hasConfig = eslintConfigPaths.some(config =>
    existsSync(join(rootDir, config))
  );

  if (!hasConfig) {
    return [];
  }

  // Check if eslint is installed
  if (!isToolAvailable('eslint')) {
    return [];
  }

  const findings: StaticFinding[] = [];

  try {
    // Run eslint with json output
    const { stdout, stderr, timedOut } = await executeCommand(
      'eslint',
      ['.', '--format', 'json', '--ext', '.ts,.tsx,.js,.jsx'],
      rootDir,
      timeout
    );

    if (timedOut) {
      console.warn('eslint: Command timed out');
      return [];
    }

    if (stdout) {
      try {
        const results = JSON.parse(stdout);
        if (Array.isArray(results)) {
          for (const fileResult of results) {
            const filePath = resolvePath(fileResult.filePath, rootDir);
            for (const message of fileResult.messages) {
              findings.push({
                tool: 'eslint',
                path: filePath,
                line: message.line || 1,
                column: message.column,
                message: message.message,
                severity: getEslintSeverity(message.severity),
                rule: message.ruleId,
                suggestedFix: message.fix?.textContent,
              });
            }
          }
        }
      } catch (parseError: any) {
        console.warn(`eslint: Failed to parse JSON output: ${parseError.message}`);
      }
    }

    if (stderr && !stderr.includes('ESLint is a pluggable')) {
      console.warn(`eslint: ${stderr.trim()}`);
    }
  } catch (error: any) {
    // ESLint exits with non-zero if there are issues, which is expected
    if (error.message && !error.message.includes('eslint')) {
      console.warn(`eslint: Unexpected error: ${error.message}`);
    }
  }

  return findings;
}

/**
 * Convert ESLint severity to our format
 */
function getEslintSeverity(severity: number): 'error' | 'warning' | 'info' {
  if (severity === 2) return 'error';
  if (severity === 1) return 'warning';
  return 'info';
}

/**
 * Run Semgrep for security scanning
 * @param rootDir Root directory of the project
 * @returns Array of Semgrep findings
 */
async function runSemgrep(rootDir: string, timeout: number): Promise<StaticFinding[]> {
  if (!isToolAvailable('semgrep')) {
    return [];
  }

  const findings: StaticFinding[] = [];

  try {
    // Run semgrep with JSON output
    const { stdout, stderr, timedOut } = await executeCommand(
      'semgrep',
      ['.', '--config', 'p/ci', '--json'],
      rootDir,
      timeout
    );

    if (timedOut) {
      console.warn('semgrep: Command timed out');
      return [];
    }

    if (stdout) {
      try {
        const result = JSON.parse(stdout);
        const findingsList = result.results || [];

        for (const finding of findingsList) {
          const path = resolvePath(finding.path || '', rootDir);
          const severity = getSemgrepSeverity(finding.severity);

          findings.push({
            tool: 'semgrep',
            path,
            line: finding.start.line || 1,
            column: finding.start.col,
            message: finding.extra.message || finding.check_id || 'Semgrep finding',
            severity,
            rule: finding.check_id,
            suggestedFix: finding.extra.fix,
          });
        }
      } catch (parseError: any) {
        console.warn(`semgrep: Failed to parse JSON output: ${parseError.message}`);
      }
    }

    if (stderr && !stderr.includes('Semgrep scan complete')) {
      console.warn(`semgrep: ${stderr.trim()}`);
    }
  } catch (error: any) {
    console.warn(`semgrep: ${error.message}`);
  }

  return findings;
}

/**
 * Convert Semgrep severity to our format
 */
function getSemgrepSeverity(severity: string): 'error' | 'warning' | 'info' {
  const lower = severity.toLowerCase();
  if (lower.includes('error') || lower.includes('critical')) return 'error';
  if (lower.includes('warning') || lower.includes('medium')) return 'warning';
  return 'info';
}

/**
 * Execute a command with timeout
 */
function executeCommand(
  command: string,
  args: string[],
  cwd: string,
  timeout: number
): Promise<{ stdout: string; stderr: string; timedOut: boolean }> {
  return new Promise((resolve) => {
    let timedOut = false;
    let child: ReturnType<typeof spawn> | null = null;
    
    const timer = setTimeout(() => {
      timedOut = true;
      if (child) {
        try {
          child.kill('SIGTERM');
        } catch {
          // ignore
        }
      }
    }, timeout);

    child = spawn(command, args, {
      cwd,
      shell: true,
    });

    let stdout = '';
    let stderr = '';

    child.stdout?.on('data', (data: Buffer) => {
      stdout += data.toString();
    });

    child.stderr?.on('data', (data: Buffer) => {
      stderr += data.toString();
    });

    child.on('close', (code: number | null) => {
      clearTimeout(timer);
      resolve({ stdout, stderr, timedOut });
    });

    child.on('error', (error: Error) => {
      clearTimeout(timer);
      resolve({ stdout, stderr: error.message, timedOut });
    });
  });
}

/**
 * Check if a tool is available in PATH
 */
function isToolAvailable(tool: string): boolean {
  try {
    const result = spawnSync('which', [tool], { encoding: 'utf-8' });
    return result.status === 0;
  } catch {
    return false;
  }
}

/**
 * Resolve a relative path to absolute, relative to rootDir
 */
function resolvePath(pathStr: string, rootDir: string): string {
  if (pathStr.startsWith('/')) {
    return pathStr;
  }
  return join(rootDir, pathStr);
}

/**
 * Main function to run all static analysis tools
 * @param rootDir Root directory of the project
 * @param config Configuration options
 * @returns Array of all findings
 */
export async function runStaticAnalysis(
  rootDir: string,
  config: StaticAnalysisConfig = {}
): Promise<StaticFinding[]> {
  const settings = { ...DEFAULT_CONFIG, ...config };

  if (!settings.enabled) {
    return [];
  }

  const allFindings: StaticFinding[] = [];
  const executionTimes: Record<string, number> = {};

  for (const tool of settings.tools) {
    const startTime = Date.now();
    try {
      let findings: StaticFinding[] = [];
      switch (tool) {
        case 'tsc':
          findings = await runTsc(rootDir, settings.timeout);
          break;
        case 'eslint':
          findings = await runEslint(rootDir, settings.timeout);
          break;
        case 'semgrep':
          findings = await runSemgrep(rootDir, settings.timeout);
          break;
      }
      executionTimes[tool] = Date.now() - startTime;
      allFindings.push(...findings);
      console.log(`Static analysis (${tool}): ${findings.length} findings in ${executionTimes[tool]}ms`);
    } catch (error: any) {
      console.warn(`Static analysis (${tool}): Failed - ${error.message}`);
      executionTimes[tool] = Date.now() - startTime;
    }
  }

  if (allFindings.length > 0) {
    console.log(`Static analysis complete: ${allFindings.length} total findings`);
    console.log(`Execution times: ${JSON.stringify(executionTimes)}`);
  }

  return allFindings;
}

/**
 * Format findings for display
 */
export function formatFindings(findings: StaticFinding[]): string {
  if (findings.length === 0) {
    return 'No static analysis findings.';
  }

  const grouped: Record<string, StaticFinding[]> = {};
  for (const finding of findings) {
    const key = `${finding.tool}:${finding.path}`;
    if (!grouped[key]) {
      grouped[key] = [];
    }
    grouped[key].push(finding);
  }

  let output = '';
  for (const [key, fileFindings] of Object.entries(grouped)) {
    output += `\n## [${fileFindings[0].tool.toUpperCase()}] ${fileFindings[0].path}\n`;
    for (const finding of fileFindings) {
      output += `- Line ${finding.line}:${finding.column || 1} [${finding.severity}] ${finding.message}`;
      if (finding.rule) {
        output += ` (${finding.rule})`;
      }
      output += '\n';
    }
  }

  return output;
}
