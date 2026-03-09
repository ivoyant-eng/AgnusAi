import type { OrgMembership, OrgRole, UserRole } from '@agnus-ai/shared'
export type { OrgMembership, OrgRole, UserRole } from '@agnus-ai/shared'

export interface AuthUser {
  id: string
  email: string
  role: UserRole
  isSystemAdmin?: boolean
  activeOrgId?: string | null
  activeOrgRole?: OrgRole | null
  orgs?: OrgMembership[]
}
