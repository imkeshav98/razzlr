// Preset shapes and live booleans (#44), with real pointer and keyboard input: draw every shape from
// the dock, its menu and its keys, Shift-draw a square, combine two shapes from the inspector and by
// shortcut, then enter the boolean, drag one shape inside it and see the boolean follow.
import type { DesignInput } from '@dazbee/schema'
import { expect, test, type Page } from '../support/test.ts'
import { exportHashOf, screenPoint, writeOutput } from '../support/editor.ts'
import { liveDesign } from '../support/seed.ts'
import { click, drag, openStage, press, read, selection, type Design } from '../support/stage.ts'

test.describe.configure({ timeout: 120_000 })

const design = (): DesignInput => {
  const base = liveDesign()
  return { ...base, meta: { ...base.meta, name: 'Shapes' } }
}

type Placed = { x: number; y: number; width: number; height: number; rotation: number }
const box = (d: Design, id: string): Placed => {
  const p = { ...d.nodes[id]?.props, ...d.overrides['format:sq']?.[id] } as Partial<Placed>
  return { x: p.x ?? 0, y: p.y ?? 0, width: p.width ?? 0, height: p.height ?? 0, rotation: p.rotation ?? 0 }
}
const kids = (d: Design, id: string) => Object.entries(d.nodes).filter(([, n]) => n.parentId === id)
  .sort(([, a], [, b]) => (a.index < b.index ? -1 : 1)).map(([child]) => child)
const toolOf = (page: Page) => page.evaluate(() => window.dazbee?.tool())
const pressed = (page: Page, tool: string) => expect(page.locator(`[role="toolbar"] [data-tool="${tool}"]`)).toHaveAttribute('aria-pressed', 'true')

/** Draws with a real drag and returns the one layer it made, which is selected, with the tool back at select. */
async function draw(page: Page, from: { x: number; y: number }, to: { x: number; y: number }, modifiers: 'Shift'[] = []) {
  const before = new Set(Object.keys((await read(page)).nodes))
  await drag(page, from, to, modifiers)
  const d = await read(page)
  const made = Object.keys(d.nodes).filter((id) => !before.has(id))
  expect(made).toHaveLength(1)
  const id = made[0] as string
  expect(await selection(page)).toEqual([id])
  expect(await toolOf(page)).toBe('select')
  await pressed(page, 'select')
  return { id, node: d.nodes[id] as Design['nodes'][string] & { name: string }, box: box(d, id) }
}

const pick = async (page: Page, shape: string) => {
  await page.getByTestId('shape-menu').click()
  await page.locator(`[role="menu"] [data-shape="${shape}"]`).click()
}

test('every shape draws with real input: the dock, its menu, its keys, and Shift for a square', async ({ browser }) => {
  const { page, errors } = await openStage(browser, design())

  // The dock's shape button draws a rectangle by default.
  await page.locator('[role="toolbar"] [data-tool="shape"]').click()
  await pressed(page, 'shape')
  expect(await toolOf(page)).toBe('rect')
  const rect = await draw(page, { x: 100, y: 820 }, { x: 220, y: 900 })
  expect(rect.node).toMatchObject({ type: 'graphic', parentId: 'p1', name: 'Rectangle', props: { shape: { kind: 'rect' } } })
  expect(rect.box).toEqual({ x: 100, y: 820, width: 120, height: 80, rotation: 0 })

  // R, then a drag with Shift held part way: a square as wide as the longer side.
  await press(page, 'toolRect')
  const square = await draw(page, { x: 260, y: 820 }, { x: 350, y: 880 }, ['Shift'])
  expect(square.box).toEqual({ x: 260, y: 820, width: 90, height: 90, rotation: 0 })

  // O draws an ellipse, dragged up and to the left.
  await press(page, 'toolEllipse')
  const ellipse = await draw(page, { x: 500, y: 960 }, { x: 390, y: 820 })
  expect(ellipse.node.props).toMatchObject({ shape: { kind: 'ellipse' } })
  expect(ellipse.box).toEqual({ x: 390, y: 820, width: 110, height: 140, rotation: 0 })

  // The menu picks a polygon by pointer, and a star by keyboard; the dock then shows the star.
  await pick(page, 'polygon')
  const polygon = await draw(page, { x: 540, y: 820 }, { x: 660, y: 940 })
  expect(polygon.node.props).toMatchObject({ shape: { kind: 'polygon', sides: 5 } })
  await page.getByTestId('shape-menu').click()
  await expect(page.locator('[role="menu"] [data-shape="polygon"]')).toBeFocused()
  await page.keyboard.press('ArrowDown')
  await expect(page.locator('[role="menu"] [data-shape="star"]')).toBeFocused()
  writeOutput('shapes-0-menu.png', await page.screenshot({ animations: 'disabled' }))
  await page.keyboard.press('Enter')
  await expect(page.getByRole('menu')).toBeHidden()
  await expect(page.locator('[role="toolbar"] [data-tool="shape"]')).toHaveAttribute('data-shape', 'star')
  const star = await draw(page, { x: 700, y: 820 }, { x: 820, y: 940 })
  expect(star.node.props).toMatchObject({ shape: { kind: 'star', points: 5, innerRadius: 0.382 } })

  // L draws a line; Shift+L an arrow, turned in 45° steps with Shift.
  await press(page, 'toolLine')
  const line = await draw(page, { x: 860, y: 820 }, { x: 1000, y: 820 })
  expect(line.node.props).toMatchObject({ shape: { kind: 'line', start: 'none', end: 'none' } })
  expect(line.box).toEqual({ x: 860, y: 820, width: 140, height: 0, rotation: 0 })
  await press(page, 'toolArrow')
  const arrow = await draw(page, { x: 860, y: 880 }, { x: 1000, y: 1000 }, ['Shift'])
  expect(arrow.node.props).toMatchObject({ shape: { kind: 'line', end: 'arrow' } })
  expect(arrow.box.rotation).toBe(45)

  // A click without a drag draws the usual size, centred where it landed.
  await press(page, 'toolRect')
  const before = new Set(Object.keys((await read(page)).nodes))
  await click(page, 160, 1000)
  const clicked = Object.keys((await read(page)).nodes).find((id) => !before.has(id)) as string
  expect(await selection(page)).toEqual([clicked])
  expect(await toolOf(page)).toBe('select')
  await pressed(page, 'select')
  expect(box(await read(page), clicked)).toEqual({ x: 110, y: 950, width: 100, height: 100, rotation: 0 })

  // The stage shows them all, the export draws them, and each drawing is one undo step.
  await page.keyboard.press('Escape')
  await page.evaluate(() => window.dazbee?.drawn())
  await pressed(page, 'select')
  writeOutput('shapes-1-drawn.png', await page.screenshot({ animations: 'disabled' }))
  const all = await exportHashOf(page)
  await page.evaluate(() => window.dazbee?.session.undo())
  expect((await read(page)).nodes[clicked]).toBeUndefined()
  expect(await exportHashOf(page)).not.toBe(all)
  expect(errors).toEqual([])
})

test('two shapes combine into a live boolean that follows a shape dragged inside it', async ({ browser }) => {
  const { page, errors } = await openStage(browser, design())
  await press(page, 'toolRect')
  const back = await draw(page, { x: 100, y: 820 }, { x: 260, y: 980 })
  await press(page, 'toolEllipse')
  const front = await draw(page, { x: 200, y: 860 }, { x: 320, y: 980 })
  const shapes = await exportHashOf(page)

  // Select both and combine from the inspector: the boolean takes the bottom shape's paint.
  await click(page, 120, 840)
  await click(page, 300, 960, ['Shift'])
  await page.locator('[data-action="booleanSubtract"]').click()
  await page.evaluate(() => window.dazbee?.drawn())
  let d = await read(page)
  const [cut = ''] = await selection(page)
  expect(d.nodes[cut]).toMatchObject({ type: 'boolean', parentId: 'p1', props: { op: 'subtract', fills: back.node.props.fills } })
  expect(kids(d, cut)).toEqual([back.id, front.id])
  expect(box(d, cut)).toEqual({ x: 100, y: 820, width: 220, height: 160, rotation: 0 })
  const subtracted = await exportHashOf(page)
  expect(subtracted).not.toBe(shapes)
  writeOutput('shapes-2-subtract.png', await page.screenshot({ animations: 'disabled' }))

  // Undo takes it back in one step; the shortcut makes a union instead.
  await page.evaluate(() => window.dazbee?.session.undo())
  expect((await read(page)).nodes[cut]).toBeUndefined()
  expect(await exportHashOf(page)).toBe(shapes)
  await click(page, 120, 840)
  await click(page, 300, 960, ['Shift'])
  await press(page, 'booleanUnion')
  const [union = ''] = await selection(page)
  expect((await read(page)).nodes[union]).toMatchObject({ type: 'boolean', props: { op: 'union' } })
  const united = await exportHashOf(page)
  expect(united).not.toBe(shapes)
  expect(united).not.toBe(subtracted)

  // Double-click enters the boolean on the ellipse; dragging it out to the right refits the boolean.
  const at = await screenPoint(page, 290, 950)
  await page.mouse.dblclick(at.x, at.y)
  await page.evaluate(() => window.dazbee?.drawn())
  expect(await selection(page)).toEqual([front.id])
  await page.keyboard.down('Control') // no snapping, so the drag measures exactly
  await drag(page, { x: 290, y: 950 }, { x: 390, y: 950 })
  await page.keyboard.up('Control')
  d = await read(page)
  expect(box(d, front.id)).toMatchObject({ x: 300, y: 860 })
  expect(d.nodes[front.id]?.parentId).toBe(union)
  expect(box(d, union)).toEqual({ x: 100, y: 820, width: 320, height: 160, rotation: 0 })
  expect(await exportHashOf(page)).not.toBe(united)
  writeOutput('shapes-3-edited.png', await page.screenshot({ animations: 'disabled' }))

  // A text does not combine: with the boolean and the headline selected, Union leaves both alone.
  await page.keyboard.press('Escape')
  await page.keyboard.press('Escape')
  await click(page, 160, 900)
  await click(page, 500, 540, ['Shift'])
  expect(await selection(page)).toEqual([union, 'headline'])
  const unchanged = await read(page)
  await page.locator('[data-action="booleanUnion"]').click()
  expect(await read(page)).toEqual(unchanged)
  expect(errors).toEqual([])
})
