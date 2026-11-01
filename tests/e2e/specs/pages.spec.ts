// Pages (#39): duplicate a page with its layers and overrides, reorder it, rename it, delete it and
// bring it back with undo, all from the inspector, with the stage following.
import { expect, test, type Page } from '../support/test.ts'
import { designOf, openTabs, settle, writeOutput } from '../support/editor.ts'

interface Design {
  pages: Record<string, { name: string; order: string }>
  nodes: Record<string, { parentId: string; props: Record<string, unknown> }>
  overrides: Record<string, Record<string, Record<string, unknown>>>
}
const designIn = async (page: Page) => JSON.parse(await designOf(page)) as Design
const pageNames = (design: Design) =>
  Object.values(design.pages).sort((a, b) => (a.order < b.order ? -1 : 1)).map((p) => p.name)
const layersOf = (design: Design, pageId: string) => Object.values(design.nodes).filter((n) => n.parentId === pageId)

test('a page is duplicated with its layers, reordered, renamed, deleted and brought back', async ({ browser }) => {
  test.setTimeout(90_000)
  const { tabs, errors } = await openTabs(browser, 2)
  const [page, other] = tabs as [Page, Page]
  await page.setViewportSize({ width: 1440, height: 900 })
  const pages = page.getByTestId('pages')
  await expect(pages.getByRole('listitem')).toHaveCount(1)
  const first = await designIn(page)
  const layers = layersOf(first, 'p1').length
  expect(layers).toBeGreaterThan(0)

  // Duplicate: a second page right after the first, every layer copied with a fresh id.
  const p1 = pages.locator('[data-page="p1"]')
  await p1.hover()
  await p1.getByRole('button', { name: 'Duplicate page' }).click()
  await expect(pages.getByRole('listitem')).toHaveCount(2)
  let design = await designIn(page)
  const copy = Object.keys(design.pages).find((id) => id !== 'p1') ?? ''
  expect(pageNames(design)).toEqual(['Page 1', 'Page 1 copy'])
  const copied = layersOf(design, copy)
  expect(copied).toHaveLength(layers)
  const propsOf = (nodes: Design['nodes'][string][]) => nodes.map((n) => JSON.stringify(n.props)).sort()
  expect(propsOf(copied)).toEqual(propsOf(layersOf(design, 'p1')))
  await expect(pages.locator(`[data-page="${copy}"]`)).toHaveAttribute('aria-current', 'page')
  expect(await page.evaluate(() => new Set(window.dazbee?.frames().map((f) => f.pageId)).size)).toBe(2)
  writeOutput('pages-0-duplicated.png', await page.screenshot())

  // Reorder: the copy goes first, and the stage puts its row on top.
  const row = pages.locator(`[data-page="${copy}"]`)
  await row.hover()
  await row.getByRole('button', { name: 'Move up' }).click()
  await expect.poll(async () => pageNames(await designIn(page))).toEqual(['Page 1 copy', 'Page 1'])
  await expect(pages.getByRole('listitem').first()).toHaveAttribute('data-page', copy)
  expect(await page.evaluate(() => window.dazbee?.frames().sort((a, b) => a.y - b.y)[0]?.pageId)).toBe(copy)

  // Rename in place.
  await row.getByRole('button', { name: 'Show Page 1 copy' }).dblclick()
  await row.getByRole('textbox', { name: 'Rename' }).fill('Offer')
  await row.getByRole('textbox', { name: 'Rename' }).press('Enter')
  await expect.poll(async () => (await designIn(page)).pages[copy]?.name).toBe('Offer')
  await settle([page, other])
  writeOutput('pages-1-reordered.png', await page.screenshot())

  // Delete, then undo from the toast: the page and every layer on it come back.
  await row.hover()
  await row.getByRole('button', { name: 'Delete page' }).click()
  await expect(pages.getByRole('listitem')).toHaveCount(1)
  design = await designIn(page)
  expect(design.pages[copy]).toBeUndefined()
  expect(layersOf(design, copy)).toHaveLength(0)
  await expect(pages.locator('[data-page="p1"]').getByRole('button', { name: 'Delete page' })).toBeDisabled()
  const toast = page.getByTestId('removed-toast')
  await expect(toast).toContainText('Offer deleted')
  await toast.hover()
  writeOutput('pages-2-deleted.png', await page.screenshot())
  await toast.getByRole('button', { name: 'Undo' }).click()
  await expect(pages.getByRole('listitem')).toHaveCount(2)
  design = await designIn(page)
  expect(pageNames(design)).toEqual(['Offer', 'Page 1'])
  expect(layersOf(design, copy)).toHaveLength(layers)

  // The other tab follows every step.
  await settle([page, other])
  expect(pageNames(await designIn(other))).toEqual(['Offer', 'Page 1'])
  writeOutput('pages-3-restored.png', await page.screenshot())

  // A new page takes the next free name.
  await page.getByRole('button', { name: 'Add page' }).click()
  await expect.poll(async () => pageNames(await designIn(page))).toEqual(['Offer', 'Page 1', 'Page 3'])
  expect(errors).toEqual([])
})
