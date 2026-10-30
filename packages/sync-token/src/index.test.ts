import { describe, expect, it } from 'vitest'
import { signSyncToken, SYNC_TOKEN_TTL_MS, syncTokenSecret, verifySyncToken } from './index.ts'

const secret = 'a'.repeat(32)
const who = { designId: 'design-1', orgId: 'org-1', userId: 'user-1' }

describe('sync tokens', () => {
  it('accepts a fresh token for its design', () => {
    const { token, expiresAt } = signSyncToken(secret, who, 1_000)
    expect(expiresAt).toBe(1_000 + SYNC_TOKEN_TTL_MS)
    expect(verifySyncToken(secret, token, 'design-1', 2_000)).toEqual({ ok: true, payload: { ...who, expiresAt } })
  })

  it('refuses an expired token', () => {
    const { token, expiresAt } = signSyncToken(secret, who, 1_000)
    expect(verifySyncToken(secret, token, 'design-1', expiresAt)).toEqual({ ok: false, reason: 'expired token' })
  })

  it('refuses a token for another design', () => {
    const { token } = signSyncToken(secret, who)
    expect(verifySyncToken(secret, token, 'design-2')).toEqual({ ok: false, reason: 'token for another design' })
  })

  it('refuses a token signed with another secret, or changed after signing', () => {
    const { token } = signSyncToken('b'.repeat(32), who)
    expect(verifySyncToken(secret, token, 'design-1')).toEqual({ ok: false, reason: 'bad signature' })
    const [, signature] = signSyncToken(secret, who).token.split('.')
    const forged = `${Buffer.from(JSON.stringify({ ...who, designId: 'design-2', expiresAt: Date.now() + 1e6 })).toString('base64url')}.${signature}`
    expect(verifySyncToken(secret, forged, 'design-2')).toEqual({ ok: false, reason: 'bad signature' })
  })

  it('refuses tokens that are not tokens', () => {
    for (const token of ['', 'abc', 'a.b.c', '.sig']) {
      expect(verifySyncToken(secret, token, 'design-1')).toEqual({ ok: false, reason: expect.stringMatching(/malformed|bad signature/) })
    }
  })

  it('needs a secret of at least 32 characters from the environment', () => {
    expect(() => syncTokenSecret({})).toThrow('SYNC_TOKEN_SECRET')
    expect(() => syncTokenSecret({ SYNC_TOKEN_SECRET: 'short' })).toThrow('SYNC_TOKEN_SECRET')
    expect(syncTokenSecret({ SYNC_TOKEN_SECRET: secret })).toBe(secret)
  })
})
