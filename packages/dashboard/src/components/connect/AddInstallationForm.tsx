import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { PemUpload } from '@/components/PemUpload'
import type { AddInstallationForm as FormState } from '@/hooks/useVcsInstallations'

interface Props {
  platform: 'github' | 'azure'
  form: FormState
  saving: boolean
  error: string
  redirectUri: string
  onChange: (patch: Partial<FormState>) => void
  onSubmit: (e: React.FormEvent) => void
  onCancel: () => void
}

/**
 * Inline form for adding a new GitHub App installation or Azure Entra ID connection.
 * Rendered as a panel inside the installation list.
 */
export function AddInstallationForm({
  platform,
  form,
  saving,
  error,
  redirectUri,
  onChange,
  onSubmit,
  onCancel,
}: Props) {
  return (
    <form onSubmit={onSubmit} className="border border-border p-4 space-y-3 bg-muted/5">
      <div className="flex items-center justify-between">
        <p className="label-meta" style={{ color: 'var(--lp-accent)' }}>
          {platform === 'github' ? '// new GitHub App installation' : '// new Azure DevOps connection (Entra ID)'}
        </p>
        <button type="button" onClick={onCancel} className="label-meta hover:text-foreground transition-colors text-xs">
          Cancel
        </button>
      </div>

      {platform === 'github' ? (
        <GithubFields form={form} onChange={onChange} />
      ) : (
        <AzureFields form={form} redirectUri={redirectUri} onChange={onChange} />
      )}

      {/* Optional display label */}
      <div className="space-y-1.5">
        <Label htmlFor="add-name">
          Label <span className="label-meta">(optional)</span>
        </Label>
        <Input
          id="add-name"
          placeholder={platform === 'github' ? 'e.g. theashishmaurya personal' : 'e.g. ivoyant org'}
          value={form.displayName}
          onChange={e => onChange({ displayName: e.target.value })}
        />
      </div>

      {error && (
        <p className="font-mono text-xs text-destructive border border-destructive px-3 py-2">
          {error}
        </p>
      )}

      <Button type="submit" size="sm" disabled={saving}>
        {saving ? 'Validating…' : platform === 'github' ? 'Save Installation' : 'Save & Authorize'}
      </Button>
    </form>
  )
}

function GithubFields({ form, onChange }: Pick<Props, 'form' | 'onChange'>) {
  return (
    <>
      <div className="space-y-1.5">
        <Label htmlFor="add-appId">App ID</Label>
        <Input
          id="add-appId"
          type="number"
          placeholder="123456"
          value={form.appId}
          onChange={e => onChange({ appId: e.target.value })}
          required
        />
      </div>
      <div className="space-y-1.5">
        <Label>Private Key (.pem)</Label>
        <PemUpload value={form.privateKey} onChange={pem => onChange({ privateKey: pem })} required />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="add-installId">Installation ID</Label>
        <Input
          id="add-installId"
          type="number"
          placeholder="78901234"
          value={form.installationId}
          onChange={e => onChange({ installationId: e.target.value })}
          required
        />
        <p className="label-meta">
          Find it at <span className="font-mono text-foreground">github.com/settings/installations</span> — click
          your App, the URL ends with the ID.
        </p>
      </div>
    </>
  )
}

function AzureFields({
  form,
  redirectUri,
  onChange,
}: Pick<Props, 'form' | 'redirectUri' | 'onChange'>) {
  return (
    <>
      {/* Redirect URI hint */}
      <div className="border border-border bg-muted/5 px-3 py-2.5 space-y-0.5">
        <p className="label-meta">Register this redirect URI in your Entra app first:</p>
        <p className="font-mono text-xs text-foreground break-all">{redirectUri}</p>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="add-orgUrl">Organization URL</Label>
        <Input
          id="add-orgUrl"
          placeholder="https://dev.azure.com/myorg"
          value={form.orgUrl}
          onChange={e => onChange({ orgUrl: e.target.value })}
          required
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="add-clientId">Application (Client) ID</Label>
        <Input
          id="add-clientId"
          placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
          value={form.clientId}
          onChange={e => onChange({ clientId: e.target.value })}
          required
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="add-tenantId">Directory (Tenant) ID</Label>
        <Input
          id="add-tenantId"
          placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
          value={form.tenantId}
          onChange={e => onChange({ tenantId: e.target.value })}
          required
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="add-clientSecret">Client Secret</Label>
        <Input
          id="add-clientSecret"
          type="password"
          placeholder="Secret value (not the ID)"
          value={form.clientSecret}
          onChange={e => onChange({ clientSecret: e.target.value })}
          required
        />
        <p className="label-meta">
          Azure Portal → App registrations → your app → Certificates &amp; secrets.
          Scope needed: <span className="font-mono text-foreground">user_impersonation</span> (Azure DevOps).
        </p>
      </div>
    </>
  )
}
