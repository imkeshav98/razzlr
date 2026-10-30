import { expect, test } from '@playwright/test'

test('the web app lists the clients of the development org', async ({ page }) => {
  await page.goto('/')
  await expect(page).toHaveTitle('Razzlr')
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Clients')
  await expect(page.getByRole('link', { name: 'Harbour Coffee' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Northline Cycles' })).toBeVisible()
})
