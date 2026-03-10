import { useState, useRef, useEffect } from 'react'
import type { AppRepo, AppInstallationMeta, PickerState } from '@/types/connect'
import { DEFAULT_PICKER_STATE } from '@/types/connect'

/**
 * Manages per-installation repo picker state (dropdown open/close,
 * search, selected repo, loading) and handles outside-click dismissal.
 *
 * Returns a map keyed by installation ID and helpers to update it.
 */
export function useRepoPicker() {
  const [pickerState, setPickerState] = useState<Record<string, PickerState>>({})
  const pickerRefs = useRef<Record<string, HTMLDivElement | null>>({})

  // Dismiss open dropdowns when clicking outside their container
  useEffect(() => {
    function handleOutsideClick(e: MouseEvent) {
      Object.entries(pickerRefs.current).forEach(([id, ref]) => {
        if (ref && !ref.contains(e.target as Node)) {
          patchPicker(id, { open: false })
        }
      })
    }
    document.addEventListener('mousedown', handleOutsideClick)
    return () => document.removeEventListener('mousedown', handleOutsideClick)
  }, [])

  function getPicker(id: string): PickerState {
    return pickerState[id] ?? { ...DEFAULT_PICKER_STATE }
  }

  function patchPicker(id: string, patch: Partial<PickerState>) {
    setPickerState(prev => {
      const base = prev[id] ?? { ...DEFAULT_PICKER_STATE }
      return { ...prev, [id]: { ...base, ...patch } }
    })
  }

  async function fetchRepos(instId: string) {
    patchPicker(instId, { loading: true, error: '', repos: [], meta: null, selected: null })
    try {
      const res = await fetch(`/api/vcs-installations/${instId}/repos`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: '{}',
      })
      const data = await res.json() as {
        repos?: AppRepo[]
        installation?: AppInstallationMeta
        error?: string
      }
      if (!res.ok || data.error) throw new Error(data.error ?? 'Failed to fetch repositories')
      patchPicker(instId, { repos: data.repos ?? [], meta: data.installation ?? null, loading: false, open: true })
    } catch (err) {
      patchPicker(instId, { loading: false, error: (err as Error).message })
    }
  }

  function setPickerRef(id: string, el: HTMLDivElement | null) {
    pickerRefs.current[id] = el
  }

  return { getPicker, patchPicker, fetchRepos, setPickerRef }
}
