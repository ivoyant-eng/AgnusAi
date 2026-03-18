import type { CommandHandler } from '../types';
import type { ReviewContext, ReviewResult } from '../../types';

/**
 * Handles PR title / description / label write commands:
 *
 *   add description      → appends AI-generated description to existing body
 *   rephrase description → replaces body entirely
 *   add title            → sets title (replaces — titles can't be appended)
 *   rephrase title       → replaces title
 *   add labels           → appends generated labels to existing ones
 *   rephrase labels      → replaces labels entirely
 *
 * Combinations work too: "write PR description and title", etc.
 * If nothing specific is mentioned, defaults to updating description only.
 */
export const handlePRMeta: CommandHandler = async (ctx, intent, vcs, llm) => {
  const q = (intent.query || ctx.userQuery).toLowerCase()
  const name = ctx.botMention ?? '@ryv'

  // Determine which fields to update
  const wantsDescription = q.includes('description') || q.includes('body') || q.includes('summary')
  const wantsTitle       = q.includes('title')
  const wantsLabels      = q.includes('label')
  // Default to description if nothing specific mentioned
  const updateDescription = wantsDescription || (!wantsTitle && !wantsLabels)
  const updateTitle       = wantsTitle
  const updateLabels      = wantsLabels

  // "rephrase" / "rewrite" / "replace" / "overwrite" → replace; otherwise → append
  const isRephrase = /rephrase|rewrite|replace|overwrite/.test(q)

  // Fetch PR state + diff
  const pr = await vcs.getPR(ctx.prNumber)
  const diff = await vcs.getDiff(ctx.prNumber)
  const files = await vcs.getFiles(ctx.prNumber)

  const context: ReviewContext = {
    pr,
    diff,
    files,
    tickets: [],
    skills: [],
    config: {} as any,
  }
  const emptyResult: ReviewResult = {
    summary: '',
    comments: [],
    suggestions: [],
    verdict: 'comment',
  }

  const generated = await llm.generatePRDescription(context, emptyResult)

  // Build updated fields
  let newTitle = pr.title
  let newBody  = pr.description ?? ''
  let newLabels: string[] = (pr as any).labels ?? []

  if (updateTitle) {
    newTitle = generated.title  // always replace — titles can't be appended
  }

  if (updateDescription) {
    if (isRephrase || !newBody.trim()) {
      newBody = generated.body
    } else {
      // Append under a clear section header
      newBody = `${newBody.trim()}\n\n---\n\n## ${name} Description\n\n${generated.body}`
    }
  }

  if (updateLabels) {
    if (isRephrase) {
      newLabels = generated.labels.slice(0, 3)
    } else {
      // Add without duplicates, cap total at 3
      const existing = new Set(newLabels.map((l: string) => l.toLowerCase()))
      const toAdd = generated.labels.filter(l => !existing.has(l.toLowerCase()))
      newLabels = [...newLabels, ...toAdd].slice(0, 3)
    }
  }

  if (!vcs.updatePRDescription) {
    return { reply: `**${name}** ⚠️ PR description updates are not supported for this VCS platform.` }
  }

  await vcs.updatePRDescription(ctx.prNumber, {
    title: newTitle,
    body: newBody,
    labels: newLabels,
    changeType: generated.changeType,
  })

  // Build confirmation summary
  const updated: string[] = []
  if (updateTitle)       updated.push(`**title** → _${newTitle}_`)
  if (updateDescription) updated.push(`**description** (${isRephrase ? 'replaced' : 'appended'})`)
  if (updateLabels)      updated.push(`**labels** (${isRephrase ? 'replaced' : 'added'}: ${generated.labels.join(', ') || 'none'})`)

  return {
    reply: `**${name}** ✅ Updated ${updated.join(', ')}.`,
  }
}
