// Onboarding (#109): who Razzlr is for as three big cards, then "Paste your website" names the
// first brand and opens its home. The tests that change who it is for are in smoke.spec.ts, the one
// file that changes the workspace's kind, so no other file runs beside them in another kind.
import { expect, test, type Page } from '@playwright/test'
import { writeOutput } from '../support/editor.ts'

const shoot = async (page: Page, name: string) => writeOutput(`welcome-${name}.png`, await page.screenshot())

test.use({ viewport: { width: 1440, height: 900 } })

test('a pasted website names the first brand and opens its home', async ({ page }) => {
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
