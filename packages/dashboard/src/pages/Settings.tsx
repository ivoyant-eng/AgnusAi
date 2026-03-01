import { useState } from 'react'
import { cn } from '@/lib/utils'
import { usePermissions } from '@/hooks/usePermissions'
import { ReviewDepth } from '@/components/settings/ReviewDepth'
import { PRDescription } from '@/components/settings/PRDescription'
import { WebhookSecrets } from '@/components/settings/WebhookSecrets'
import { TeamInvites } from '@/components/settings/TeamInvites'
import { ApiKey } from '@/components/settings/ApiKey'
import { TokenUsage } from '@/components/settings/TokenUsage'

type Section = 'review-depth' | 'pr-description' | 'webhook-secrets' | 'team' | 'api-key' | 'token-usage'

export default function Settings() {
  const { user, isOrgAdmin, canInviteMembers, canManageSystemApiKey } = usePermissions()
  const [section, setSection] = useState<Section>('review-depth')

  const NAV: Array<{ key: Section; label: string; show: boolean }> = [
    { key: 'review-depth', label: 'Review Depth', show: true },
    { key: 'pr-description', label: 'PR Description', show: true },
    { key: 'token-usage', label: 'Token Usage', show: isOrgAdmin },
    { key: 'webhook-secrets', label: 'Webhook Secrets', show: isOrgAdmin },
    { key: 'team', label: 'Team & Invites', show: canInviteMembers },
    { key: 'api-key', label: 'API Key', show: canManageSystemApiKey },
  ]

  return (
    <div className="flex gap-0 items-stretch border border-border">

      {/* Sidebar */}
      <aside className="w-52 shrink-0 border-r border-border flex flex-col">
        <div className="px-5 py-4 border-b border-border">
          <p className="label-meta">Settings</p>
        </div>

        <nav className="py-2 flex-1">
          {NAV.filter(n => n.show).map(n => (
            <button
              key={n.key}
              onClick={() => setSection(n.key)}
              className={cn(
                'w-full text-left px-5 py-3 label-meta transition-colors flex items-center gap-3',
                section === n.key
                  ? 'text-foreground bg-muted/30 border-r-2 border-r-[#E85A1A]'
                  : 'hover:bg-muted/20 hover:text-foreground',
              )}
            >
              {section === n.key && (
                <span style={{ width: 5, height: 5, borderRadius: '50%', background: '#E85A1A', flexShrink: 0 }} />
              )}
              {n.label}
            </button>
          ))}
        </nav>

        {user && (
          <div className="border-t border-border px-5 py-4">
            <p className="label-meta truncate text-foreground">{user.email}</p>
            <p className="label-meta mt-1" style={{ color: '#E85A1A' }}>{user.role}</p>
          </div>
        )}
      </aside>

      {/* Content */}
      <div className="flex-1 px-10 py-8 min-w-0 overflow-hidden">
        {section === 'review-depth' && <ReviewDepth />}
        {section === 'pr-description' && <PRDescription />}
        {section === 'token-usage' && isOrgAdmin && <TokenUsage />}
        {section === 'webhook-secrets' && isOrgAdmin && <WebhookSecrets />}
        {section === 'team' && canInviteMembers && <TeamInvites />}
        {section === 'api-key' && canManageSystemApiKey && <ApiKey />}
      </div>
    </div>
  )
}
