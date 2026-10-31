// The pen and path editing (#45), with real pointer and keyboard input: draw a closed curved path
// with clicks and drags, go into its points, drag one, and undo the drag in one step; then an open
// path with Shift, a point added on a segment, a handle dragged, and a point deleted.
import { parsePath, pathBounds, type Anchor, type PenPath } from '@razzlr/editor/path'
import { expect, test, type Page } from '../support/test.ts'
import { exportHashOf, writeOutput } from '../support/editor.ts'
import { liveDesign } from '../support/seed.ts'
import { click, drag, dragScreen, openStage, press, read, selection, type Design } from '../support/stage.ts'

test.describe.configure({ timeout: 120_000 })

type Placed = { x: number; y: number; width: number; height: number; shape: { kind: string; d: string } }
const placed = (d: Design, id: string) => ({ ...d.nodes[id]?.props, ...d.overrides['format:sq']?.[id] }) as Placed
/** A layer's path in page coordinates. */
const pathOf = (d: Design, id: string): PenPath => {
  const p = placed(d, id)
  return parsePath(p.shape.d).map((c) => ({
    closed: c.closed,
    anchors: c.anchors.map((a) => ({
      x: a.x + p.x, y: a.y + p.y,
      ...(a.in && { in: { x: a.in.x + p.x, y: a.in.y + p.y } }),
      ...(a.out && { out: { x: a.out.x + p.x, y: a.out.y + p.y } }),
    })),
  }))
}
const anchorsOf = (d: Design, id: string) => pathOf(d, id)[0]?.anchors ?? []
const expectAt = (a: Anchor | { x: number; y: number } | undefined, x: number, y: number) => {
  expect(a?.x).toBeCloseTo(x, 1)
  expect(a?.y).toBeCloseTo(y, 1)
}
/** The middle of an overlay dot on screen: an anchor `0:1`, or a handle `0:1:out`. */
async function dotAt(page: Page, kind: 'anchor' | 'control', key: string) {
  const box = await page.locator(`.path-${kind}[data-${kind}="${key}"]`).boundingBox()
  if (!box) throw new Error(`no ${kind} ${key}`)
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
}
const toolOf = (page: Page) => page.evaluate(() => window.razzlr?.tool())
const undo = async (page: Page) => {
  await press(page, 'undo')
  await page.evaluate(() => window.razzlr?.drawn())
}

test('the pen draws a closed curved path, a point of it is dragged, and undo takes the drag back in one step', async ({ browser }) => {
  const { page, errors } = await openStage(browser, liveDesign())
  const blank = await exportHashOf(page)
  const before = new Set(Object.keys((await read(page)).nodes))

  // P, then: a click for a corner, two drags for smooth points, and a click on the first point to close.
  await press(page, 'toolPen')
  await expect(page.locator('[role="toolbar"] [data-tool="pen"]')).toHaveAttribute('aria-pressed', 'true')
  await click(page, 150, 850)
  await drag(page, { x: 400, y: 850 }, { x: 460, y: 850 })
  const hover = await page.evaluate(() => window.razzlr?.screenPoint(380, 980)) as { x: number; y: number }
  await page.mouse.move(hover.x, hover.y, { steps: 4 })
  writeOutput('paths-0-drawing.png', await page.screenshot({ animations: 'disabled' }))
  await drag(page, { x: 380, y: 1000 }, { x: 330, y: 1000 })
  await expect(page.locator('.path-anchor')).toHaveCount(3)
  await click(page, 150, 850)

  // One layer, a closed path through the three points with the handles the drags pulled out.
  let d = await read(page)
  const [id = ''] = Object.keys(d.nodes).filter((n) => !before.has(n))
  expect(d.nodes[id]).toMatchObject({ type: 'graphic', parentId: 'p1', name: 'Path', props: { shape: { kind: 'path' }, strokes: [{ width: 2 }] } })
  const drawn = pathOf(d, id)
  expect(drawn).toHaveLength(1)
  expect(drawn[0]?.closed).toBe(true)
  const [a, b, c] = drawn[0]?.anchors ?? []
  expectAt(a, 150, 850)
  expect(a?.in ?? a?.out).toBeUndefined()
  expectAt(b, 400, 850)
  expectAt(b?.out, 460, 850)
  expectAt(b?.in, 340, 850)
  expectAt(c, 380, 1000)
  expectAt(c?.out, 330, 1000)
  expectAt(c?.in, 430, 1000)
  // Its box is the outline's, curves included.
  const bounds = pathBounds(drawn)
  expect(placed(d, id).x).toBeCloseTo(bounds?.x ?? NaN, 1)
  expect(placed(d, id).y).toBe(850)
  expect(placed(d, id).width).toBeCloseTo(bounds?.width ?? NaN, 1)
  const drawnBox = placed(d, id)
  expect(await selection(page)).toEqual([id])
  expect(await toolOf(page)).toBe('select')
  expect(await page.locator('.path-anchor').count()).toBe(0)
  const closedHash = await exportHashOf(page)
  expect(closedHash).not.toBe(blank)
  writeOutput('paths-1-closed.png', await page.screenshot({ animations: 'disabled' }))

  // Enter goes into its points; dragging the second one carries its handles along.
  await press(page, 'editPoints')
  await expect(page.locator('.path-anchor')).toHaveCount(3)
  const point = await dotAt(page, 'anchor', '0:1')
  const zoom = await page.evaluate(() => window.razzlr?.camera().zoom ?? 1)
  await dragScreen(page, point, { x: point.x + 60 * zoom, y: point.y - 40 * zoom })
  await expect(page.locator('.path-anchor[data-anchor="0:1"]')).toHaveAttribute('data-selected', '')
  d = await read(page)
  const edited = anchorsOf(d, id)
  expectAt(edited[1], 460, 810)
  expectAt(edited[1]?.out, 520, 810)
  expectAt(edited[1]?.in, 400, 810)
  expectAt(edited[0], 150, 850)
  expectAt(edited[2], 380, 1000)
  expect(placed(d, id).y).toBeCloseTo(pathBounds(pathOf(d, id))?.y ?? 0, 1)
  expect(await exportHashOf(page)).not.toBe(closedHash)
  writeOutput('paths-2-edited.png', await page.screenshot({ animations: 'disabled' }))

  // One undo puts the path back exactly as drawn; one more takes the whole drawing away.
  await undo(page)
  expect(placed(await read(page), id)).toEqual(drawnBox)
  expect(pathOf(await read(page), id)).toEqual(drawn)
  expect(await exportHashOf(page)).toBe(closedHash)
  await undo(page)
  expect((await read(page)).nodes[id]).toBeUndefined()
  expect(await exportHashOf(page)).toBe(blank)
  expect(errors).toEqual([])
})

test('Shift keeps the pen to 45°, a click on a segment adds a point, a handle drags, and Delete takes a point out', async ({ browser }) => {
  const { page, errors } = await openStage(browser, liveDesign())
  const before = new Set(Object.keys((await read(page)).nodes))
  await press(page, 'toolPen')
  await click(page, 100, 900)
  // 20 below the level of the first point, with Shift held: the segment stays level.
  await click(page, 400, 920, ['Shift'])
  // Enter ends the path open.
  await press(page, 'editPoints')
  let d = await read(page)
  const [id = ''] = Object.keys(d.nodes).filter((n) => !before.has(n))
  const line = pathOf(d, id)[0]
  expect(line?.closed).toBe(false)
  expectAt(line?.anchors[1], 100 + Math.hypot(300, 20), 900)
  expect(await toolOf(page)).toBe('select')

  // Double-click goes into its points. A press on the segment adds a point and drags it down.
  const middle = await page.evaluate(() => window.razzlr?.screenPoint(250, 900)) as { x: number; y: number }
  await page.mouse.dblclick(middle.x, middle.y)
  await page.evaluate(() => window.razzlr?.drawn())
  await expect(page.locator('.path-anchor')).toHaveCount(2)
  const zoom = await page.evaluate(() => window.razzlr?.camera().zoom ?? 1)
  await dragScreen(page, middle, { x: middle.x, y: middle.y + 100 * zoom })
  d = await read(page)
  const bent = anchorsOf(d, id)
  expect(bent).toHaveLength(3)
  expectAt(bent[1], 250, 1000)
  await expect(page.locator('.path-anchor[data-anchor="0:1"]')).toHaveAttribute('data-selected', '')

  // A point added on a straight segment is a corner: it has no handles to show.
  expect(await page.locator('.path-control').count()).toBe(0)
  writeOutput('paths-3-open.png', await page.screenshot({ animations: 'disabled' }))

  // Adding the point and dragging it were one undo step.
  await undo(page)
  expect(anchorsOf(await read(page), id)).toHaveLength(2)
  await press(page, 'redo')
  expect(anchorsOf(await read(page), id)).toHaveLength(3)

  // Delete takes the selected point out, one undo step.
  await press(page, 'delete')
  d = await read(page)
  expect(anchorsOf(d, id)).toHaveLength(2)
  expect(placed(d, id).height).toBeCloseTo(0, 1)
  await undo(page)
  expect(anchorsOf(await read(page), id)).toHaveLength(3)

  // Escape leaves the points; the path stays selected.
  await page.keyboard.press('Escape')
  await page.evaluate(() => window.razzlr?.drawn())
  await expect(page.locator('.path-anchor')).toHaveCount(0)
  expect(await selection(page)).toEqual([id])
  expect(errors).toEqual([])
})

test('a smooth point\'s handles turn together, and Alt lets one go alone', async ({ browser }) => {
  const { page, errors } = await openStage(browser, liveDesign())
  const before = new Set(Object.keys((await read(page)).nodes))
  await press(page, 'toolPen')
  await click(page, 100, 900)
  await drag(page, { x: 300, y: 900 }, { x: 360, y: 900 })
  await click(page, 500, 900)
  await press(page, 'editPoints')
  const [id = ''] = Object.keys((await read(page)).nodes).filter((n) => !before.has(n))
  await press(page, 'editPoints')
  // Select the smooth point to show its handles, then drag its out handle down.
  const point = await dotAt(page, 'anchor', '0:1')
  await page.mouse.click(point.x, point.y)
  await page.evaluate(() => window.razzlr?.drawn())
  await expect(page.locator('.path-control')).toHaveCount(2)
  const zoom = await page.evaluate(() => window.razzlr?.camera().zoom ?? 1)
  const out = await dotAt(page, 'control', '0:1:out')
  await dragScreen(page, out, { x: out.x, y: out.y + 60 * zoom })
  let smooth = anchorsOf(await read(page), id)[1]
  expectAt(smooth?.out, 360, 960)
  // The in handle turned to stay opposite, keeping its 60.
  expectAt(smooth?.in, 300 - 60 / Math.SQRT2, 900 - 60 / Math.SQRT2)
  writeOutput('paths-4-handles.png', await page.screenshot({ animations: 'disabled' }))
  // With Alt, the out handle moves alone.
  const out2 = await dotAt(page, 'control', '0:1:out')
  await dragScreen(page, out2, { x: out2.x + 40 * zoom, y: out2.y }, ['Alt'])
  smooth = anchorsOf(await read(page), id)[1]
  expectAt(smooth?.out, 400, 960)
  expectAt(smooth?.in, 300 - 60 / Math.SQRT2, 900 - 60 / Math.SQRT2)
  expect(errors).toEqual([])
})
