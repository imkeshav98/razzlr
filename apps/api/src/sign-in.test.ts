// Sign-in (#58) against Postgres from Docker Compose, with a stand-in for WorkOS that never calls out.
// Signing in against WorkOS itself is the Playwright suite's (tests/e2e/specs/sign-in.spec.ts).
import { randomUUID } from 'node:crypto'
import { memberships, openDatabase, users, workspaces } from '@dazbee/db'
import { ApiError, SignedIn, SignedOut, SignInLink, WorkspaceSummary } from '@dazbee/schema'
import { openStorage, storageSettings } from '@dazbee/storage'
import { and, eq } from 'drizzle-orm'
import { afterAll, describe, expect, it } from 'vitest'
import { createApp } from './app.ts'
import { bearerToken, readSessionToken, SESSION_TTL_MS, signSessionToken, tokenSession } from './session.ts'
import { accessTokenSessionId, workosSettings, type SignedInPerson, type SignInProvider } from './sign-in.ts'

const DATABASE_URL = process.env.DATABASE_URL ?? 'postgres://razzlr:razzlr-local@127.0.0.1:55432/razzlr'
const { db, close } = openDatabase(DATABASE_URL)
const run = randomUUID().slice(0, 8)
const secret = 'test-session-secret-'.padEnd(32, 'x')

/** WorkOS as far as the API sees it: codes name people, and it remembers what it was asked to make. */
function fakeWorkos(people: Record<string, SignedInPerson>) {
  const made = { organizations: [] as { id: string; name: string; workspaceId: string }[], members: [] as { organizationId: string; userId: string }[] }
  const provider: SignInProvider = {
    signInUrl: (state) => `https://auth.example.test/authorize?state=${state}`,
    authenticate: (code) => {
      const person = people[code]
      return person ? Promise.resolve(person) : Promise.reject(new Error('invalid_grant'))
    },
    createOrganization: (name, workspaceId) => {
      const id = `org_${randomUUID()}`
      made.organizations.push({ id, name, workspaceId })
      return Promise.resolve(id)
    },
    addMember: (organizationId, userId) => {
      made.members.push({ organizationId, userId })
      return Promise.resolve()
    },
    signOutUrl: (sessionId) => `https://auth.example.test/logout?session_id=${sessionId}`,
  }
  return { provider, made }
}

const ada: SignedInPerson = { user: { id: `user_ada_${run}`, email: `ada-${run}@example.com`, name: 'Ada Lovelace' }, organizationId: null, sessionId: `session_ada_${run}` }
const bo: SignedInPerson = { user: { id: `user_bo_${run}`, email: `bo-${run}@example.com`, name: '' }, organizationId: null, sessionId: null }
const workos = fakeWorkos({ [`code-ada-${run}`]: ada, [`code-bo-${run}`]: bo })
const storage = openStorage(storageSettings({
  STORAGE_ENDPOINT: 'http://127.0.0.1:59000',
  STORAGE_BUCKET: 'razzlr-test',
  STORAGE_ACCESS_KEY_ID: 'razzlr',
  STORAGE_SECRET_ACCESS_KEY: 'razzlr-local-secret',
  STORAGE_REGION: 'us-east-1',
  ...process.env,
}))
const app = createApp({ db, storage, sessionOf: tokenSession(db, secret), syncSecret: 'test-secret-'.padEnd(32, 'x'), signIn: { provider: workos.provider, secret } })

async function call(method: string, path: string, { body, token }: { body?: unknown; token?: string } = {}) {
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (token) headers.authorization = `Bearer ${token}`
  const response = await app.request(path, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
  return { status: response.status, json: await response.json() as unknown }
}
const signIn = async (code: string) => SignedIn.parse((await call('POST', '/auth/callback', { body: { code } })).json)

afterAll(close)

describe('signing in (#58)', () => {
  it('gives the WorkOS sign-in link for a good state only', async () => {
    const state = randomUUID()
    expect(SignInLink.parse((await call('GET', `/auth/sign-in-url?state=${state}`)).json).url).toBe(`https://auth.example.test/authorize?state=${state}`)
    expect((await call('GET', '/auth/sign-in-url?state=short')).status).toBe(400)
    expect((await call('GET', '/auth/sign-in-url')).status).toBe(400)
  })

  it('makes a workspace, its WorkOS organization and an Owner membership on a first sign-in', async () => {
    const first = await signIn(`code-ada-${run}`)
    const [user] = await db.select().from(users).where(eq(users.workosUserId, ada.user.id))
    expect(user).toMatchObject({ email: ada.user.email, name: 'Ada Lovelace' })
    const [workspace] = await db.select().from(workspaces).where(eq(workspaces.id, first.workspaceId))
    const organization = workos.made.organizations.find((o) => o.workspaceId === first.workspaceId)
    expect(organization).toMatchObject({ name: 'Ada Lovelace' })
    expect(workspace).toMatchObject({ name: 'Ada Lovelace', kind: 'agency', workosOrganizationId: organization?.id })
    expect(workos.made.members).toContainEqual({ organizationId: organization?.id, userId: ada.user.id })
    expect(await db.select({ role: memberships.role }).from(memberships).where(eq(memberships.userId, user?.id ?? ''))).toEqual([{ role: 'owner' }])

    // The session is good for that workspace, and for as long as a session lasts.
    expect(WorkspaceSummary.parse((await call('GET', '/workspace', { token: first.token })).json)).toEqual({ id: first.workspaceId, name: 'Ada Lovelace', kind: 'agency' })
    expect(first.expiresAt - Date.now()).toBeGreaterThan(SESSION_TTL_MS - 60_000)
  })

  it('signs the same person in to the same workspace again, making nothing new', async () => {
    const before = workos.made.organizations.length
    const first = await signIn(`code-ada-${run}`)
    const again = await signIn(`code-ada-${run}`)
    expect(again.workspaceId).toBe(first.workspaceId)
    expect(workos.made.organizations).toHaveLength(before)
    expect(await db.select().from(users).where(eq(users.workosUserId, ada.user.id))).toHaveLength(1)
  })

  it('names a first workspace after the email when WorkOS has no name, and keeps workspaces apart', async () => {
    const bos = await signIn(`code-bo-${run}`)
    const adas = await signIn(`code-ada-${run}`)
    expect(bos.workspaceId).not.toBe(adas.workspaceId)
    expect(WorkspaceSummary.parse((await call('GET', '/workspace', { token: bos.token })).json).name).toBe(`bo-${run}`)
    const brand = await call('POST', '/brands', { token: bos.token, body: { name: 'Bo’s brand' } })
    expect(brand.status).toBe(201)
    expect((await call('GET', '/brands', { token: adas.token })).json).toEqual([])
  })

  it('refuses a code WorkOS does not know, and a body without one', async () => {
    const bad = await call('POST', '/auth/callback', { body: { code: 'not-a-code' } })
    expect(bad.status).toBe(400)
    expect(ApiError.parse(bad.json).error).toMatch(/did not work/)
    expect((await call('POST', '/auth/callback', { body: {} })).status).toBe(400)
  })

  it('ends a session’s WorkOS session on sign-out, when it has one', async () => {
    const adas = await signIn(`code-ada-${run}`)
    expect(SignedOut.parse((await call('POST', '/auth/sign-out', { token: adas.token })).json).logoutUrl).toBe(`https://auth.example.test/logout?session_id=${ada.sessionId}`)
    const bos = await signIn(`code-bo-${run}`)
    expect(SignedOut.parse((await call('POST', '/auth/sign-out', { token: bos.token })).json).logoutUrl).toBeNull()
    expect(SignedOut.parse((await call('POST', '/auth/sign-out')).json).logoutUrl).toBeNull()
  })

  it('stops honouring a session once its person leaves the workspace', async () => {
    const adas = await signIn(`code-ada-${run}`)
    const [user] = await db.select({ id: users.id }).from(users).where(eq(users.workosUserId, ada.user.id))
    await db.delete(memberships).where(and(eq(memberships.workspaceId, adas.workspaceId), eq(memberships.userId, user?.id ?? '')))
    expect((await call('GET', '/workspace', { token: adas.token })).status).toBe(401)
  })
})

describe('session tokens', () => {
  const session = { userId: 'u', workspaceId: 'w', workosSessionId: null }

  it('reads back what was signed, until it expires', () => {
    const { token, expiresAt } = signSessionToken(secret, session, 1_000)
    expect(readSessionToken(secret, token, 2_000)).toEqual({ ...session, expiresAt })
    expect(readSessionToken(secret, token, expiresAt)).toBeNull()
  })

  it('refuses a token signed with another secret, changed, or malformed', () => {
    const { token } = signSessionToken(secret, session)
    expect(readSessionToken('another-secret-'.padEnd(32, 'y'), token)).toBeNull()
    const [text, signature] = token.split('.')
    const changed = Buffer.from(JSON.stringify({ ...session, workspaceId: 'other', expiresAt: Date.now() + 60_000 })).toString('base64url')
    expect(readSessionToken(secret, `${changed}.${signature}`)).toBeNull()
    expect(readSessionToken(secret, text ?? '')).toBeNull()
    expect(readSessionToken(secret, `${token}.more`)).toBeNull()
  })

  it('takes only a bearer token from the authorization header', () => {
    expect(bearerToken(new Request('http://x', { headers: { authorization: 'Bearer abc.def' } }))).toBe('abc.def')
    expect(bearerToken(new Request('http://x', { headers: { authorization: 'Basic abc' } }))).toBeNull()
    expect(bearerToken(new Request('http://x'))).toBeNull()
  })
})

describe('WorkOS settings', () => {
  it('are all given or none, and never default', () => {
    expect(workosSettings({})).toBeNull()
    expect(() => workosSettings({ WORKOS_API_KEY: 'k' })).toThrow(/together/)
    expect(workosSettings({ WORKOS_API_KEY: 'k', WORKOS_CLIENT_ID: 'c', WORKOS_REDIRECT_URI: 'http://localhost:3000/callback' }))
      .toEqual({ apiKey: 'k', clientId: 'c', redirectUri: 'http://localhost:3000/callback' })
  })

  it('reads the session id from a WorkOS access token', () => {
    const claims = Buffer.from(JSON.stringify({ sid: 'session_1', sub: 'user_1' })).toString('base64url')
    expect(accessTokenSessionId(`header.${claims}.signature`)).toBe('session_1')
    expect(accessTokenSessionId('not a token')).toBeNull()
  })
})
