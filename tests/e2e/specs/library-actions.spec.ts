// Renaming, copying and deleting in the library (#159) in Chromium: a design tile's menu renames,
// duplicates and deletes it (asking first); a template tile's menu renames and deletes it; and the
// editor's crumb renames the design open in it.
import { expect, test } from '../support/test.ts'
import { DesignSummary, TemplateSummary, type DesignInput } from '@dazbee/schema'
import { editorPath, writeOutput } from '../support/editor.ts'
import { API_URL, DEV_BRAND, seed } from '../support/seed.ts'

test.describe.configure({ timeout: 120_000 })

const content = (name: string): DesignInput => ({
  meta: { schemaVersion: 2, designId: 'replaced-by-the-api', name, kind: 'single', primaryFormatId: 'sq' },
  formats: { sq: { name: 'Square', width: 1080, height: 1080, order: 'a0' } },
  pages: { p1: { name: 'Page 1', order: 'a0', fills: [{ type: 'solid', color: '#0F6E66FF' }] } },
  nodes: {},
  overrides: {},
})
const designs = async () => DesignSummary.array().parse(await (await fetch(`${API_URL}/brands/${DEV_BRAND}/designs`)).json())
const templates = async () => TemplateSummary.array().parse(await (await fetch(`${API_URL}/brands/${DEV_BRAND}/templates`)).json())

test('a design tile renames, duplicates and deletes its design', async ({ page }) => {
  const run = crypto.randomUUID().slice(0, 6)
  const id = await seed(content(`Summer ${run}`))
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto(`/brands/${DEV_BRAND}?show=recent`)
  const tile = page.getByTestId('bento-tile').filter({ hasText: `Summer ${run}` })
  await tile.hover()
  await tile.getByRole('button', { name: `More for Summer ${run}` }).click()
  await expect(tile.getByRole('menuitem')).toHaveText(['Rename', 'Duplicate', 'Delete'])
  writeOutput('library-actions-1-menu.png', await page.screenshot())

  await tile.getByRole('menuitem', { name: 'Rename' }).click()
  await tile.getByRole('textbox', { name: 'Name' }).fill(`Autumn ${run}`)
  await tile.getByRole('button', { name: 'Save' }).click()
  await expect.poll(async () => (await designs()).find((d) => d.id === id)?.name).toBe(`Autumn ${run}`)
  const renamed = page.locator(`[data-design="${id}"]`)
  await expect(renamed).toBeVisible()

  await renamed.hover()
  await renamed.getByRole('button', { name: `More for Autumn ${run}` }).click()
  await renamed.getByRole('menuitem', { name: 'Duplicate' }).click()
  await expect(page.getByTestId('bento-tile').filter({ hasText: `Autumn ${run} copy` })).toBeVisible()

  // Delete asks first; Cancel keeps it, Delete takes it.
  await renamed.hover()
  await renamed.getByRole('button', { name: `More for Autumn ${run}` }).click()
  await renamed.getByRole('menuitem', { name: 'Delete' }).click()
  await expect(renamed).toContainText('can’t be undone')
  writeOutput('library-actions-2-delete.png', await page.screenshot())
  await renamed.getByRole('button', { name: 'Cancel' }).click()
  expect((await designs()).some((d) => d.id === id)).toBe(true)
  await renamed.hover()
  await renamed.getByRole('button', { name: `More for Autumn ${run}` }).click()
  await renamed.getByRole('menuitem', { name: 'Delete' }).click()
  await renamed.getByRole('button', { name: 'Delete' }).click()
  await expect.poll(async () => (await designs()).some((d) => d.id === id)).toBe(false)
  await expect(renamed).toHaveCount(0)
})

test('a template tile renames and deletes its template', async ({ page }) => {
  const run = crypto.randomUUID().slice(0, 6)
  const saved = await fetch(`${API_URL}/brands/${DEV_BRAND}/templates`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: `Offer ${run}`, scope: 'brand', content: content(`Offer ${run}`) }),
  })
  expect(saved.status).toBe(201)
  const template = TemplateSummary.parse(await saved.json())
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto(`/brands/${DEV_BRAND}?show=templates`)
  const tile = page.locator(`[data-template="${template.id}"]`)
  await tile.hover()
  await tile.getByRole('button', { name: `More for Offer ${run}` }).click()
  await expect(tile.getByRole('menuitem')).toHaveText(['Rename', 'Delete'])
  await tile.getByRole('menuitem', { name: 'Rename' }).click()
  await tile.getByRole('textbox', { name: 'Name' }).fill(`Weekend ${run}`)
  await tile.getByRole('button', { name: 'Save' }).click()
  await expect.poll(async () => (await templates()).find((x) => x.id === template.id)?.name).toBe(`Weekend ${run}`)
  await tile.hover()
  await tile.getByRole('button', { name: `More for Weekend ${run}` }).click()
  await tile.getByRole('menuitem', { name: 'Delete' }).click()
  await tile.getByRole('button', { name: 'Delete' }).click()
  await expect.poll(async () => (await templates()).some((x) => x.id === template.id)).toBe(false)
  await expect(tile).toHaveCount(0)
})

test('the editor renames the design from its crumb', async ({ page }) => {
  const run = crypto.randomUUID().slice(0, 6)
  const id = await seed(content(`Crumb ${run}`))
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto(editorPath(id))
  await expect(page.getByTestId('status')).toHaveAttribute('data-ready', '', { timeout: 30_000 })
  const heading = page.getByRole('heading', { level: 1 })
  await heading.getByRole('button', { name: `Crumb ${run}` }).click()
  const field = page.getByRole('textbox', { name: `Rename Crumb ${run}` })
  await field.fill(`Launch ${run}`)
  await field.press('Enter')
  await expect(heading).toHaveText(`Launch ${run}`)
  await expect.poll(async () => (await designs()).find((d) => d.id === id)?.name).toBe(`Launch ${run}`)
  // Esc keeps the name it has.
  await heading.getByRole('button').click()
  await page.getByRole('textbox', { name: `Rename Launch ${run}` }).fill('Never saved')
  await page.getByRole('textbox', { name: `Rename Launch ${run}` }).press('Escape')
  await expect(heading).toHaveText(`Launch ${run}`)
  writeOutput('library-actions-3-crumb.png', await page.screenshot())
})
