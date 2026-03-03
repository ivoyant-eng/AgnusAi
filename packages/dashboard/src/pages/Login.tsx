import { useEffect, useState } from 'react'
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { ArrowRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useAuth } from '@/hooks/useAuth'
import { APP_SHORT } from '@/config/app'

export default function Login() {
  const navigate = useNavigate()
  const location = useLocation()
  const [params] = useSearchParams()
  const inviteToken = params.get('invite') ?? ''
  const { mutate } = useAuth()

  const isInviteRegister = Boolean(inviteToken)
  const isSignup = !isInviteRegister && location.pathname === '/signup'

  const [form, setForm] = useState({ email: '', password: '', orgName: '', orgSlug: '' })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [checkingOrg, setCheckingOrg] = useState(false)
  const [nameAvailability, setNameAvailability] = useState<{ valid: boolean; available: boolean; message: string } | null>(null)
  const [slugAvailability, setSlugAvailability] = useState<{ valid: boolean; available: boolean; message: string; value: string; suggested: string } | null>(null)

  useEffect(() => {
    if (!isSignup) return
    const name = form.orgName.trim()
    const slug = form.orgSlug.trim()
    if (!name) {
      setNameAvailability(null)
      setSlugAvailability(null)
      return
    }

    const timer = setTimeout(async () => {
      setCheckingOrg(true)
      try {
        const qs = new URLSearchParams()
        qs.set('name', name)
        if (slug) qs.set('slug', slug)
        const res = await fetch(`/api/auth/check-org?${qs.toString()}`)
        if (!res.ok) return
        const data = await res.json() as {
          name: { valid: boolean; available: boolean; message: string }
          slug: { valid: boolean; available: boolean; message: string; value: string; suggested: string }
        }
        setNameAvailability(data.name)
        setSlugAvailability(data.slug)
      } finally {
        setCheckingOrg(false)
      }
    }, 400)

    return () => clearTimeout(timer)
  }, [isSignup, form.orgName, form.orgSlug])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (isSignup) {
      if (checkingOrg) return
      if (!nameAvailability?.valid || !nameAvailability?.available) {
        setError(nameAvailability?.message || 'Organization name is not available')
        return
      }
      if (!slugAvailability?.valid || !slugAvailability?.available) {
        setError(slugAvailability?.message || 'Organization slug is not available')
        return
      }
    }
    setLoading(true)
    setError('')
    try {
      const url = isInviteRegister ? '/api/auth/register' : (isSignup ? '/api/auth/signup' : '/api/auth/login')
      const body = isInviteRegister
        ? { token: inviteToken, email: form.email, password: form.password }
        : isSignup
          ? {
              email: form.email,
              password: form.password,
              orgName: form.orgName,
              orgSlug: form.orgSlug || (slugAvailability?.suggested || undefined),
            }
          : { email: form.email, password: form.password }

      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(body),
      })

      if (!res.ok) {
        const d = await res.json() as { error: string }
        throw new Error(d.error ?? 'Request failed')
      }

      await mutate()
      navigate('/app')
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }

  function normalizeSlugInput(value: string): string {
    return value
      .toLowerCase()
      .replace(/\s+/g, '')
      .replace(/[^a-z0-9-]/g, '')
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-6">
      <div className="w-full max-w-md">
        {/* Brand */}
        <div className="flex items-center gap-2 mb-12">
          <div style={{
            display: 'flex', alignItems: 'center', gap: '8px',
          }}>
            <div style={{
              width: '28px', height: '28px',
              background: '#E85A1A',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <span style={{ fontFamily: 'sans-serif', fontWeight: 800, fontSize: '0.85rem', color: '#fff' }}>R</span>
            </div>
            <span style={{ fontFamily: 'sans-serif', fontWeight: 800, fontSize: '1.1rem', letterSpacing: '-0.02em' }}>{APP_SHORT}</span>
          </div>
        </div>

        <h1 className="text-4xl font-bold leading-none tracking-tight text-foreground mb-10">
          {isInviteRegister ? 'Create account.' : (isSignup ? 'Create organization.' : 'Sign in.')}
        </h1>

        <form onSubmit={handleSubmit} className="space-y-5">
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              placeholder="you@example.com"
              value={form.email}
              onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
              required
              autoFocus
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              type="password"
              placeholder="••••••••"
              value={form.password}
              onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
              required
            />
          </div>

          {isSignup && (
            <>
              <div className="space-y-2">
                <Label htmlFor="orgName">Organization Name</Label>
                <Input
                  id="orgName"
                  type="text"
                  placeholder="Platform NX"
                  value={form.orgName}
                  onChange={e => setForm(f => ({ ...f, orgName: e.target.value }))}
                  required
                />
                {nameAvailability && (
                  <p className="label-meta" style={{ color: nameAvailability.available ? 'var(--success, #2e7d32)' : 'var(--destructive)' }}>
                    {nameAvailability.message}
                  </p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="orgSlug">Organization Slug (optional)</Label>
                <Input
                  id="orgSlug"
                  type="text"
                  placeholder="platform-nx"
                  value={form.orgSlug}
                  onChange={e => setForm(f => ({ ...f, orgSlug: normalizeSlugInput(e.target.value) }))}
                />
                <p className="label-meta">lowercase letters, numbers, hyphen only (no spaces)</p>
                {slugAvailability && (
                  <p className="label-meta" style={{ color: slugAvailability.available ? 'var(--success, #2e7d32)' : 'var(--destructive)' }}>
                    {form.orgSlug.trim()
                      ? slugAvailability.message
                      : `Suggested: ${slugAvailability.suggested}`}
                  </p>
                )}
              </div>
            </>
          )}

          {error && (
            <p className="font-mono text-xs text-destructive border border-destructive px-3 py-2">
              {error}
            </p>
          )}

          <Button
            type="submit"
            size="lg"
            disabled={loading || (isSignup && checkingOrg)}
            className="w-full gap-3"
          >
            {loading
              ? (isInviteRegister || isSignup ? 'Creating account...' : 'Signing in...')
              : (isSignup && checkingOrg)
                ? 'Checking availability...'
              : (isInviteRegister ? 'Create Account' : (isSignup ? 'Create Organization' : 'Sign In'))}
            {!loading && <ArrowRight className="h-3.5 w-3.5" />}
          </Button>
        </form>

        {!isInviteRegister && (
          <div className="mt-5 text-xs font-mono text-muted-foreground">
            {isSignup ? (
              <button className="underline" onClick={() => navigate('/login')}>
                Already have an account? Sign in
              </button>
            ) : (
              <button className="underline" onClick={() => navigate('/signup')}>
                New here? Create organization
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
