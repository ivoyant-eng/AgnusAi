import { AbilityBuilder, createMongoAbility, MongoAbility } from '@casl/ability'
import type { FastifyReply, FastifyRequest } from 'fastify'
import type { AuthJwtClaims } from './types'

export type AppAction = 'manage' | 'read' | 'create' | 'update' | 'delete' | 'invite' | 'rotate'
export type AppSubject = 'all' | 'System' | 'Org' | 'Repo' | 'Webhook' | 'Invite'
export type AppAbility = MongoAbility<[AppAction, AppSubject]>

export function buildAbilityFor(user: AuthJwtClaims) {
  const { can, build } = new AbilityBuilder<AppAbility>(createMongoAbility)

  if (user.isSystemAdmin) {
    can('manage', 'all')
    return build()
  }

  can('read', 'Org')
  can('read', 'Repo')
  can('read', 'Webhook')

  if (user.activeOrgRole === 'admin') {
    can('update', 'Org')
    can('invite', 'Invite')
    can('rotate', 'Webhook')
    can('update', 'Repo')
  }

  return build()
}

export function requireAbility(action: AppAction, subject: AppSubject) {
  return async (req: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const user = req.user as AuthJwtClaims
    const ability = buildAbilityFor(user)
    if (!ability.can(action, subject)) {
      reply.status(403).send({ error: 'Forbidden' })
    }
  }
}
