// Designs per client (#33): made from the client's list, opened from the API, kept across reloads.
import { expect, test } from '@playwright/test'
import { writeOutput } from '../support/editor.ts'

test('a design made from the client list opens in the editor and is there after a reload', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.setViewportSize({ width: 1280, height: 900 })
  const name = `Autumn launch ${crypto.randomUUID().slice(0, 6)}`

  await page.goto('/')
  await page.getByRole('link', { name: 'Harbour Coffee' }).click()
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Harbour Coffee')
  writeOutput('designs-1-client.png', await page.screenshot())

  await page.getByLabel('Design name').fill(name)
  await page.getByRole('button', { name: 'New design' }).click()
  await expect(page).toHaveURL(/\/clients\/dev-client-coffee\/designs\/[\w-]+$/)
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(name)
  await expect(page.getByTestId('status')).toHaveText('Live', { timeout: 30_000 })
  const design = await page.evaluate(() => window.razzlr?.design())
  expect(design?.meta.name).toBe(name)
  expect(Object.keys(design?.pages ?? {})).toHaveLength(1)
  writeOutput('designs-2-editor.png', await page.screenshot())

  const url = page.url()
  await page.reload()
  await expect(page.getByTestId('status')).toHaveText('Live', { timeout: 30_000 })
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(name)
  expect(page.url()).toBe(url)

  await page.getByRole('link', { name: 'Harbour Coffee' }).click()
  const listed = page.getByRole('list', { name: 'Designs' }).getByRole('link', { name: new RegExp(name) })
  await expect(listed).toBeVisible()
  writeOutput('designs-3-listed.png', await page.screenshot())
  expect(errors).toEqual([])
})

test('a design id from another client is not found', async ({ page }) => {
  await page.goto('/clients/dev-client-cycles')
  await page.getByLabel('Design name').fill('Cycles only')
  await page.getByRole('button', { name: 'New design' }).click()
  await expect(page).toHaveURL(/\/designs\/[\w-]+$/)
  const designId = page.url().split('/').pop()
  const response = await page.goto(`/clients/dev-client-coffee/designs/${designId}`)
  expect(response?.status()).toBe(404)
})
