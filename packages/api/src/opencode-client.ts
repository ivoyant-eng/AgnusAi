/**
 * OpenCodeClient — HTTP client for the OpenCode sidecar agent.
 *
 * OpenCode runs as a separate service (docker-compose sidecar).
 * It receives tasks, runs a full agentic loop (edit files, run tests,
 * fix errors via LSP), and we stream its progress via SSE.
 *
 * API reference: https://opencode.ai/docs/server/
 */

const OPENCODE_URL = process.env.OPENCODE_URL ?? 'http://opencode:4096'
const OPENCODE_PASSWORD = process.env.OPENCODE_SERVER_PASSWORD ?? ''

export interface OpenCodeTask {
  /** Absolute path to the repo on the shared volume (e.g. /repos/owner-repo) */
  repoPath: string
  /** Full task prompt — includes diff, graph context, blast radius callers, constraints */
  prompt: string
  /** Model override — defaults to OpenCode config default */
  modelID?: string
  providerID?: string
}

export interface OpenCodeResult {
  sessionId: string
  output: string
  /** Files modified by OpenCode (relative paths) */
  modifiedFiles: string[]
  timedOut: boolean
}

export class OpenCodeClient {
  private readonly baseUrl: string
  private readonly authHeader: string

  constructor(baseUrl = OPENCODE_URL, password = OPENCODE_PASSWORD) {
    this.baseUrl = baseUrl.replace(/\/$/, '')
    // OpenCode server uses HTTP Basic Auth
    this.authHeader = password
      ? `Basic ${Buffer.from(`:${password}`).toString('base64')}`
      : ''
  }

  /** Run a task on a local repo checkout. Streams progress and waits for completion. */
  async runTask(task: OpenCodeTask, timeoutMs = 600_000): Promise<OpenCodeResult> {
    // 1. Create session pointing at the repo directory
    const session = await this.post<{ id: string }>(`/session`, {
      // OpenCode reads cwd from the query param
    }, `?directory=${encodeURIComponent(task.repoPath)}`)

    const sessionId = session.id

    // 2. Send the task prompt
    // OpenCode API requires parts array, not a top-level text field.
    // The POST returns the complete response synchronously for short tasks;
    // for long agentic tasks we also subscribe to SSE as a fallback.
    const providerID = task.providerID ?? process.env.OPENCODE_PROVIDER_ID ?? 'opencode'
    const modelID = task.modelID ?? process.env.OPENCODE_MODEL_ID ?? 'big-pickle'
    const msgResponse = await this.post<{ parts?: Array<{ type: string; text?: string; path?: string }> }>(
      `/session/${sessionId}/message`,
      {
        parts: [{ type: 'text', text: task.prompt }],
        model: { providerID, modelID },
      },
    )

    // Extract output and modified files from inline response parts
    const inlineParts = msgResponse.parts ?? []
    const inlineOutput = inlineParts
      .filter(p => p.type === 'text' && p.text)
      .map(p => p.text as string)
      .join('')
    const inlineFiles = inlineParts
      .filter(p => (p.type === 'tool-result') && p.path)
      .map(p => p.path as string)

    // If we got a complete inline response, return immediately
    if (inlineOutput) {
      return { sessionId, output: inlineOutput, modifiedFiles: inlineFiles, timedOut: false }
    }

    // 3. Fallback: stream SSE events until session goes idle or timeout
    const result = await this.streamUntilDone(sessionId, timeoutMs)

    return { sessionId, ...result }
  }

  private async streamUntilDone(
    sessionId: string,
    timeoutMs: number,
  ): Promise<{ output: string; modifiedFiles: string[]; timedOut: boolean }> {
    return new Promise((resolve) => {
      const parts: string[] = []
      const modifiedFiles = new Set<string>()
      let settled = false
      let timeoutHandle: ReturnType<typeof setTimeout>

      const settle = (timedOut: boolean) => {
        if (settled) return
        settled = true
        clearTimeout(timeoutHandle)
        resolve({ output: parts.join(''), modifiedFiles: Array.from(modifiedFiles), timedOut })
      }

      timeoutHandle = setTimeout(() => settle(true), timeoutMs)

      // Use native fetch + ReadableStream to consume SSE
      const headers: Record<string, string> = { Accept: 'text/event-stream' }
      if (this.authHeader) headers['Authorization'] = this.authHeader

      fetch(`${this.baseUrl}/global/event`, { headers })
        .then(async (res) => {
          if (!res.body) { settle(false); return }
          const reader = res.body.getReader()
          const decoder = new TextDecoder()
          let buf = ''

          while (true) {
            const { done, value } = await reader.read()
            if (done) { settle(false); break }

            buf += decoder.decode(value, { stream: true })
            const lines = buf.split('\n')
            buf = lines.pop() ?? ''

            for (const line of lines) {
              if (!line.startsWith('data: ')) continue
              try {
                const event = JSON.parse(line.slice(6))

                if (event.type === 'message.part.updated' && event.part?.text) {
                  parts.push(event.part.text)
                }

                // Track file writes
                if (event.type === 'tool.result' && event.tool === 'write' && event.path) {
                  modifiedFiles.add(event.path)
                }
                if (event.type === 'tool.result' && event.tool === 'edit' && event.path) {
                  modifiedFiles.add(event.path)
                }

                // Session idle = agent finished
                if (event.type === 'session.idle' || event.type === 'session.complete') {
                  settle(false)
                }
              } catch { /* skip malformed events */ }
            }
          }
        })
        .catch(() => settle(false))
    })
  }

  private async post<T = unknown>(path: string, body?: unknown, queryString = ''): Promise<T> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (this.authHeader) headers['Authorization'] = this.authHeader

    const res = await fetch(`${this.baseUrl}${path}${queryString}`, {
      method: 'POST',
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })

    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new Error(`OpenCode API error ${res.status}: ${text}`)
    }

    const text = await res.text()
    return text ? JSON.parse(text) : ({} as T)
  }

  /** Health check — returns true if OpenCode is reachable */
  async isHealthy(): Promise<boolean> {
    try {
      const headers: Record<string, string> = {}
      if (this.authHeader) headers['Authorization'] = this.authHeader
      const res = await fetch(`${this.baseUrl}/global/health`, { headers })
      if (!res.ok) return false
      const data = await res.json() as { healthy?: boolean }
      return data.healthy === true
    } catch {
      return false
    }
  }
}

// Singleton for use across command handlers
let _client: OpenCodeClient | null = null
export function getOpenCodeClient(): OpenCodeClient {
  if (!_client) _client = new OpenCodeClient()
  return _client
}
