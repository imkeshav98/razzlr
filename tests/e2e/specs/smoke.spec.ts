import { expect, test } from '@playwright/test'

test('the web app serves the Razzlr home page', async ({ page }) => {
  await page.goto('/')
  await expect(page).toHaveTitle('Razzlr')
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Razzlr')
})
