import { useAuth } from './useAuth'

export function usePermissions() {
  const { user } = useAuth()

  const isSystemAdmin = Boolean(user?.isSystemAdmin)
  const isOrgAdmin = isSystemAdmin || user?.activeOrgRole === 'admin'

  return {
    user,
    isSystemAdmin,
    isOrgAdmin,
    canInviteMembers: isOrgAdmin,
    canManageSystemApiKey: isSystemAdmin,
  }
}
