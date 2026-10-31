// Onboarding (#109): who Razzlr is for as three big cards, then "Paste your website" names the
// first brand and opens its home; settings changes the answer later. Only words change.
import { expect, test, type Page } from '@playwright/test'
import { writeOutput } from '../support/editor.ts'
import { API_URL } from '../support/seed.ts'

const shoot = async (page: Page, name: string) => writeOutput(`welcome-${name}.png`, await page.screenshot())
const kindNow = async () => ((await (await fetch(`${API_URL}/workspace`)).json()) as { kind: string }).kind
const setKind = (kind: 'solo' | 'company' | 'agency') =>
  fetch(`${API_URL}/workspace`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ kind }) })

test.use({ viewport: { width: 1440, height: 900 } })
test.afterEach(async () => {
  await setKind('agency')
})

test('each card saves who Razzlr is for, and the words follow', async ({ page }) => {
  await page.context().addCookies([{ name: 'theme', value: 'dark', url: 'http://localhost:3100' }])
  for (const [card, kind, words] of [['Just me', 'solo', 'Brands'], ['My company', 'company', 'Brands'], ['My clients', 'agency', 'Clients']] as const) {
    await page.goto('/welcome')
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Who is Razzlr for?')
    await page.getByText(card, { exact: true }).click()
    await expect(page.getByRole('radio', { name: new RegExp(card) })).toBeChecked()
    if (kind === 'company') await shoot(page, 'kinds')
    await page.getByRole('button', { name: 'Continue' }).click()
    await expect(page).toHaveURL(/\/welcome\?step=brand$/)
    expect(await kindNow()).toBe(kind)
    await expect(page.getByText(`Your first ${kind === 'agency' ? 'client' : 'brand'} takes its name from it.`, { exact: false })).toBeVisible()
    await page.goto('/settings')
    await expect(page.getByRole('complementary', { name: words })).toBeVisible()
  }
})

test('a pasted website names the first brand and opens its home', async ({ page }) => {
  await setKind('solo')
  const slug = `harbour-roasters-${crypto.randomUUID().slice(0, 4)}`
  await page.goto('/welcome?step=brand')
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Paste your website')
  await page.getByLabel('Website').fill(`https://www.${slug}.co.uk/shop`)
  await shoot(page, 'website')
  await page.getByRole('button', { name: 'Open it' }).click()
  await expect(page).toHaveURL(/\/brands\/[\w-]+$/)
  const name = slug.split('-').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(`What are we making for ${name}?`)

  // Neither a website nor a name: it asks for one.
  await page.goto('/welcome?step=brand')
  await page.getByRole('button', { name: 'Open it' }).click()
  await expect(page.getByRole('main').getByRole('alert')).toHaveText('Paste a website or type a name.')
})

test('settings changes who Razzlr is for later', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Settings' }).click()
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Settings')
  await expect(page.getByRole('radio', { name: /My clients/ })).toBeChecked()
  await page.getByText('My company', { exact: true }).click()
  await page.getByRole('button', { name: 'Save' }).click()
  await expect(page.getByRole('status')).toHaveText('Saved')
  expect(await kindNow()).toBe('company')
  await expect(page.getByRole('complementary', { name: 'Brands' })).toBeVisible()
  await shoot(page, 'settings')
})

test('on a phone the cards stack and fit', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
  const page = await context.newPage()
  await page.goto('/welcome')
  const cards = await Promise.all(['solo', 'company', 'agency'].map((k) => page.getByTestId(`kind-${k}`).boundingBox()))
  for (const box of cards) expect((box?.width ?? 0)).toBeGreaterThan(340)
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
  await page.waitForTimeout(400)
  await writeOutput('welcome-phone.png', await page.screenshot({ fullPage: true }))
  await context.close()
})
