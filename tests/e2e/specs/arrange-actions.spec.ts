// The Arrange card's layer actions (#156) in Chromium: duplicate, the four order moves, ungroup and
// use as mask, by click, each with its shortcut in its tooltip.
import { expect, test, type Page } from '../support/test.ts'
import type { DesignInput } from '@razzlr/schema'
import { writeOutput } from '../support/editor.ts'
import { openStage } from '../support/stage.ts'

test.describe.configure({ timeout: 120_000 })

const square = (name: string, index: string, x: number, color: string) => ({
  type: 'graphic' as const, parentId: 'p1', index, name,
  props: { x, y: 200, width: 300, height: 300, shape: { kind: 'rect' as const }, fills: [{ type: 'solid' as const, color }] },
})

const design = (): DesignInput => ({
  meta: { schemaVersion: 2, designId: 'replaced-by-the-api', name: 'Layer actions', kind: 'single', primaryFormatId: 'sq' },
  formats: { sq: { name: 'Square', width: 1080, height: 1080, order: 'a0' } },
  pages: { p1: { name: 'Page 1', order: 'a0', fills: [{ type: 'solid', color: '#FFFFFFFF' }] } },
  nodes: { a: square('A', 'a0', 100, '#FCA311FF'), b: square('B', 'a1', 300, '#14213DFF'), c: square('C', 'a2', 500, '#E0262BFF') },
  overrides: {},
})

type Nodes = Record<string, { parentId: string; index: string; type: string; name: string; props: Record<string, unknown> }>
const nodes = (page: Page) => page.evaluate(() => window.razzlr?.design().nodes) as Promise<Nodes>
/** The page's layers from back to front, by name. */
const order = async (page: Page) => Object.values(await nodes(page)).filter((n) => n.parentId === 'p1').sort((x, y) => (x.index < y.index ? -1 : 1)).map((n) => n.name)
const select = (page: Page, ids: string[]) => page.evaluate((ids) => window.razzlr?.select(ids), ids)

test('the Arrange card duplicates, reorders, ungroups and masks by click', async ({ browser }) => {
  const { page, errors } = await openStage(browser, design())
  const arrange = page.getByTestId('arrange')
  const layer = arrange.getByRole('group', { name: 'Layer' })

  await select(page, ['a'])
  await expect(layer.getByRole('button')).toHaveCount(7)
  await expect(layer.getByRole('button', { name: 'Ungroup' })).toBeDisabled()
  await expect(layer.getByRole('button', { name: 'Bring forward' })).toHaveAttribute('aria-keyshortcuts', 'Control+]')

  await layer.getByRole('button', { name: 'Bring to front' }).click()
  await expect.poll(() => order(page)).toEqual(['B', 'C', 'A'])
  await layer.getByRole('button', { name: 'Send backward' }).click()
  await expect.poll(() => order(page)).toEqual(['B', 'A', 'C'])
  await layer.getByRole('button', { name: 'Send to back' }).click()
  await layer.getByRole('button', { name: 'Bring forward' }).click()
  await expect.poll(() => order(page)).toEqual(['B', 'A', 'C'])

  await layer.getByRole('button', { name: 'Duplicate' }).click()
  await expect.poll(async () => (await order(page)).length).toBe(4)

  // Group two, then ungroup them from the card.
  await select(page, ['b', 'c'])
  await arrange.getByRole('button', { name: 'Group', exact: true }).click()
  await expect.poll(async () => Object.values(await nodes(page)).some((n) => n.type === 'group')).toBe(true)
  await expect(layer.getByRole('button', { name: 'Ungroup' })).toBeEnabled()
  await layer.getByRole('button', { name: 'Ungroup' }).click()
  await expect.poll(async () => Object.values(await nodes(page)).some((n) => n.type === 'group')).toBe(false)

  // One layer becomes a mask and back.
  await select(page, ['a'])
  await layer.getByRole('button', { name: 'Use as mask' }).click()
  await expect.poll(async () => (await nodes(page)).a?.props.mask).toBe('alpha')
  await expect(layer.getByRole('button', { name: 'Use as mask' })).toHaveAttribute('aria-pressed', 'true')
  await page.evaluate(() => window.razzlr?.drawn())
  writeOutput('arrange-actions.png', await page.screenshot())
  await layer.getByRole('button', { name: 'Use as mask' }).click()
  await expect.poll(async () => (await nodes(page)).a?.props.mask).toBeFalsy()
  expect(errors).toEqual([])
})
