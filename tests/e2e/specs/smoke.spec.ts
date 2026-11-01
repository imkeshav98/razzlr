// The library (#88, ADR-0013): every workspace lists its brands as brands, the development
// workspace's two included, and settings names the workspace.
import { expect, test, type Page } from '../support/test.ts'
import { writeOutput } from '../support/editor.ts'
import { API_URL } from '../support/seed.ts'

const shoot = async (page: Page, name: string) => writeOutput(`welcome-${name}.png`, await page.screenshot())

test('the web app lists the brands of the development workspace', async ({ page }) => {
  await page.goto('/')
  await expect(page).toHaveTitle('Dazbee')
  for (const link of ['link[rel="icon"][type="image/svg+xml"]', 'link[rel="apple-touch-icon"]', 'link[rel="manifest"]']) {
    const href = await page.locator(link).first().getAttribute('href')
    expect((await page.request.get(href ?? '')).ok(), link).toBe(true)
  }
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Brands')
  await expect(page.getByTestId('brand-switcher')).toContainText('Brands')
  await expect(page.getByText('Pick a brand to see and make its designs.')).toBeVisible()
  await expect(page.getByRole('main').getByRole('link', { name: 'Harbour Coffee' })).toBeVisible()
  await expect(page.getByRole('main').getByRole('link', { name: 'Northline Cycles' })).toBeVisible()
  writeOutput('workspace-0-brands.png', await page.screenshot())
  await page.getByRole('main').getByRole('link', { name: 'Harbour Coffee' }).click()
  await expect(page).toHaveURL(/\/brands\/dev-brand-coffee$/)
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('What are we making today?')
})

test('the crumb switches brand on a phone, and goes back to them all', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/brands/dev-brand-cycles')
  await page.getByTestId('brand-switcher').getByLabel('Switch brand').click()
  await expect(page.getByRole('link', { name: 'All brands' })).toBeVisible()
  await expect(page.getByTestId('new-brand-row')).toHaveText('New brand')
  writeOutput('workspace-2-phone.png', await page.screenshot())
})

test('settings renames the workspace', async ({ page }) => {
  const nameNow = async () => ((await (await fetch(`${API_URL}/workspace`)).json()) as { name: string }).name
  const before = await nameNow()
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/settings')
  const section = page.getByRole('region', { name: 'Workspace' })
  const field = section.getByRole('textbox', { name: 'Workspace name' })
  await expect(field).toHaveValue(before)
  await field.fill('  Harbour Studio ')
  await section.getByRole('button', { name: 'Save' }).click()
  await expect(section.getByRole('status')).toHaveText('Saved')
  expect(await nameNow()).toBe('Harbour Studio')
  await expect(field).toHaveValue('Harbour Studio')
  await shoot(page, 'settings-renamed')
  const restored = await fetch(`${API_URL}/workspace`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: before }) })
  expect(restored.ok).toBe(true)
})
