// Sign-in (#58) in Chromium, as far as it goes without WorkOS: the sign-in page, a callback that
// does not match the sign-in this browser started, and signing out. CI's API has no WorkOS
// settings, so it says sign-in is not set up; signing in against WorkOS test mode is its own run.
import { join } from 'node:path'
import { expect, test } from '../support/test.ts'
import { OUTPUT } from '../support/editor.ts'

const SESSION_COOKIE = 'razzlr_session'

test('the sign-in page offers one button, and says when sign-in is not set up', async ({ page }) => {
  await page.goto('/login')
  await expect(page.getByRole('heading', { name: 'Make every size, for every client.' })).toBeVisible()
  await expect(page).toHaveTitle('Sign in to Razzlr')
  await expect(page.getByTestId('sign-in-notice')).toHaveCount(0)
  await page.getByTestId('sign-in').click()
  await expect(page).toHaveURL(/\/login\?unavailable=1$/)
  await expect(page.getByTestId('sign-in-notice')).toHaveText('Sign-in is not set up on this server yet.')
  await page.screenshot({ path: join(OUTPUT, 'sign-in-page.png') })
})

test('a callback refuses a state this browser did not start with, and keeps no session', async ({ page, context }) => {
  await page.goto('/callback?code=made-up&state=not-the-one-we-started')
  await expect(page).toHaveURL(/\/login\?error=1$/)
  await expect(page.getByTestId('sign-in-notice')).toHaveText('That sign-in did not work. Try again.')
  expect((await context.cookies()).map((c) => c.name)).not.toContain(SESSION_COOKIE)
})

test('signing out forgets the session and lands on the sign-in page', async ({ page, context }) => {
  await page.goto('/')
  await expect(page.getByTestId('sign-out')).toHaveCount(0)
  await context.addCookies([{ name: SESSION_COOKIE, value: 'a-session-token', url: new URL(page.url()).origin, httpOnly: true, sameSite: 'Lax' }])
  await page.reload()
  await page.getByTestId('account-open').click()
  await page.getByTestId('sign-out').click()
  await expect(page).toHaveURL(/\/login$/)
  expect((await context.cookies()).map((c) => c.name)).not.toContain(SESSION_COOKIE)
})

test('a sign-out from another site is refused', async ({ request }) => {
  const response = await request.post('/logout', { headers: { 'sec-fetch-site': 'cross-site' }, maxRedirects: 0 })
  expect(response.status()).toBe(403)
})
