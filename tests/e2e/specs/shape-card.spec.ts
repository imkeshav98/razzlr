// The Shape card (#151) in Chromium, with real input: a rectangle's corner radius and each corner's
// own, a polygon's sides, a star's points and inner radius, and a line's ends. Layers of different
// shapes have no Shape card.
import { expect, test, type Locator, type Page } from '../support/test.ts'
import type { DesignInput } from '@dazbee/schema'
import { writeOutput } from '../support/editor.ts'
import { openStage } from '../support/stage.ts'

test.describe.configure({ timeout: 120_000 })

const graphic = (name: string, index: string, x: number, y: number, shape: Record<string, unknown>) => ({
  type: 'graphic' as const, parentId: 'p1', index, name,
  props: { x, y, width: 300, height: 300, shape, fills: [{ type: 'solid' as const, color: '#FF3D6EFF' }], strokes: [{ paint: { type: 'solid' as const, color: '#1A1420FF' }, width: 6, align: 'center' as const }] },
})

const design = (): DesignInput => ({
  meta: { schemaVersion: 2, designId: 'replaced-by-the-api', name: 'Shapes', kind: 'single', primaryFormatId: 'sq' },
  formats: { sq: { name: 'Square', width: 1080, height: 1080, order: 'a0' } },
  pages: { p1: { name: 'Page 1', order: 'a0', fills: [{ type: 'solid', color: '#FFFFFFFF' }] } },
  nodes: {
    box: graphic('Box', 'a0', 80, 80, { kind: 'rect', cornerRadius: 16 }),
    hex: graphic('Hex', 'a1', 640, 80, { kind: 'polygon', sides: 6 }),
    star: graphic('Star', 'a2', 80, 640, { kind: 'star', points: 5, innerRadius: 0.4 }),
    rule: graphic('Rule', 'a3', 640, 760, { kind: 'line', start: 'none', end: 'none' }),
  },
  overrides: {},
} as unknown as DesignInput)

const shapeOf = async (page: Page, id: string) =>
  (await page.evaluate((id) => window.dazbee?.design().nodes[id]?.props, id) as { shape: Record<string, unknown> }).shape
const select = async (page: Page, ids: string[]) => {
  await page.evaluate((ids) => window.dazbee?.select(ids), ids)
  await expect(page.getByTestId('layout-card')).toBeVisible()
}
const enter = async (field: Locator, value: string) => {
  await field.fill(value)
  await field.press('Enter')
}

test('the Shape card sets corners, sides, points and line ends', async ({ browser }) => {
  const { page, errors } = await openStage(browser, design())
  const card = page.getByTestId('shape-card')

  await select(page, ['box'])
  await expect(card.getByRole('heading')).toHaveText('Rectangle')
  await card.getByRole('slider', { name: 'Corners' }).fill('40')
  await expect.poll(() => shapeOf(page, 'box')).toEqual({ kind: 'rect', cornerRadius: 40 })
  // Each corner its own: all four start at the one radius, then one changes alone.
  await card.getByRole('checkbox', { name: 'Each corner its own radius' }).check()
  await expect.poll(() => shapeOf(page, 'box')).toMatchObject({ corners: [40, 40, 40, 40] })
  await enter(card.getByRole('textbox', { name: 'Bottom right radius' }), '120')
  await expect.poll(() => shapeOf(page, 'box')).toMatchObject({ corners: [40, 40, 120, 40] })
  await page.evaluate(() => window.dazbee?.drawn())
  writeOutput('shape-card-rect.png', await page.screenshot())
  // Back to one radius: the corners go and the first corner's radius stays.
  await card.getByRole('checkbox', { name: 'Each corner its own radius' }).uncheck()
  await expect.poll(() => shapeOf(page, 'box')).toEqual({ kind: 'rect', cornerRadius: 40 })

  await select(page, ['hex'])
  await expect(card.getByRole('heading')).toHaveText('Polygon')
  // Sides are whole and at least three: Home takes the slider to its start.
  await card.getByRole('slider', { name: 'Sides' }).fill('8')
  await expect.poll(async () => (await shapeOf(page, 'hex')).sides).toBe(8)
  await card.getByRole('slider', { name: 'Sides' }).press('Home')
  await expect.poll(async () => (await shapeOf(page, 'hex')).sides).toBe(3)

  await select(page, ['star'])
  await card.getByRole('slider', { name: 'Points' }).fill('8')
  await card.getByRole('slider', { name: 'Inner' }).fill('0.6')
  await card.getByRole('slider', { name: 'Points' }).press('ArrowRight')
  await expect.poll(() => shapeOf(page, 'star')).toMatchObject({ points: 9, innerRadius: 0.6 })

  await select(page, ['rule'])
  await card.getByRole('combobox', { name: 'Line end' }).selectOption('arrow')
  await card.getByRole('combobox', { name: 'Line start' }).selectOption('circle')
  await expect.poll(() => shapeOf(page, 'rule')).toEqual({ kind: 'line', start: 'circle', end: 'arrow' })
  await page.evaluate(() => window.dazbee?.drawn())
  writeOutput('shape-card-line.png', await page.screenshot())

  // Two kinds of shape at once have no Shape card; two stars share one.
  await select(page, ['box', 'star'])
  await expect(card).toHaveCount(0)
  expect(errors).toEqual([])
})
