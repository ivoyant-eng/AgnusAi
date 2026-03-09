import fs from 'fs/promises'
import path from 'path'
import type { ParsedSymbol } from '@agnus-ai/shared'
import type { ToolCallCache } from './ToolCallCache'
import type { Diff } from '../types'

const BODY_MAX_LINES = 80
const FILE_MAX_LINES = 200

/** Minimal graph interface — satisfied by InMemorySymbolGraph without importing core. */
export interface SymbolGraph {
  getSymbol(id: string): ParsedSymbol | undefined
  getCallers(id: string, hops: number): ParsedSymbol[]
  getCallees(id: string, hops: number): ParsedSymbol[]
  getAllSymbols(): ParsedSymbol[]
}

export interface ToolStats {
  totalCalls: number
  cacheHits: number
  rounds: number
  breakdown: { tool: string; calls: number; cacheHits: number }[]
}

/**
 * Provides four read-only codebase exploration tools for agents.
 * Each agent gets its own instance (fresh stats) but all share one ToolCallCache
 * so cross-agent cache hits are captured.
 */
export class SymbolExplorer {
  private readonly changedLines: Map<string, Set<number>>

  private _calls = 0
  private _cacheHits = 0
  private _rounds = 0
  private readonly _breakdown = new Map<string, { calls: number; cacheHits: number }>()

  constructor(
    private readonly graph: SymbolGraph,
    private readonly repoPath: string,
    private readonly diff: Diff,
    private readonly cache: ToolCallCache,
  ) {
    // Build changed-line index from the diff for ★ annotation in read_file
    this.changedLines = new Map()
    for (const file of diff.files) {
      const added = new Set<number>()
      for (const hunk of file.hunks) {
        let lineNo = hunk.newStart
        for (const line of hunk.content.split('\n')) {
          if (line.startsWith('+')) { added.add(lineNo++); continue }
          if (!line.startsWith('-')) lineNo++ // context line
        }
      }
      this.changedLines.set(file.path.replace(/^\//, ''), added)
    }
  }

  /** Create a sibling explorer sharing the same cache but with fresh stats. */
  fork(): SymbolExplorer {
    return new SymbolExplorer(this.graph, this.repoPath, this.diff, this.cache)
  }

  /** Called by the tool loop to signal a new LLM round started. */
  incrementRound(): void {
    this._rounds++
  }

  getStats(): ToolStats {
    return {
      totalCalls: this._calls,
      cacheHits: this._cacheHits,
      rounds: this._rounds,
      breakdown: Array.from(this._breakdown.entries()).map(([tool, s]) => ({ tool, ...s })),
    }
  }

  /** Execute a named tool and return its result as a string. */
  async executeTool(name: string, args: Record<string, unknown>): Promise<string> {
    const cacheKey = `${name}:${JSON.stringify(args)}`
    this._calls++
    if (!this._breakdown.has(name)) this._breakdown.set(name, { calls: 0, cacheHits: 0 })
    this._breakdown.get(name)!.calls++

    const cached = this.cache.get(cacheKey)
    if (cached !== undefined) {
      this._cacheHits++
      this._breakdown.get(name)!.cacheHits++
      if (process.env.TOOL_DEBUG === 'true') {
        console.log(`[tool] ${name}(${JSON.stringify(args)}) → CACHE HIT`)
      }
      return cached
    }

    let result: string
    try {
      switch (name) {
        case 'get_symbol_body':
          result = await this.getSymbolBody(String(args.symbol_id ?? ''))
          break
        case 'find_callers':
          result = this.findCallers(String(args.symbol_id ?? ''))
          break
        case 'find_callees':
          result = this.findCallees(String(args.symbol_id ?? ''))
          break
        case 'read_file':
          result = await this.readFile(
            String(args.file_path ?? ''),
            args.start_line !== undefined ? Number(args.start_line) : undefined,
            args.end_line !== undefined ? Number(args.end_line) : undefined,
          )
          break
        default:
          result = `Unknown tool: ${name}`
      }
    } catch (err) {
      result = `Tool error: ${(err as Error).message}`
    }

    if (process.env.TOOL_DEBUG === 'true') {
      console.log(`[tool] ${name}(${JSON.stringify(args)}) → ${result.length} chars`)
    }

    this.cache.set(cacheKey, result)
    return result
  }

  // ── Tool implementations ──────────────────────────────────────────────────

  private async getSymbolBody(symbolId: string): Promise<string> {
    const sym = this.graph.getSymbol(symbolId)
    if (!sym) {
      // Try partial match by qualified name
      const all = this.graph.getAllSymbols()
      const match = all.find(s => s.qualifiedName === symbolId || s.id.endsWith(`:${symbolId}`))
      if (!match) return `Symbol not found: "${symbolId}". Use find_callers or find_callees to discover valid symbol IDs.`
      return this.getSymbolBody(match.id)
    }

    const [startLine, endLine] = sym.bodyRange
    if (!startLine || !endLine) {
      return `Symbol "${sym.qualifiedName}" has no body range recorded (it may be a type or interface).`
    }

    const filePath = path.join(this.repoPath, sym.filePath)
    let content: string
    try {
      content = await fs.readFile(filePath, 'utf-8')
    } catch {
      return `Could not read file: ${sym.filePath}`
    }

    const lines = content.split('\n')
    const sliced = lines.slice(startLine - 1, endLine)
    const truncated = sliced.length > BODY_MAX_LINES
    const body = sliced.slice(0, BODY_MAX_LINES).join('\n')

    return [
      `Symbol: ${sym.qualifiedName} (${sym.kind}) — ${sym.filePath}:${startLine}–${endLine}`,
      '```',
      body,
      truncated ? `// … (${sliced.length - BODY_MAX_LINES} more lines — use read_file with start_line=${startLine} to see all)` : '',
      '```',
    ].filter(Boolean).join('\n')
  }

  private findCallers(symbolId: string): string {
    const sym = this.resolveSymbol(symbolId)
    if (!sym) return `Symbol not found: "${symbolId}"`

    const callers = this.graph.getCallers(sym.id, 1).slice(0, 10)
    if (callers.length === 0) return `No direct callers found for "${sym.qualifiedName}".`

    const lines = [`Direct callers of \`${sym.qualifiedName}\` (use get_symbol_body to inspect any):`]
    for (const c of callers) {
      lines.push(`- symbol_id: "${c.id}"  →  \`${c.qualifiedName}\` in ${c.filePath}`)
      lines.push(`  signature: ${c.signature}`)
    }
    return lines.join('\n')
  }

  private findCallees(symbolId: string): string {
    const sym = this.resolveSymbol(symbolId)
    if (!sym) return `Symbol not found: "${symbolId}"`

    const callees = this.graph.getCallees(sym.id, 1).slice(0, 10)
    if (callees.length === 0) return `No direct callees found for "${sym.qualifiedName}".`

    const lines = [`\`${sym.qualifiedName}\` calls (use get_symbol_body to inspect any):`]
    for (const c of callees) {
      lines.push(`- symbol_id: "${c.id}"  →  \`${c.qualifiedName}\` in ${c.filePath}`)
      lines.push(`  signature: ${c.signature}`)
    }
    return lines.join('\n')
  }

  private async readFile(filePath: string, startLine?: number, endLine?: number): Promise<string> {
    if (!filePath) return 'Error: file_path is required.'

    const absPath = path.join(this.repoPath, filePath.replace(/^\//, ''))
    let content: string
    try {
      content = await fs.readFile(absPath, 'utf-8')
    } catch {
      return `Could not read file: ${filePath}. Check that the path matches a file in the diff.`
    }

    const allLines = content.split('\n')
    const total = allLines.length
    const start = Math.max(1, startLine ?? 1)
    const end = Math.min(total, endLine ?? Math.min(total, start + FILE_MAX_LINES - 1))
    const slice = allLines.slice(start - 1, end)
    const truncated = end < total && !endLine

    const changedSet = this.changedLines.get(filePath.replace(/^\//, '')) ?? new Set()
    const annotated = slice.map((line, i) => {
      const lineNo = start + i
      const marker = changedSet.has(lineNo) ? '★' : ' '
      return `${String(lineNo).padStart(4)} ${marker}| ${line}`
    })

    const header = [
      `File: ${filePath}  (${total} lines total, showing ${start}–${end})`,
      `Lines marked ★ are changed in this PR — only these are valid comment targets.`,
    ]
    if (truncated) {
      header.push(`(Use read_file with start_line=${end + 1} to see more)`)
    }

    return [...header, '', ...annotated].join('\n')
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  private resolveSymbol(symbolId: string): ParsedSymbol | undefined {
    const direct = this.graph.getSymbol(symbolId)
    if (direct) return direct
    const all = this.graph.getAllSymbols()
    return all.find(s => s.qualifiedName === symbolId || s.id.endsWith(`:${symbolId}`))
  }

  /** Prompt text describing available tools — injected into the graph context section. */
  static toolDescriptionPrompt(): string {
    return `
### Codebase Explorer (USE THESE BEFORE WRITING COMMENTS)
You MUST use at least one tool before submitting findings. The diff alone is not enough — you need to see the full context of changed functions and their callers to assess real impact.

To call a tool, output this exact format (one JSON object on one line, no extra text after the closing tag):
<tool_call>{"tool": "TOOL_NAME", "args": {"arg_name": "value"}}</tool_call>

Your response will pause after a tool_call. The result will be injected and you will be asked to continue. You can call multiple tools across multiple turns.

**Available tools:**

get_symbol_body — See the full implementation of any function/method in the graph.
  Example: <tool_call>{"tool": "get_symbol_body", "args": {"symbol_id": "app/api/hints/route.ts:POST"}}</tool_call>

find_callers — See what calls a given symbol (1 hop). Reveals blast radius.
  Example: <tool_call>{"tool": "find_callers", "args": {"symbol_id": "app/api/hints/route.ts:POST"}}</tool_call>

find_callees — See what a symbol calls. Reveals dependencies.
  Example: <tool_call>{"tool": "find_callees", "args": {"symbol_id": "app/api/hints/route.ts:POST"}}</tool_call>

read_file — Read the full source of any file. Lines marked ★ are changed in this PR.
  Example: <tool_call>{"tool": "read_file", "args": {"file_path": "app/api/hints/route.ts"}}</tool_call>
  For large files: <tool_call>{"tool": "read_file", "args": {"file_path": "app/api/hints/route.ts", "start_line": 50, "end_line": 150}}</tool_call>

**CRITICAL RULES:**
- Call at least one tool before writing your review findings.
- Use the symbol IDs from "Symbols changed in this PR" above as starting points.
- You may ONLY comment on lines marked ★ in read_file output. Seeing a bug in an unchanged line? Mention it in SUMMARY only — never in a [File: Line:] comment.
- After finishing tool use, output your complete review in the standard format.`.trim()
  }
}

/** Parse <tool_call> blocks from an LLM response. */
export function parseToolCalls(response: string): Array<{ tool: string; args: Record<string, unknown> }> {
  const calls: Array<{ tool: string; args: Record<string, unknown> }> = []
  const regex = /<tool_call>([\s\S]*?)<\/tool_call>/g
  let match: RegExpExecArray | null
  while ((match = regex.exec(response)) !== null) {
    try {
      const parsed = JSON.parse(match[1].trim())
      if (parsed.tool && typeof parsed.tool === 'string') {
        calls.push({ tool: parsed.tool, args: parsed.args ?? {} })
      }
    } catch {
      // malformed JSON — skip
    }
  }
  return calls
}

/** Strip tool_call blocks from a response so they don't confuse the review parser. */
export function stripToolCalls(response: string): string {
  return response.replace(/<tool_call>[\s\S]*?<\/tool_call>/g, '').trim()
}

/** Compute max tool rounds based on PR size. Overridable via env. */
export function computeMaxToolRounds(fileCount: number): number {
  const envOverride = process.env.AGENT_TOOL_MAX_ROUNDS
  if (envOverride) {
    const n = parseInt(envOverride, 10)
    if (Number.isFinite(n) && n > 0) return n
  }
  if (fileCount <= 3) return 3
  if (fileCount <= 10) return 4
  return 5
}
