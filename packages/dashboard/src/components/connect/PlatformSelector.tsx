interface Props {
  value: 'github' | 'azure'
  onChange: (p: 'github' | 'azure') => void
}

const ACTIVE_PLATFORMS = ['github', 'azure'] as const
const COMING_SOON = ['GitLab', 'Bitbucket'] as const

/**
 * Segmented control for picking the VCS platform.
 * GitLab and Bitbucket are shown but disabled ("coming soon").
 */
export function PlatformSelector({ value, onChange }: Props) {
  return (
    <div className="flex border border-border">
      {ACTIVE_PLATFORMS.map(p => (
        <button
          key={p}
          type="button"
          className={`flex-1 py-1.5 text-xs font-mono uppercase tracking-widest transition-colors ${
            value === p
              ? 'bg-foreground text-background'
              : 'text-muted-foreground hover:text-foreground'
          }`}
          onClick={() => onChange(p)}
        >
          {p === 'github' ? 'GitHub' : 'Azure DevOps'}
        </button>
      ))}
      {COMING_SOON.map(p => (
        <button
          key={p}
          type="button"
          disabled
          title="Coming soon"
          className="flex-1 py-1.5 text-xs font-mono uppercase tracking-widest text-muted-foreground/30 cursor-not-allowed"
        >
          {p}
        </button>
      ))}
    </div>
  )
}
