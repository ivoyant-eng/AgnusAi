import { useState } from 'react'
import useSWR from 'swr'
import type { VcsInstallation } from '@/types/connect'

const fetcher = (url: string) => fetch(url, { credentials: 'include' }).then(r => r.json())

export interface AddInstallationForm {
  displayName: string
  // GitHub App fields
  appId: string
  privateKey: string
  installationId: string
  // Azure Entra ID fields
  clientId: string
  clientSecret: string
  tenantId: string
  orgUrl: string
}

const EMPTY_FORM: AddInstallationForm = {
  displayName: '',
  appId: '',
  privateKey: '',
  installationId: '',
  clientId: '',
  clientSecret: '',
  tenantId: '',
  orgUrl: '',
}

/**
 * Manages the list of VCS installations (GitHub App / Azure Entra ID connections).
 * Handles add, remove, and reauthorize actions.
 */
export function useVcsInstallations(platform: 'github' | 'azure') {
  const { data, mutate } = useSWR<{ installations: VcsInstallation[] }>(
    '/api/vcs-installations',
    fetcher,
  )

  const installations = (data?.installations ?? []).filter(i => i.platform === platform)

  const [showAddForm, setShowAddForm] = useState(false)
  const [addForm, setAddForm] = useState<AddInstallationForm>(EMPTY_FORM)
  const [addSaving, setAddSaving] = useState(false)
  const [addError, setAddError] = useState('')

  function openAddForm() {
    setAddForm(EMPTY_FORM)
    setAddError('')
    setShowAddForm(true)
  }

  function closeAddForm() {
    setShowAddForm(false)
    setAddError('')
  }

  /** Save a new installation. For Azure, returns authUrl to open in a new tab. */
  async function saveInstallation(redirectUri: string): Promise<void> {
    setAddSaving(true)
    setAddError('')
    try {
      const body =
        platform === 'azure'
          ? {
              platform,
              displayName: addForm.displayName || undefined,
              clientId: addForm.clientId,
              clientSecret: addForm.clientSecret,
              tenantId: addForm.tenantId,
              azureOrgUrl: addForm.orgUrl,
              redirectUri,
            }
          : {
              platform,
              displayName: addForm.displayName || undefined,
              appId: addForm.appId,
              privateKey: addForm.privateKey,
              installationId: addForm.installationId,
            }

      const res = await fetch('/api/vcs-installations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(body),
      })
      const result = await res.json() as { installation?: VcsInstallation; authUrl?: string; error?: string }
      if (!res.ok || result.error) throw new Error(result.error ?? 'Failed to save')

      await mutate()
      closeAddForm()

      // For Azure, open the Microsoft OAuth consent page
      if (result.authUrl) {
        window.open(result.authUrl, '_blank', 'noopener,noreferrer')
      }
    } catch (err) {
      setAddError((err as Error).message)
    } finally {
      setAddSaving(false)
    }
  }

  async function removeInstallation(id: string) {
    await fetch(`/api/vcs-installations/${id}`, { method: 'DELETE', credentials: 'include' })
    mutate()
  }

  /** Regenerates the OAuth state and returns a fresh Microsoft auth URL. */
  async function reauthorize(inst: VcsInstallation, redirectUri: string): Promise<string | null> {
    const res = await fetch(`/api/vcs-installations/${inst.id}/reauth`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ redirectUri }),
    })
    const data = await res.json() as { authUrl?: string; error?: string }
    return data.authUrl ?? null
  }

  return {
    installations,
    showAddForm,
    addForm,
    setAddForm,
    addSaving,
    addError,
    openAddForm,
    closeAddForm,
    saveInstallation,
    removeInstallation,
    reauthorize,
  }
}
