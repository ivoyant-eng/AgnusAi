import { useEffect, useMemo, useState } from 'react'
import { Pencil, Trash2, X, Check } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { usePermissions } from '@/hooks/usePermissions'

type RuleCategory =
  | 'security'
  | 'correctness'
  | 'quality'
  | 'reliability'
  | 'performance'
  | 'testability'
  | 'compliance'
  | 'accessibility'
  | 'observability'
  | 'architecture'
  | 'custom'

type RuleSeverity = 'error' | 'warning' | 'recommendation'
type RuleScopeType = 'org' | 'repo' | 'path'

type Rule = {
  id: string
  name: string
  content: string
  category: RuleCategory
  severity: RuleSeverity
  enabled: boolean
  scopeType: RuleScopeType
  repoId: string | null
  pathPattern: string | null
  source: 'manual' | 'imported' | 'suggested' | 'discovered'
  updatedAt: string
}

type RulesAnalytics = {
  totalRules: number
  enabledRules: number
  passedNoViolations: number
  detectedViolations: number
  mergedViolations: number
  mergeViolationRate: number
}

const EMPTY_FORM = {
  name: '',
  content: '',
  category: 'custom' as RuleCategory,
  severity: 'warning' as RuleSeverity,
  scopeType: 'org' as RuleScopeType,
  repoId: '',
  pathPattern: '',
}

const CATEGORIES: RuleCategory[] = [
  'security', 'correctness', 'quality', 'reliability', 'performance',
  'testability', 'compliance', 'accessibility', 'observability', 'architecture', 'custom',
]
const SEVERITIES: RuleSeverity[] = ['error', 'warning', 'recommendation']
const SCOPES: RuleScopeType[] = ['org', 'repo', 'path']

export default function Rules() {
  const { isOrgAdmin } = usePermissions()
  const [rules, setRules] = useState<Rule[]>([])
  const [analytics, setAnalytics] = useState<RulesAnalytics | null>(null)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState(EMPTY_FORM)

  // Inline edit state
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editForm, setEditForm] = useState(EMPTY_FORM)
  const [editSaving, setEditSaving] = useState(false)

  async function load() {
    setLoading(true)
    try {
      const [rulesRes, analyticsRes] = await Promise.all([
        fetch('/api/rules?includeDisabled=true', { credentials: 'include' }),
        fetch('/api/rules/analytics', { credentials: 'include' }),
      ])
      if (rulesRes.ok) setRules(await rulesRes.json() as Rule[])
      if (analyticsRes.ok) setAnalytics(await analyticsRes.json() as RulesAnalytics)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load().catch(() => {}) }, [])

  const canCreate = useMemo(
    () => isOrgAdmin && form.name.trim().length > 0 && form.content.trim().length > 0,
    [isOrgAdmin, form.name, form.content],
  )

  async function createRule() {
    if (!canCreate || saving) return
    setSaving(true)
    try {
      const res = await fetch('/api/rules', {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: form.name.trim(),
          content: form.content.trim(),
          category: form.category,
          severity: form.severity,
          scopeType: form.scopeType,
          repoId: form.scopeType === 'org' ? null : (form.repoId.trim() || null),
          pathPattern: form.scopeType === 'path' ? (form.pathPattern.trim() || null) : null,
        }),
      })
      if (!res.ok) return
      setForm(EMPTY_FORM)
      await load()
    } finally {
      setSaving(false)
    }
  }

  async function toggleRule(ruleId: string, enabled: boolean) {
    await fetch(`/api/rules/${ruleId}/toggle`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ enabled }),
    })
    setRules(prev => prev.map(r => r.id === ruleId ? { ...r, enabled } : r))
  }

  function startEdit(rule: Rule) {
    setEditingId(rule.id)
    setEditForm({
      name: rule.name,
      content: rule.content,
      category: rule.category,
      severity: rule.severity,
      scopeType: rule.scopeType,
      repoId: rule.repoId ?? '',
      pathPattern: rule.pathPattern ?? '',
    })
  }

  function cancelEdit() {
    setEditingId(null)
  }

  async function saveEdit(ruleId: string) {
    if (editSaving) return
    setEditSaving(true)
    try {
      const res = await fetch(`/api/rules/${ruleId}`, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: editForm.name.trim(),
          content: editForm.content.trim(),
          category: editForm.category,
          severity: editForm.severity,
          scopeType: editForm.scopeType,
          repoId: editForm.scopeType === 'org' ? null : (editForm.repoId.trim() || null),
          pathPattern: editForm.scopeType === 'path' ? (editForm.pathPattern.trim() || null) : null,
        }),
      })
      if (!res.ok) return
      setEditingId(null)
      await load()
    } finally {
      setEditSaving(false)
    }
  }

  async function deleteRule(rule: Rule) {
    if (!window.confirm(`Delete rule "${rule.name}"? This cannot be undone.`)) return
    await fetch(`/api/rules/${rule.id}`, { method: 'DELETE', credentials: 'include' })
    setRules(prev => prev.filter(r => r.id !== rule.id))
    if (editingId === rule.id) setEditingId(null)
  }

  return (
    <div className="space-y-8">
      <div>
        <p className="label-meta mb-3" style={{ color: '#E85A1A' }}>// rules-system</p>
        <h1 className="text-[clamp(1.4rem,2.5vw,2rem)] font-bold leading-none tracking-tight text-foreground">
          Rules.
        </h1>
      </div>

      {/* Analytics */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <MetricCard label="Total Rules" value={analytics?.totalRules ?? 0} />
        <MetricCard label="Enabled Rules" value={analytics?.enabledRules ?? 0} />
        <MetricCard label="Detected Violations (30d)" value={analytics?.detectedViolations ?? 0} />
        <MetricCard label="Merged Violations (30d)" value={analytics?.mergedViolations ?? 0} />
        <MetricCard label="Passed (No Violations)" value={analytics?.passedNoViolations ?? 0} />
        <MetricCard label="Merge Violation Rate" value={`${((analytics?.mergeViolationRate ?? 0) * 100).toFixed(1)}%`} />
      </div>

      {/* Create form */}
      {isOrgAdmin && (
        <div className="border border-border p-5 space-y-4">
          <p className="font-semibold">Create Rule</p>
          <RuleFormFields form={form} setForm={setForm} />
          <Button onClick={createRule} disabled={!canCreate || saving}>
            {saving ? 'Creating...' : 'Create Rule'}
          </Button>
        </div>
      )}

      {/* Rules list */}
      <div className="border border-border overflow-hidden">
        <div className="grid grid-cols-[2fr_1fr_1fr_1fr_1fr_auto] border-b border-border bg-muted/20 px-4 py-3 label-meta gap-3">
          <span>Name</span>
          <span>Category</span>
          <span>Severity</span>
          <span>Scope</span>
          <span>Enabled</span>
          {isOrgAdmin && <span className="w-16" />}
        </div>

        {loading ? (
          <div className="px-4 py-6 label-meta text-muted-foreground">Loading rules...</div>
        ) : rules.length === 0 ? (
          <div className="px-4 py-6 label-meta text-muted-foreground">No rules yet.</div>
        ) : (
          rules.map(rule => (
            <div key={rule.id} className="border-b border-border last:border-0">
              {/* Row */}
              <div className="grid grid-cols-[2fr_1fr_1fr_1fr_1fr_auto] items-center px-4 py-3 text-sm gap-3">
                <div className="min-w-0">
                  <p className="truncate font-medium">{rule.name}</p>
                  <p className="truncate text-xs text-muted-foreground">{rule.content}</p>
                </div>
                <span className="capitalize text-muted-foreground">{rule.category}</span>
                <span className="capitalize text-muted-foreground">{rule.severity}</span>
                <span className="capitalize text-muted-foreground">{rule.scopeType}</span>
                <Switch
                  checked={rule.enabled}
                  disabled={!isOrgAdmin}
                  onCheckedChange={checked => toggleRule(rule.id, checked)}
                />
                {isOrgAdmin && (
                  <div className="flex items-center gap-1 w-16 justify-end">
                    {editingId === rule.id ? (
                      <button
                        onClick={cancelEdit}
                        className="p-1.5 text-muted-foreground hover:text-foreground transition-colors"
                        title="Cancel"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    ) : (
                      <button
                        onClick={() => startEdit(rule)}
                        className="p-1.5 text-muted-foreground hover:text-foreground transition-colors"
                        title="Edit rule"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                    )}
                    <button
                      onClick={() => deleteRule(rule)}
                      className="p-1.5 text-muted-foreground hover:text-destructive transition-colors"
                      title="Delete rule"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                )}
              </div>

              {/* Inline edit form */}
              {editingId === rule.id && (
                <div className="border-t border-border bg-muted/10 px-4 py-4 space-y-3">
                  <p className="label-meta" style={{ color: '#E85A1A' }}>// editing</p>
                  <RuleFormFields form={editForm} setForm={setEditForm} />
                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      onClick={() => saveEdit(rule.id)}
                      disabled={editSaving || !editForm.name.trim() || !editForm.content.trim()}
                    >
                      {editSaving ? 'Saving...' : (
                        <><Check className="h-3.5 w-3.5 mr-1" />Save Changes</>
                      )}
                    </Button>
                    <Button size="sm" variant="outline" onClick={cancelEdit}>
                      Cancel
                    </Button>
                  </div>
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  )
}

// Shared form fields for create + edit
function RuleFormFields({
  form,
  setForm,
}: {
  form: typeof EMPTY_FORM
  setForm: React.Dispatch<React.SetStateAction<typeof EMPTY_FORM>>
}) {
  return (
    <div className="grid gap-3">
      <Input
        placeholder="Rule name"
        value={form.name}
        onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
      />
      <textarea
        className="min-h-24 w-full rounded-md border border-border bg-transparent px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
        placeholder="Rule content (what must be enforced)"
        value={form.content}
        onChange={e => setForm(f => ({ ...f, content: e.target.value }))}
      />
      <div className="grid gap-3 md:grid-cols-3">
        <Select value={form.category} onValueChange={(v: RuleCategory) => setForm(f => ({ ...f, category: v }))}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            {CATEGORIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={form.severity} onValueChange={(v: RuleSeverity) => setForm(f => ({ ...f, severity: v }))}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            {SEVERITIES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={form.scopeType} onValueChange={(v: RuleScopeType) => setForm(f => ({ ...f, scopeType: v }))}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            {SCOPES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      {form.scopeType !== 'org' && (
        <Input
          placeholder="Repo ID (required for repo/path scopes)"
          value={form.repoId}
          onChange={e => setForm(f => ({ ...f, repoId: e.target.value }))}
        />
      )}
      {form.scopeType === 'path' && (
        <Input
          placeholder="Path pattern (e.g. packages/api/src/**)"
          value={form.pathPattern}
          onChange={e => setForm(f => ({ ...f, pathPattern: e.target.value }))}
        />
      )}
    </div>
  )
}

function MetricCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="border border-border p-4">
      <p className="label-meta mb-1">{label}</p>
      <p className="font-semibold text-xl">{value}</p>
    </div>
  )
}
