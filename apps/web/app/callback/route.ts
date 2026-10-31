// WorkOS sends the person back here after sign-in (#58): check the state is the one this browser
// started with, swap the code for a session at the API, and keep its token in an httpOnly cookie.
import { cookies } from 'next/headers'
import { NextResponse, type NextRequest } from 'next/server'
import { completeSignIn } from '../../lib/api.ts'
import { cookieOptions, SESSION_COOKIE, STATE_COOKIE } from '../../lib/sign-in.ts'

export async function GET(request: NextRequest) {
  const jar = await cookies()
  const code = request.nextUrl.searchParams.get('code')
  const state = request.nextUrl.searchParams.get('state')
  const expected = jar.get(STATE_COOKIE)?.value
  jar.delete(STATE_COOKIE)
  const failed = () => NextResponse.redirect(new URL('/login?error=1', request.url), 303)
  if (!code || !state || !expected || state !== expected) return failed()
  let session
  try {
    session = await completeSignIn(code)
  } catch {
    return failed()
  }
  jar.set(SESSION_COOKIE, session.token, { ...cookieOptions(request.nextUrl.origin), expires: new Date(session.expiresAt) })
  return NextResponse.redirect(new URL('/', request.url), 303)
}
