// The library (#88): an agency workspace calls its brands clients; a solo or company one says brands.
// Onboarding's cards and settings set that kind (#109). Every test that changes the workspace's
// kind lives in this file, so they run one after another and never beside a test in another kind.
import { expect, test, type Page } from '../support/test.ts'
import { writeOutput } from '../support/editor.ts'
import { API_URL } from '../support/seed.ts'

const setKind = (kind: 'solo' | 'company' | 'agency') =>
  fetch(`${API_URL}/workspace`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ kind }) })

const kindNow = async () => ((await (await fetch(`${API_URL}/workspace`)).json()) as { kind: string }).kind
const shoot = async (page: Page, name: string) => writeOutput(`welcome-${name}.png`, await page.screenshot())

test.afterEach(async () => {
  await setKind('agency')
})

test('the web app lists the brands of the development workspace, as clients of an agency', async ({ page }) => {
  await page.goto('/')
  await expect(page).toHaveTitle('Razzlr')
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Clients')
  await expect(page.getByRole('main').getByRole('link', { name: 'Harbour Coffee' })).toBeVisible()
  await expect(page.getByRole('main').getByRole('link', { name: 'Northline Cycles' })).toBeVisible()
  writeOutput('workspace-0-agency.png', await page.screenshot())
  await page.getByRole('main').getByRole('link', { name: 'Harbour Coffee' }).click()
  await expect(page).toHaveURL(/\/brands\/dev-brand-coffee$/)
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('What are we making for Harbour Coffee?')
})

test('a solo or company workspace says brands everywhere it said clients', async ({ page }) => {
  for (const kind of ['solo', 'company'] as const) {
    expect((await setKind(kind)).ok).toBe(true)
    await page.goto('/')
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Brands')
    await expect(page.getByTestId('brand-switcher')).toContainText('Brands')
    await expect(page.getByText('Pick a brand to see and make its designs.')).toBeVisible()
  }
  writeOutput('workspace-1-company.png', await page.screenshot())
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/brands/dev-brand-cycles')
  // The crumb's brand switches brand, and goes back to them all.
  await page.getByTestId('brand-switcher').getByLabel('Switch brand').click()
  await expect(page.getByRole('link', { name: 'All brands' })).toBeVisible()
  writeOutput('workspace-2-company-phone.png', await page.screenshot())
})

test('each card saves who Razzlr is for, and the words follow', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.context().addCookies([{ name: 'theme', value: 'dark', url: 'http://localhost:3100' }])
  for (const [card, kind, words] of [['Just me', 'solo', 'Brands'], ['My company', 'company', 'Brands'], ['My clients', 'agency', 'Clients']] as const) {
    await page.goto('/welcome')
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Who is Razzlr for?')
    await page.getByText(card, { exact: true }).click()
    await expect(page.getByRole('radio', { name: new RegExp(card) })).toBeChecked()
    if (kind === 'company') {
      await page.waitForTimeout(300) // the last card's check fades out
      await shoot(page, 'kinds')
    }
    await page.getByRole('button', { name: 'Continue' }).click()
    await expect(page).toHaveURL(/\/welcome\?step=brand$/)
    expect(await kindNow()).toBe(kind)
    await expect(page.getByText(`Your first ${kind === 'agency' ? 'client' : 'brand'} takes its name from it.`, { exact: false })).toBeVisible()
    await page.goto('/settings')
    await expect(page.getByTestId('brand-switcher')).toContainText(words)
  }
})

test('settings changes who Razzlr is for later', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/')
  await page.getByRole('link', { name: 'Settings' }).click()
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Settings')
  await expect(page.getByRole('radio', { name: /My clients/ })).toBeChecked()
  await page.getByText('My company', { exact: true }).click()
  await page.getByRole('button', { name: 'Save' }).click()
  await expect(page.getByRole('status')).toHaveText('Saved')
  expect(await kindNow()).toBe('company')
  await expect(page.getByTestId('brand-switcher')).toContainText('Brands')
  await shoot(page, 'settings')
})
