// Sign-in's cookies (#58): the session token from the API, and the state that ties a WorkOS
// callback to the sign-in this browser started. Both are httpOnly, so no script can read them.
import 'server-only'

export { SESSION_COOKIE } from './api.ts'

export const STATE_COOKIE = 'razzlr_sign_in_state'

/** How long a started sign-in may take to come back. */
export const STATE_SECONDS = 10 * 60

/** Cookie settings for an origin: Secure whenever the site is served over https. */
export const cookieOptions = (origin: string | null | undefined) => ({
  httpOnly: true,
  sameSite: 'lax' as const,
  path: '/',
  secure: origin?.startsWith('https:') ?? false,
})
