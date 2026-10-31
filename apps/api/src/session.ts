// Who is asking. A signed-in person sends the session token the API gave them at sign-in (#58) as a
// bearer token; a development session can stand in locally and in CI, and every route checks
// workspace and brand against whichever it is.
import { createHmac, timingSafeEqual } from 'node:crypto'
import { memberships, type Db } from '@razzlr/db'
import { and, eq } from 'drizzle-orm'

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

// Session tokens are base64url(JSON payload) "." base64url(HMAC-SHA256 of that text), keyed by
// SESSION_SECRET, which only the API has. The web app keeps one in an httpOnly cookie.

export interface SessionTokenPayload extends Session {
  /** The WorkOS session it came from, so signing out can end that too; null when there was none. */
  workosSessionId: string | null
  /** Expiry, in milliseconds since the epoch. */
  expiresAt: number
}

/** How long a session lasts before the person signs in again. */
export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000

/** The session secret from the environment; refuses one too short to be a real key. */
export function sessionSecret(env: NodeJS.ProcessEnv = process.env): string {
  const secret = env.SESSION_SECRET
  if (!secret || secret.length < 32) throw new Error('SESSION_SECRET must be set to at least 32 characters')
  return secret
}

const sign = (secret: string, text: string) => createHmac('sha256', secret).update(text).digest('base64url')

export function signSessionToken(secret: string, session: Omit<SessionTokenPayload, 'expiresAt'>, now = Date.now()): { token: string; expiresAt: number } {
  const expiresAt = now + SESSION_TTL_MS
  const text = Buffer.from(JSON.stringify({ ...session, expiresAt } satisfies SessionTokenPayload)).toString('base64url')
  return { token: `${text}.${sign(secret, text)}`, expiresAt }
}

/** The token's payload when it is signed with `secret` and unexpired; otherwise null. */
export function readSessionToken(secret: string, token: string, now = Date.now()): SessionTokenPayload | null {
  const [text, signature, extra] = token.split('.')
  if (!text || !signature || extra !== undefined) return null
  const expected = Buffer.from(sign(secret, text))
  const given = Buffer.from(signature)
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null
  let payload: SessionTokenPayload
  try {
    payload = JSON.parse(Buffer.from(text, 'base64url').toString('utf8')) as SessionTokenPayload
  } catch {
    return null
  }
  if (typeof payload.userId !== 'string' || typeof payload.workspaceId !== 'string') return null
  if (typeof payload.expiresAt !== 'number' || payload.expiresAt <= now) return null
  return payload
}

/** The bearer token of a request, or null. */
export function bearerToken(request: Request): string | null {
  const header = request.headers.get('authorization')
  const match = header && /^Bearer ([\w.-]+)$/.exec(header)
  return match?.[1] ?? null
}

/**
 * Sessions from bearer tokens. A token only counts while its person still belongs to its
 * workspace, so taking a membership away ends their sessions there.
 */
export function tokenSession(db: Db, secret: string): SessionOf {
  return async (request) => {
    const token = bearerToken(request)
    const payload = token ? readSessionToken(secret, token) : null
    if (!payload) return null
    const [member] = await db.select({ userId: memberships.userId }).from(memberships)
      .where(and(eq(memberships.workspaceId, payload.workspaceId), eq(memberships.userId, payload.userId)))
    return member ? { userId: payload.userId, workspaceId: payload.workspaceId } : null
  }
}

/** The first of these that finds a session. */
export function firstSession(...ways: SessionOf[]): SessionOf {
  return async (request) => {
    for (const way of ways) {
      const session = await way(request)
      if (session) return session
    }
    return null
  }
}
