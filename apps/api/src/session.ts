// Who is asking. Sign-in (WorkOS, #58) will make sessions from cookies; until then a development
// session stands in, and every route still checks org and client against it.

export interface Session {
  userId: string
  orgId: string
}

/** Finds the session of a request, or null when it has none. */
export type SessionOf = (request: Request) => Session | null | Promise<Session | null>

export const DEV_ORG = { id: 'dev-org', name: 'Development agency' }
export const DEV_CLIENTS = [
  { id: 'dev-client-coffee', name: 'Harbour Coffee' },
  { id: 'dev-client-cycles', name: 'Northline Cycles' },
]

/** Every request is the one development user of the development org. Never on in production. */
export const devSession: SessionOf = () => ({ userId: 'dev-user', orgId: DEV_ORG.id })
