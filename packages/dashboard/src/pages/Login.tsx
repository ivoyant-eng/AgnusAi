import { useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { ArrowRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useAuth } from '@/hooks/useAuth'

export default function Login() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const inviteToken = params.get('invite') ?? ''
  const { mutate } = useAuth()

  const isRegister = Boolean(inviteToken)

  const [form, setForm] = useState({ email: '', password: '' })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')
    try {
      const url = isRegister ? '/api/auth/register' : '/api/auth/login'
      const body = isRegister
        ? { token: inviteToken, email: form.email, password: form.password }
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

  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-6">
      <div className="w-full max-w-md">
        {/* Brand */}
        <div className="flex items-center gap-2 mb-12">
          <span className="bg-[#E85A1A] text-white text-xs tracking-widest uppercase px-2 py-0.5">
            AgnusAI
          </span>
          <span className="text-[10px] tracking-widest uppercase text-muted-foreground/60">
            Code Review
          </span>
        </div>

        <h1 className="text-4xl font-bold leading-none tracking-tight text-foreground mb-10">
          {isRegister ? 'Create account.' : 'Sign in.'}
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

          {error && (
            <p className="font-mono text-xs text-destructive border border-destructive px-3 py-2">
              {error}
            </p>
          )}

          <Button
            type="submit"
            size="lg"
            disabled={loading}
            className="w-full gap-3 bg-[#E85A1A] hover:bg-[#d14e17] text-white border-0"
          >
            {loading ? (isRegister ? 'Creating account...' : 'Signing in...') : (isRegister ? 'Create Account' : 'Sign In')}
            {!loading && <ArrowRight className="h-3.5 w-3.5" />}
          </Button>
        </form>
      </div>
    </div>
  )
}
