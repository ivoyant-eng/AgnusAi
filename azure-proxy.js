#!/usr/bin/env node
/**
 * azure-proxy.js — OpenAI Responses API ↔ Azure Chat Completions bridge
 *
 * OpenCode's AI SDK calls /v1/responses (Responses API format).
 * Azure cognitiveservices.azure.com only supports Chat Completions.
 *
 * This proxy converts the two formats bidirectionally, including:
 *   - Streaming (SSE) with text deltas and tool call deltas
 *   - Non-streaming JSON responses
 *   - Tool calls (function calling)
 *
 * Runs on port 11440 inside the opencode container.
 * OpenCode connects via OPENAI_BASE_URL=http://127.0.0.1:11440/v1
 */

const http = require('http')
const https = require('https')
const { URL } = require('url')

const PROXY_PORT = parseInt(process.env.AZURE_PROXY_PORT || '11440', 10)
const AZURE_ENDPOINT = process.env.AZURE_OPENAI_ENDPOINT || ''
const AZURE_API_KEY = process.env.AZURE_OPENAI_API_KEY || ''
const AZURE_API_VERSION = process.env.AZURE_API_VERSION || '2024-12-01-preview'
const DEFAULT_MODEL = process.env.LLM_MODEL || 'gpt-5-mini'

if (!AZURE_ENDPOINT || !AZURE_API_KEY) {
  console.error('[azure-proxy] AZURE_OPENAI_ENDPOINT and AZURE_OPENAI_API_KEY required')
  process.exit(1)
}

const baseEndpoint = AZURE_ENDPOINT.replace(/\/$/, '')
const azureUrl = `${baseEndpoint}/chat/completions?api-version=${AZURE_API_VERSION}`
const parsed = new URL(azureUrl)

// ── Format converters ─────────────────────────────────────────────────────────

/** Responses API input[] + instructions → Chat Completions messages[] */
function toMessages(input, instructions) {
  const messages = []
  if (instructions) {
    messages.push({ role: 'system', content: instructions })
  }
  if (typeof input === 'string') {
    messages.push({ role: 'user', content: input })
    return messages
  }
  if (!Array.isArray(input)) return messages

  for (const item of input) {
    const role = item.role || 'user'

    if (role === 'tool') {
      // Tool result message
      messages.push({
        role: 'tool',
        tool_call_id: item.call_id || item.tool_call_id || '',
        content: Array.isArray(item.content)
          ? item.content.map(c => c.text ?? c.output ?? JSON.stringify(c)).join('')
          : String(item.content ?? item.output ?? ''),
      })
      continue
    }

    if (Array.isArray(item.content)) {
      // Check if this is an assistant message with tool calls
      const toolCalls = item.content.filter(c => c.type === 'function_call' || c.type === 'tool_use')
      const textParts = item.content.filter(c =>
        c.type === 'input_text' || c.type === 'output_text' || c.type === 'text')

      if (role === 'assistant' && toolCalls.length > 0) {
        const tool_calls = toolCalls.map(tc => ({
          id: tc.call_id || tc.id,
          type: 'function',
          function: { name: tc.name, arguments: tc.arguments || '{}' },
        }))
        const textContent = textParts.map(c => c.text).join('')
        messages.push({ role: 'assistant', content: textContent || null, tool_calls })
        continue
      }

      const text = item.content.map(c => c.text ?? c.input_text ?? c.output ?? JSON.stringify(c)).join('')
      messages.push({ role, content: text })
    } else {
      messages.push({ role, content: String(item.content ?? '') })
    }
  }
  return messages
}

/** Responses API tools[] → Chat Completions tools[] */
function convertTools(tools) {
  if (!tools?.length) return undefined
  return tools.map(t => ({
    type: 'function',
    function: {
      name: t.name,
      description: t.description || '',
      parameters: t.parameters || t.input_schema || { type: 'object', properties: {} },
    },
  }))
}

/** Build a Responses API response object from a Chat Completions response */
function buildResponseObject(id, modelId, chatCompletion) {
  const choice = chatCompletion.choices?.[0]
  const msg = choice?.message ?? {}
  const output = []

  if (msg.tool_calls?.length) {
    for (const tc of msg.tool_calls) {
      output.push({
        id: `fc_${tc.id}`,
        type: 'function_call',
        call_id: tc.id,
        name: tc.function.name,
        arguments: tc.function.arguments,
        status: 'completed',
      })
    }
  } else {
    const itemId = `msg_${Date.now()}`
    output.push({
      id: itemId,
      type: 'message',
      role: 'assistant',
      status: 'completed',
      content: [{ type: 'output_text', text: msg.content ?? '', annotations: [] }],
    })
  }

  const u = chatCompletion.usage
  return {
    id,
    object: 'response',
    created_at: chatCompletion.created ?? Math.floor(Date.now() / 1000),
    model: chatCompletion.model ?? modelId,
    status: 'completed',
    output,
    usage: {
      input_tokens: u?.prompt_tokens ?? 0,
      output_tokens: u?.completion_tokens ?? 0,
      total_tokens: u?.total_tokens ?? 0,
    },
  }
}

// ── Streaming SSE conversion ──────────────────────────────────────────────────

/**
 * Pipe an Azure Chat Completions SSE stream → Responses API SSE stream.
 * Handles text deltas, tool call deltas, and [DONE] termination.
 */
function pipeStreamingResponse(azureRes, clientRes, responseId, modelId) {
  const sse = (event, data) =>
    clientRes.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)

  sse('response.created', {
    type: 'response.created',
    response: { id: responseId, object: 'response', status: 'in_progress', output: [] },
  })

  let buffer = ''
  // Track current output items
  let outputIndex = 0
  const textItemId = `msg_${Date.now()}`
  const toolItems = {}   // index → { id, callId, name, argsBuffer }
  let isText = false
  let fullText = ''
  let totalUsage = null

  azureRes.on('data', chunk => {
    buffer += chunk.toString()
    const lines = buffer.split('\n')
    buffer = lines.pop() // keep incomplete line

    for (const line of lines) {
      if (!line.startsWith('data:')) continue
      const payload = line.slice(5).trim()
      if (payload === '[DONE]') continue

      let event
      try { event = JSON.parse(payload) } catch { continue }

      if (event.usage) totalUsage = event.usage

      const choice = event.choices?.[0]
      if (!choice) continue
      const delta = choice.delta ?? {}

      // ── Text delta ──────────────────────────────────────────────────────────
      if (delta.content) {
        if (!isText) {
          isText = true
          sse('response.output_item.added', {
            type: 'response.output_item.added',
            output_index: outputIndex,
            item: { id: textItemId, type: 'message', role: 'assistant', content: [], status: 'in_progress' },
          })
          sse('response.content_part.added', {
            type: 'response.content_part.added',
            item_id: textItemId, output_index: outputIndex, content_index: 0,
            part: { type: 'output_text', text: '', annotations: [] },
          })
        }
        fullText += delta.content
        sse('response.output_text.delta', {
          type: 'response.output_text.delta',
          item_id: textItemId, output_index: outputIndex, content_index: 0,
          delta: delta.content,
        })
      }

      // ── Tool call delta ─────────────────────────────────────────────────────
      if (delta.tool_calls) {
        for (const tc of delta.tool_calls) {
          const idx = tc.index ?? 0
          if (!toolItems[idx]) {
            const callId = tc.id || `call_${Date.now()}_${idx}`
            const itemId = `fc_${callId}`
            toolItems[idx] = { id: itemId, callId, name: tc.function?.name ?? '', argsBuffer: '' }
            sse('response.output_item.added', {
              type: 'response.output_item.added',
              output_index: outputIndex + idx,
              item: { id: itemId, type: 'function_call', call_id: callId, name: tc.function?.name ?? '', arguments: '', status: 'in_progress' },
            })
          } else if (tc.function?.name) {
            toolItems[idx].name = tc.function.name
          }
          if (tc.function?.arguments) {
            toolItems[idx].argsBuffer += tc.function.arguments
            sse('response.function_call_arguments.delta', {
              type: 'response.function_call_arguments.delta',
              item_id: toolItems[idx].id, output_index: outputIndex + idx,
              delta: tc.function.arguments,
            })
          }
        }
      }

      // ── Finish ──────────────────────────────────────────────────────────────
      if (choice.finish_reason === 'stop' || choice.finish_reason === 'length') {
        if (isText) {
          sse('response.output_text.done', {
            type: 'response.output_text.done',
            item_id: textItemId, output_index: outputIndex, content_index: 0, text: fullText,
          })
          sse('response.content_part.done', {
            type: 'response.content_part.done',
            item_id: textItemId, output_index: outputIndex, content_index: 0,
            part: { type: 'output_text', text: fullText, annotations: [] },
          })
          sse('response.output_item.done', {
            type: 'response.output_item.done',
            output_index: outputIndex,
            item: {
              id: textItemId, type: 'message', role: 'assistant', status: 'completed',
              content: [{ type: 'output_text', text: fullText, annotations: [] }],
            },
          })
        }
      }

      if (choice.finish_reason === 'tool_calls') {
        for (const [idx, ti] of Object.entries(toolItems)) {
          sse('response.function_call_arguments.done', {
            type: 'response.function_call_arguments.done',
            item_id: ti.id, output_index: outputIndex + parseInt(idx),
            arguments: ti.argsBuffer,
          })
          sse('response.output_item.done', {
            type: 'response.output_item.done',
            output_index: outputIndex + parseInt(idx),
            item: {
              id: ti.id, type: 'function_call', call_id: ti.callId,
              name: ti.name, arguments: ti.argsBuffer, status: 'completed',
            },
          })
        }
      }
    }
  })

  azureRes.on('end', () => {
    // Build output for completed response
    const outputItems = []
    if (isText) {
      outputItems.push({
        id: textItemId, type: 'message', role: 'assistant', status: 'completed',
        content: [{ type: 'output_text', text: fullText, annotations: [] }],
      })
    }
    for (const ti of Object.values(toolItems)) {
      outputItems.push({
        id: ti.id, type: 'function_call', call_id: ti.callId,
        name: ti.name, arguments: ti.argsBuffer, status: 'completed',
      })
    }

    sse('response.completed', {
      type: 'response.completed',
      response: {
        id: responseId,
        object: 'response',
        status: 'completed',
        model: modelId,
        output: outputItems,
        usage: {
          input_tokens: totalUsage?.prompt_tokens ?? 0,
          output_tokens: totalUsage?.completion_tokens ?? 0,
          total_tokens: totalUsage?.total_tokens ?? 0,
        },
      },
    })
    clientRes.end()
  })

  azureRes.on('error', err => {
    console.error('[azure-proxy] upstream stream error:', err.message)
    clientRes.end()
  })
}

// ── HTTP server ───────────────────────────────────────────────────────────────

const server = http.createServer(async (req, res) => {
  if (req.method !== 'POST') {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ status: 'ok', proxy: 'azure-openai' }))
    return
  }

  let raw = ''
  for await (const chunk of req) raw += chunk.toString()

  let body
  try {
    body = JSON.parse(raw)
  } catch {
    res.writeHead(400, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: { message: 'Invalid JSON body' } }))
    return
  }

  // Convert Responses API → Chat Completions
  const messages = toMessages(body.input, body.instructions)
  const tools = convertTools(body.tools)
  const chatBody = {
    model: body.model || DEFAULT_MODEL,
    messages,
    stream: !!body.stream,
    ...(body.temperature !== undefined && { temperature: body.temperature }),
    ...(body.max_output_tokens && { max_completion_tokens: body.max_output_tokens }),
    ...(tools && { tools }),
    ...(body.tool_choice && { tool_choice: body.tool_choice }),
  }

  const bodyStr = JSON.stringify(chatBody)
  const responseId = `resp_${Date.now()}`

  const options = {
    hostname: parsed.hostname,
    port: 443,
    path: parsed.pathname + parsed.search,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(bodyStr),
      'api-key': AZURE_API_KEY,
    },
  }

  if (body.stream) {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    })
    const proxyReq = https.request(options, azureRes => {
      if (azureRes.statusCode !== 200) {
        let errBody = ''
        azureRes.on('data', c => errBody += c)
        azureRes.on('end', () => {
          console.error(`[azure-proxy] Azure error ${azureRes.statusCode}: ${errBody}`)
          res.write(`event: error\ndata: ${JSON.stringify({ type: 'error', error: { message: errBody } })}\n\n`)
          res.end()
        })
        return
      }
      pipeStreamingResponse(azureRes, res, responseId, chatBody.model)
    })
    proxyReq.on('error', err => {
      console.error('[azure-proxy] request error:', err.message)
      res.end()
    })
    proxyReq.write(bodyStr)
    proxyReq.end()
  } else {
    // Non-streaming
    const proxyReq = https.request(options, azureRes => {
      let respBody = ''
      azureRes.on('data', c => respBody += c)
      azureRes.on('end', () => {
        if (azureRes.statusCode !== 200) {
          console.error(`[azure-proxy] Azure error ${azureRes.statusCode}: ${respBody}`)
          res.writeHead(azureRes.statusCode, { 'Content-Type': 'application/json' })
          res.end(respBody)
          return
        }
        let chatResp
        try { chatResp = JSON.parse(respBody) } catch {
          res.writeHead(502, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: { message: 'Invalid JSON from Azure' } }))
          return
        }
        const responsesResp = buildResponseObject(responseId, chatBody.model, chatResp)
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify(responsesResp))
      })
    })
    proxyReq.on('error', err => {
      console.error('[azure-proxy] request error:', err.message)
      res.writeHead(502, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: { message: err.message } }))
    })
    proxyReq.write(bodyStr)
    proxyReq.end()
  }
})

server.listen(PROXY_PORT, '127.0.0.1', () => {
  console.log(`[azure-proxy] listening on http://127.0.0.1:${PROXY_PORT} -> ${azureUrl}`)
})
