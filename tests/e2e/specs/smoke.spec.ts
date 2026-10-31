// The library (#88): an agency workspace calls its brands clients; a solo or company one says brands.
import { expect, test } from '@playwright/test'
import { writeOutput } from '../support/editor.ts'
import { API_URL } from '../support/seed.ts'

const setKind = (kind: 'solo' | 'company' | 'agency') =>
  fetch(`${API_URL}/workspace`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ kind }) })

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
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Harbour Coffee')
})

test('a solo or company workspace says brands everywhere it said clients', async ({ page }) => {
  for (const kind of ['solo', 'company'] as const) {
    expect((await setKind(kind)).ok).toBe(true)
    await page.goto('/')
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Brands')
    await expect(page.getByRole('complementary', { name: 'Brands' })).toBeVisible()
    await expect(page.getByText('Pick a brand to see and make its designs.')).toBeVisible()
  }
  writeOutput('workspace-1-company.png', await page.screenshot())
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/brands/dev-brand-cycles')
  await expect(page.getByRole('link', { name: 'All brands' })).toBeVisible()
  writeOutput('workspace-2-company-phone.png', await page.screenshot())
})
