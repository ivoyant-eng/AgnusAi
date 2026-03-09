import type { AuthJwtClaims } from './types'

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: AuthJwtClaims
    user: AuthJwtClaims
  }
}
