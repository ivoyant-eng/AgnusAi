import type { AuthJwtClaims } from '@agnus-ai/shared'
export type {
  AuthJwtClaims,
  OrgMembership,
  OrgRole,
  UserRole,
  VcsPlatform,
} from '@agnus-ai/shared'
export {
  ORG_ROLES,
  USER_ROLES,
  VCS_PLATFORMS,
  coerceNullableOrgRole,
  coerceOrgRole,
  coerceUserRole,
  isOrgRole,
  isUserRole,
  isVcsPlatform,
} from '@agnus-ai/shared'

export const SYSTEM_SERVICE_USER: AuthJwtClaims = {
  id: 'system',
  email: 'system@local',
  role: 'admin',
  isSystemAdmin: true,
  activeOrgId: null,
  activeOrgRole: 'admin',
}
