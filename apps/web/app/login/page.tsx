// Sign in (#58): one button to WorkOS AuthKit, which signs in or signs up. The API makes the link;
// the state cookie ties WorkOS's answer to this browser.
import { randomBytes } from 'node:crypto'
import { cookies, headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { BrandMark } from '../../components/brand-mark.tsx'
import { buttonStyles } from '../../components/ui/button.tsx'
import { signInLink } from '../../lib/api.ts'
import { getMessages } from '../../lib/i18n/server.ts'
import { cookieOptions, STATE_COOKIE, STATE_SECONDS } from '../../lib/sign-in.ts'

export const dynamic = 'force-dynamic'

async function start() {
  'use server'
  const state = randomBytes(24).toString('base64url')
  const url = await signInLink(state)
  if (!url) redirect('/login?unavailable=1')
  ;(await cookies()).set(STATE_COOKIE, state, { ...cookieOptions((await headers()).get('origin')), maxAge: STATE_SECONDS })
  redirect(url)
}

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string; unavailable?: string }> }) {
  const [t, query] = await Promise.all([getMessages(), searchParams])
  const notice = query.unavailable ? t.signIn.unavailable : query.error ? t.signIn.failed : null
  return (
    <main className="grid min-h-dvh place-items-center bg-bg px-4">
      <form action={start} className="flex w-full max-w-sm flex-col items-center gap-4 rounded-card border border-line bg-surface p-8 text-center shadow-panel">
        <BrandMark size={40} />
        <h1 className="font-display text-2xl font-semibold tracking-tight">{t.signIn.title}</h1>
        <p className="text-sm text-muted">{t.signIn.lead}</p>
        {notice && <p role="alert" data-testid="sign-in-notice" className="text-sm text-danger">{notice}</p>}
        <button type="submit" data-testid="sign-in" className={buttonStyles({ variant: 'primary', size: 'lg', className: 'w-full' })}>{t.signIn.signIn}</button>
      </form>
    </main>
  )
}
