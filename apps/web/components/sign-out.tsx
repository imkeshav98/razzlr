// Signs the person out (#58); shown only while there is a session to end.
import { SignOutIcon } from '@phosphor-icons/react/ssr'
import { cookies } from 'next/headers'
import { SESSION_COOKIE } from '../lib/sign-in.ts'
import { getMessages } from '../lib/i18n/server.ts'
import { buttonStyles } from './ui/button.tsx'

export async function SignOut() {
  const [jar, t] = await Promise.all([cookies(), getMessages()])
  if (!jar.has(SESSION_COOKIE)) return null
  return (
    <form action="/logout" method="post">
      <button type="submit" data-testid="sign-out" className={buttonStyles({ variant: 'ghost' })}>
        <SignOutIcon size={16} aria-hidden className="rtl:-scale-x-100" />
        {t.signIn.signOut}
      </button>
    </form>
  )
}
