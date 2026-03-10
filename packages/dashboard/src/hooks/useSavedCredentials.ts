import { useState, useEffect } from 'react'
import type { SavedCredential } from '@/types/connect'

const CREDS_KEY = 'ryv:saved_credentials'

function loadAll(): SavedCredential[] {
  try { return JSON.parse(localStorage.getItem(CREDS_KEY) ?? '[]') } catch { return [] }
}

/**
 * Manages PAT credentials stored in localStorage, scoped to the active platform.
 */
export function useSavedCredentials(platform: 'github' | 'azure') {
  const [creds, setCreds] = useState<SavedCredential[]>([])

  // Reload when platform changes
  useEffect(() => {
    setCreds(loadAll().filter(c => c.platform === platform))
  }, [platform])

  function save(label: string, token: string) {
    const cred: SavedCredential = { id: Date.now().toString(), label, token, platform }
    const updated = [...loadAll().filter(c => c.id !== cred.id), cred]
    localStorage.setItem(CREDS_KEY, JSON.stringify(updated))
    setCreds(updated.filter(c => c.platform === platform))
  }

  function remove(id: string) {
    const updated = loadAll().filter(c => c.id !== id)
    localStorage.setItem(CREDS_KEY, JSON.stringify(updated))
    setCreds(updated.filter(c => c.platform === platform))
  }

  return { creds, save, remove }
}
