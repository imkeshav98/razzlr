// Sign-in with WorkOS AuthKit (#58). The API alone holds the WorkOS key: it gives the web app the
// sign-in link, swaps the code WorkOS sends back for the person, and makes their session. A first
// sign-in makes a workspace (one WorkOS organization) with the person as its Owner (ADR-0011).
import { randomUUID } from 'node:crypto'
import { memberships, users, workspaces, type Db } from '@razzlr/db'
import type { SignedIn } from '@razzlr/schema'
import { WorkOS } from '@workos-inc/node'
import { asc, eq } from 'drizzle-orm'
import { signSessionToken } from './session.ts'

/** A person WorkOS signed in. */
export interface SignedInPerson {
  user: { id: string; email: string; name: string }
  /** The organization they signed in to, when WorkOS chose one. */
  organizationId: string | null
  /** Their WorkOS session, ended again when they sign out. */
  sessionId: string | null
}

/** What the API needs from WorkOS; tests give it a stand-in that never calls out. */
export interface SignInProvider {
  signInUrl(state: string): string
  /** The person a code from the sign-in page is for; throws when the code is not good. */
  authenticate(code: string): Promise<SignedInPerson>
  /** A new organization for a workspace, returning its WorkOS id. */
  createOrganization(name: string, workspaceId: string): Promise<string>
  addMember(organizationId: string, workosUserId: string): Promise<void>
  signOutUrl(sessionId: string): string
}

export interface WorkosSettings {
  apiKey: string
  clientId: string
  /** The web app's /callback, as registered with WorkOS. */
  redirectUri: string
}

/** WorkOS settings from the environment, or null when sign-in is not set up. */
export function workosSettings(env: NodeJS.ProcessEnv = process.env): WorkosSettings | null {
  const { WORKOS_API_KEY: apiKey, WORKOS_CLIENT_ID: clientId, WORKOS_REDIRECT_URI: redirectUri } = env
  if (!apiKey && !clientId && !redirectUri) return null
  if (!apiKey || !clientId || !redirectUri) throw new Error('Set WORKOS_API_KEY, WORKOS_CLIENT_ID and WORKOS_REDIRECT_URI together')
  return { apiKey, clientId, redirectUri }
}

/** The `sid` claim of a WorkOS access token, which we got from WorkOS itself over TLS. */
export function accessTokenSessionId(accessToken: string): string | null {
  try {
    const claims = JSON.parse(Buffer.from(accessToken.split('.')[1] ?? '', 'base64url').toString('utf8')) as { sid?: unknown }
    return typeof claims.sid === 'string' ? claims.sid : null
  } catch {
    return null
  }
}

export function workosProvider({ apiKey, clientId, redirectUri }: WorkosSettings): SignInProvider {
  const workos = new WorkOS(apiKey, { clientId })
  return {
    signInUrl: (state) => workos.userManagement.getAuthorizationUrl({ provider: 'authkit', clientId, redirectUri, state }),
    async authenticate(code) {
      const { user, organizationId, accessToken } = await workos.userManagement.authenticateWithCode({ clientId, code })
      const name = [user.firstName, user.lastName].filter(Boolean).join(' ')
      return { user: { id: user.id, email: user.email, name }, organizationId: organizationId ?? null, sessionId: accessTokenSessionId(accessToken) }
    },
    async createOrganization(name, workspaceId) {
      return (await workos.organizations.createOrganization({ name, externalId: workspaceId })).id
    },
    async addMember(organizationId, userId) {
      // Roles are ours (memberships.role); WorkOS only needs to know the person belongs.
      await workos.userManagement.createOrganizationMembership({ organizationId, userId })
    },
    signOutUrl: (sessionId) => workos.userManagement.getLogoutUrl({ sessionId }),
  }
}

/** The workspace a first sign-in makes is called after its person until onboarding names it. */
const firstWorkspaceName = (user: SignedInPerson['user']) => (user.name || user.email.split('@')[0] || user.email).slice(0, 120)

/**
 * Signs in a person WorkOS vouched for: records them, picks their workspace (the organization WorkOS
 * chose, else the one they joined first) or makes their first, and makes their session.
 */
export async function completeSignIn(db: Db, provider: SignInProvider, secret: string, person: SignedInPerson): Promise<SignedIn> {
  const [user] = await db.insert(users)
    .values({ id: randomUUID(), workosUserId: person.user.id, email: person.user.email, name: person.user.name })
    .onConflictDoUpdate({ target: users.workosUserId, set: { email: person.user.email, name: person.user.name } })
    .returning({ id: users.id })
  if (!user) throw new Error('The user was not recorded')

  const theirs = await db.select({ workspaceId: memberships.workspaceId, organizationId: workspaces.workosOrganizationId })
    .from(memberships).innerJoin(workspaces, eq(workspaces.id, memberships.workspaceId))
    .where(eq(memberships.userId, user.id)).orderBy(asc(memberships.createdAt), asc(memberships.workspaceId))
  let workspaceId = (theirs.find((w) => person.organizationId && w.organizationId === person.organizationId) ?? theirs[0])?.workspaceId

  if (!workspaceId) {
    // WorkOS first, so a failure there leaves nothing half made here.
    const id = randomUUID()
    const name = firstWorkspaceName(person.user)
    const organizationId = await provider.createOrganization(name, id)
    await provider.addMember(organizationId, person.user.id)
    await db.transaction(async (tx) => {
      await tx.insert(workspaces).values({ id, name, workosOrganizationId: organizationId })
      await tx.insert(memberships).values({ workspaceId: id, userId: user.id, role: 'owner' })
    })
    workspaceId = id
  }

  const { token, expiresAt } = signSessionToken(secret, { userId: user.id, workspaceId, workosSessionId: person.sessionId })
  return { token, expiresAt, workspaceId }
}
