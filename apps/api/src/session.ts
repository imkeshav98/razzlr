// Who is asking. Sign-in (WorkOS, #58) will make sessions from cookies; until then a development
// session stands in, and every route still checks workspace and brand against it.

export interface Session {
  userId: string
  workspaceId: string
}

/** Finds the session of a request, or null when it has none. */
export type SessionOf = (request: Request) => Session | null | Promise<Session | null>

export const DEV_WORKSPACE = { id: 'dev-workspace', name: 'Development agency', kind: 'agency' as const }
export const DEV_BRANDS = [
  { id: 'dev-brand-coffee', name: 'Harbour Coffee' },
  { id: 'dev-brand-cycles', name: 'Northline Cycles' },
]

/** Every request is the one development user of the development workspace. Never on in production. */
export const devSession: SessionOf = () => ({ userId: 'dev-user', workspaceId: DEV_WORKSPACE.id })
