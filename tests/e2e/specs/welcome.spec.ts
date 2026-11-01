// Onboarding (#109, ADR-0013): "Paste your website" names the first brand and opens its home.
import { expect, test, type Page } from '../support/test.ts'
import { writeOutput } from '../support/editor.ts'

const shoot = async (page: Page, name: string) => writeOutput(`welcome-${name}.png`, await page.screenshot())

test.use({ viewport: { width: 1440, height: 900 } })

test('a pasted website names the first brand and opens its home', async ({ page }) => {
  const slug = `harbour-roasters-${crypto.randomUUID().slice(0, 4)}`
  await page.goto('/welcome')
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Paste your website')
  await page.getByLabel('Website').fill(`https://www.${slug}.co.uk/shop`)
  await shoot(page, 'website')
  await page.getByRole('button', { name: 'Open it' }).click()
  await expect(page).toHaveURL(/\/brands\/[\w-]+$/)
  const name = slug.split('-').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('What are we making today?')
  await expect(page.getByTestId('brand-switcher')).toContainText(name)

  // Neither a website nor a name: it asks for one.
  await page.goto('/welcome')
  await page.getByRole('button', { name: 'Open it' }).click()
  await expect(page.getByRole('main').getByRole('alert')).toHaveText('Paste a website or type a name.')
})

test('on a phone the website field fits', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
  const page = await context.newPage()
  await page.goto('/welcome')
  const field = await page.getByRole('textbox', { name: 'Website or name' }).boundingBox()
  // The field shares its bar with Open it, which stays on screen beside it.
  expect(field?.width ?? 0).toBeGreaterThan(160)
  const open = await page.getByRole('button', { name: 'Open it' }).boundingBox()
  expect((open?.x ?? 0) + (open?.width ?? 0)).toBeLessThanOrEqual(390)
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
  await page.waitForTimeout(400)
  await writeOutput('welcome-phone.png', await page.screenshot({ fullPage: true }))
  await context.close()
})
