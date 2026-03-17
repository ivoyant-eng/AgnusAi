/**
 * Thin HTTP wrapper around the Context7 REST API.
 *
 * Two-step pattern:
 *   1. Resolve libraryName → library ID via /v2/libs/search
 *   2. Fetch ranked docs for the query via /v2/context
 *
 * Returns a formatted markdown string ready for injection as a <tool_result> block.
 */

const BASE_URL = 'https://context7.com/api/v2'

interface SearchResult {
  id: string
  title: string
  trustScore?: number
}

interface Context7Response {
  codeSnippets?: Array<{ title?: string; code: string; language?: string }>
  infoSnippets?: Array<{ content: string }>
}

export async function fetchLibraryDocs(
  libraryName: string,
  query: string,
  version?: string,
  apiKey?: string,
  maxTokens = 4000,
): Promise<string> {
  const headers: Record<string, string> = { 'Accept': 'application/json' }
  if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`

  // Step 1: Resolve library name → library ID
  const searchUrl = `${BASE_URL}/libs/search?libraryName=${encodeURIComponent(libraryName)}&query=${encodeURIComponent(query)}`
  let searchData: { results?: SearchResult[] }
  try {
    const resp = await fetch(searchUrl, { headers })
    if (!resp.ok) {
      return `Context7: failed to resolve library "${libraryName}" (HTTP ${resp.status})`
    }
    searchData = await resp.json() as { results?: SearchResult[] }
  } catch (err) {
    return `Context7: network error resolving "${libraryName}": ${(err as Error).message}`
  }

  const results = searchData.results ?? []
  if (results.length === 0) {
    return `Context7: no documentation found for library "${libraryName}"`
  }

  // Use the first (best) match; append version if provided
  let libraryId = results[0].id
  if (version) {
    libraryId = `${libraryId}/v${version.replace(/^v/, '')}`
  }

  // Step 2: Fetch ranked docs for the query
  const contextUrl = `${BASE_URL}/context?libraryId=${encodeURIComponent(libraryId)}&query=${encodeURIComponent(query)}&tokens=${maxTokens}`
  let contextData: Context7Response
  try {
    const resp = await fetch(contextUrl, { headers })
    if (!resp.ok) {
      return `Context7: failed to fetch docs for "${libraryName}" (HTTP ${resp.status})`
    }
    contextData = await resp.json() as Context7Response
  } catch (err) {
    return `Context7: network error fetching docs for "${libraryName}": ${(err as Error).message}`
  }

  // Format response as markdown for injection into the LLM context
  const versionLabel = version ? `@${version}` : ''
  const lines: string[] = [`## ${libraryName}${versionLabel} — ${query}`, '']

  const infoSnippets = contextData.infoSnippets ?? []
  if (infoSnippets.length > 0) {
    lines.push(infoSnippets.map(s => s.content).join('\n\n'))
    lines.push('')
  }

  const codeSnippets = contextData.codeSnippets ?? []
  if (codeSnippets.length > 0) {
    lines.push('### Code Examples')
    for (const snippet of codeSnippets) {
      if (snippet.title) lines.push(`**${snippet.title}**`)
      const lang = snippet.language ?? 'ts'
      lines.push(`\`\`\`${lang}`)
      lines.push(snippet.code)
      lines.push('```')
      lines.push('')
    }
  }

  const result = lines.join('\n').trim()
  return result || `Context7: no documentation snippets found for "${libraryName}" — "${query}"`
}
