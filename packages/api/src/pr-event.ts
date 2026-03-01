import type { Pool } from 'pg'

// ─── Discriminated union ─────────────────────────────────────────────────────

type PREventKind =
  | {
      type: 'pr_review'
      prNumber: number
      baseBranch: string
      prAction: 'created' | 'updated' | 'opened' | 'synchronize'
      incrementalDiff: boolean
      incrementalReview: boolean
    }
  | { type: 'pr_merged'; prNumber: number }
  | { type: 'push_index'; branch: string }
  | { type: 'skip'; reason: string }

export interface PREvent {
  platform: 'github' | 'azure'
  repoId: string
  repoUrl: string
  kind: PREventKind
}

// ─── Shared helpers ───────────────────────────────────────────────────────────

/**
 * Check if a branch is registered in repo_branches.
 * Returns true when the table doesn't exist yet (graceful degradation for
 * deployments that haven't run the migration).
 */
export async function isIndexedBranch(pool: Pool, repoId: string, branch: string): Promise<boolean> {
  try {
    const res = await pool.query(
      'SELECT 1 FROM repo_branches WHERE repo_id = $1 AND branch = $2',
      [repoId, branch],
    )
    return res.rows.length > 0
  } catch (err: any) {
    if (err?.code === '42P01') return true // table does not exist — backwards compat
    throw err
  }
}

export async function markMergedViolations(pool: Pool, repoId: string, prNumber: number): Promise<void> {
  await pool.query(
    `UPDATE rule_violations
     SET status = 'merged_with_violation', resolved_at = NOW()
     WHERE repo_id = $1
       AND pr_number = $2
       AND status = 'open'`,
    [repoId, prNumber],
  )
}

// ─── Normalization ────────────────────────────────────────────────────────────

export async function normalizeGithubEvent(
  event: string,
  payload: Record<string, unknown>,
  repoId: string,
  repoUrl: string,
  pool: Pool,
): Promise<PREvent> {
  if (event === 'push') {
    const branch = ((payload.ref as string) ?? '').replace('refs/heads/', '') || 'main'
    const indexed = await isIndexedBranch(pool, repoId, branch)
    if (!indexed) {
      return { platform: 'github', repoId, repoUrl, kind: { type: 'skip', reason: 'branch not indexed' } }
    }
    return { platform: 'github', repoId, repoUrl, kind: { type: 'push_index', branch } }
  }

  if (event === 'pull_request') {
    const action = payload.action as string

    if (action === 'closed') {
      const merged = Boolean((payload.pull_request as any)?.merged)
      const prNumber = (payload.pull_request as any)?.number as number | undefined
      if (merged && typeof prNumber === 'number') {
        return { platform: 'github', repoId, repoUrl, kind: { type: 'pr_merged', prNumber } }
      }
      return { platform: 'github', repoId, repoUrl, kind: { type: 'skip', reason: 'closed without merge' } }
    }

    if (action === 'opened' || action === 'synchronize') {
      const prNumber = (payload.pull_request as any)?.number as number
      const baseBranch = ((payload.pull_request as any)?.base?.ref as string) ?? 'main'
      return {
        platform: 'github',
        repoId,
        repoUrl,
        kind: {
          type: 'pr_review',
          prNumber,
          baseBranch,
          prAction: action as 'opened' | 'synchronize',
          incrementalDiff: false,
          incrementalReview: action === 'synchronize',
        },
      }
    }

    return { platform: 'github', repoId, repoUrl, kind: { type: 'skip', reason: `unhandled action: ${action}` } }
  }

  return { platform: 'github', repoId, repoUrl, kind: { type: 'skip', reason: `unhandled event: ${event}` } }
}

export async function normalizeAzureEvent(
  payload: Record<string, unknown>,
  repoId: string,
  repoUrl: string,
  pool: Pool,
): Promise<PREvent> {
  const eventType = payload.eventType as string | undefined

  if (eventType === 'git.push') {
    const refUpdates = (payload.resource as any)?.refUpdates as any[] ?? []
    const branch = ((refUpdates[0]?.name as string) ?? '').replace('refs/heads/', '') || 'main'
    const indexed = await isIndexedBranch(pool, repoId, branch)
    if (!indexed) {
      return { platform: 'azure', repoId, repoUrl, kind: { type: 'skip', reason: 'branch not indexed' } }
    }
    return { platform: 'azure', repoId, repoUrl, kind: { type: 'push_index', branch } }
  }

  if (eventType === 'git.pullrequest.created' || eventType === 'git.pullrequest.updated') {
    const prId = (payload.resource as any)?.pullRequestId as number
    const targetRef = ((payload.resource as any)?.targetRefName as string) ?? 'refs/heads/main'
    const baseBranch = targetRef.replace('refs/heads/', '') || 'main'
    const prStatus = String((payload.resource as any)?.status ?? '').toLowerCase()
    const isDraft = Boolean((payload.resource as any)?.isDraft)

    // Side-effect: mark merged violations before the draft/review decision
    if (eventType === 'git.pullrequest.updated' && prStatus === 'completed') {
      await markMergedViolations(pool, repoId, prId)
    }

    // Skip draft PRs — review fires once when the draft is published (isDraft → false)
    if (isDraft) {
      return { platform: 'azure', repoId, repoUrl, kind: { type: 'skip', reason: 'draft PR' } }
    }

    const incrementalDiff = eventType === 'git.pullrequest.updated'
    return {
      platform: 'azure',
      repoId,
      repoUrl,
      kind: {
        type: 'pr_review',
        prNumber: prId,
        baseBranch,
        prAction: incrementalDiff ? 'updated' : 'created',
        incrementalDiff,
        incrementalReview: false,
      },
    }
  }

  return { platform: 'azure', repoId, repoUrl, kind: { type: 'skip', reason: `unhandled event: ${eventType}` } }
}
