// Sync tokens: the API signs one for one design after its org and client checks, and the sync
// server accepts a connection only with a valid, unexpired token for the design it opens.
// A token is base64url(JSON payload) "." base64url(HMAC-SHA256 of that text), keyed by a secret
// both servers read from SYNC_TOKEN_SECRET.
import { createHmac, timingSafeEqual } from 'node:crypto'

export interface SyncTokenPayload {
  designId: string
  orgId: string
  userId: string
  /** Expiry, in milliseconds since the epoch. */
  expiresAt: number
}

/** How long a token may be used to open a connection; an open connection outlives it. */
export const SYNC_TOKEN_TTL_MS = 10 * 60 * 1000

/** The shared secret from the environment; refuses one too short to be a real key. */
export function syncTokenSecret(env: NodeJS.ProcessEnv = process.env): string {
  const secret = env.SYNC_TOKEN_SECRET
  if (!secret || secret.length < 32) throw new Error('SYNC_TOKEN_SECRET must be set to at least 32 characters')
  return secret
}

const sign = (secret: string, text: string) => createHmac('sha256', secret).update(text).digest('base64url')

export function signSyncToken(secret: string, payload: Omit<SyncTokenPayload, 'expiresAt'>, now = Date.now()): { token: string; expiresAt: number } {
  const expiresAt = now + SYNC_TOKEN_TTL_MS
  const text = Buffer.from(JSON.stringify({ ...payload, expiresAt })).toString('base64url')
  return { token: `${text}.${sign(secret, text)}`, expiresAt }
}

/** The token's payload when it is signed with `secret`, unexpired and for `designId`; otherwise why not. */
export function verifySyncToken(secret: string, token: string, designId: string, now = Date.now()):
  { ok: true; payload: SyncTokenPayload } | { ok: false; reason: string } {
  const [text, signature, extra] = token.split('.')
  if (!text || !signature || extra !== undefined) return { ok: false, reason: 'malformed token' }
  const expected = Buffer.from(sign(secret, text))
  const given = Buffer.from(signature)
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return { ok: false, reason: 'bad signature' }
  let payload: SyncTokenPayload
  try {
    payload = JSON.parse(Buffer.from(text, 'base64url').toString('utf8')) as SyncTokenPayload
  } catch {
    return { ok: false, reason: 'malformed token' }
  }
  if (typeof payload.expiresAt !== 'number' || payload.expiresAt <= now) return { ok: false, reason: 'expired token' }
  if (payload.designId !== designId) return { ok: false, reason: 'token for another design' }
  return { ok: true, payload }
}
