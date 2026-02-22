/**
 * Bridges the API layer with the @agnus-ai/reviewer package.
 * Assembles a ReviewContext (including graph context) and runs the PRReviewAgent.
 */
import path from 'path'
import { PRReviewAgent, GitHubAdapter, AzureDevOpsAdapter, UnifiedLLMBackend } from '@agnus-ai/reviewer'
import type { Config } from '@agnus-ai/reviewer'

// Skills bundled with the reviewer package
const SKILLS_PATH = path.join(require.resolve('@agnus-ai/reviewer'), '../../..', 'skills')
import { getRepo } from './graph-cache'
import type { GraphReviewContext } from '@agnus-ai/shared'

export interface ReviewRunOptions {
  platform: 'github' | 'azure'
  repoId: string
  repoUrl: string
  prNumber: number
  token?: string
}

export async function runReview(opts: ReviewRunOptions): Promise<void> {
  const { platform, repoId, repoUrl, prNumber, token } = opts

  // Parse owner/repo from URL
  const urlParts = repoUrl.replace(/\/$/, '').split('/')
  const repo = urlParts[urlParts.length - 1] ?? ''
  const owner = urlParts[urlParts.length - 2] ?? ''

  // Build VCS adapter
  let vcs
  if (platform === 'github') {
    if (!token) throw new Error('GitHub token required for review')
    vcs = new GitHubAdapter({ token, owner, repo })
  } else {
    if (!token) throw new Error('Azure token required for review')
    vcs = new AzureDevOpsAdapter({
      organization: owner,
      project: repo,
      repository: repo,
      token,
    })
  }

  const config: Config = {
    vcs: {},
    tickets: [],
    llm: {
      provider: (process.env.LLM_PROVIDER as any) ?? 'ollama',
      model: process.env.LLM_MODEL ?? 'qwen2.5-coder',
      providers: {
        ollama: { baseURL: process.env.LLM_BASE_URL ?? 'http://ollama:11434/v1' },
      },
    },
    review: {
      maxDiffSize: 50000,
      focusAreas: [],
      ignorePaths: ['node_modules', 'dist', 'build', '.git'],
    },
    skills: {
      path: SKILLS_PATH,
      default: 'default',
    },
  }

  // Build LLM backend
  const llm = new UnifiedLLMBackend({
    provider: config.llm.provider,
    model: config.llm.model,
    baseURL: config.llm.providers?.ollama?.baseURL,
    apiKey: process.env.LLM_API_KEY,
  })

  const agent = new PRReviewAgent(config)
  agent.setVCS(vcs)
  agent.setLLM(llm)

  // Assemble graph context if a graph is already loaded for this repo
  let graphContext: GraphReviewContext | undefined
  const entry = getRepo(repoId)
  if (entry) {
    const diff = await fetchDiffString(vcs, prNumber)
    if (diff) {
      graphContext = await entry.retriever.getReviewContext(diff, repoId)
    }
  }

  const result = await agent.review(prNumber, graphContext)
  await agent.postReview(prNumber, result)
}

async function fetchDiffString(vcs: any, prNumber: number): Promise<string | null> {
  try {
    const diff = await vcs.getDiff(prNumber)
    return (diff.files as any[]).map((f: any) =>
      `diff --git a/${f.path} b/${f.path}\n--- a/${f.path}\n+++ b/${f.path}\n` +
      (f.hunks as any[]).map((h: any) => h.content).join('\n')
    ).join('\n')
  } catch {
    return null
  }
}
