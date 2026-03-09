import useSWR from 'swr'
import type { AuthUser } from '../types/auth'

const fetcher = (url: string) =>
  fetch(url, { credentials: 'include' }).then(res => {
    if (!res.ok) return null
    return res.json() as Promise<AuthUser>
  })

export function useAuth() {
  const { data, isLoading, mutate } = useSWR<AuthUser | null>('/api/auth/me', fetcher, {
    revalidateOnFocus: false,
    shouldRetryOnError: false,
  })

  return {
    user: data ?? null,
    isLoading,
    mutate,
  }
}
