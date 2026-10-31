// Sign out (#58): forget the session token, and end the WorkOS session too when there was one.
import { cookies } from 'next/headers'
import { NextResponse, type NextRequest } from 'next/server'
import { signOutLink } from '../../lib/api.ts'
import { SESSION_COOKIE } from '../../lib/sign-in.ts'

export async function POST(request: NextRequest) {
  // Only this site's own sign-out button may sign the person out.
  if (request.headers.get('sec-fetch-site') === 'cross-site') return new NextResponse(null, { status: 403 })
  const jar = await cookies()
  const logoutUrl = jar.has(SESSION_COOKIE) ? await signOutLink().catch(() => null) : null
  jar.delete(SESSION_COOKIE)
  return NextResponse.redirect(logoutUrl ?? new URL('/login', request.url), 303)
}
