// Selection and transforms (#40), with real pointer and keyboard input: click, shift-click and
// marquee; move, resize and rotate with handles (shift and alt too), on a turned layer as well;
// arrow nudges, duplicate, z-order, delete, lock and hide from the shortcut table. Every drag,
// resize and rotate undoes in one step.
import { pressFor, type ShortcutAction } from '@razzlr/editor/shortcuts'
import type { DesignInput } from '@razzlr/schema'
import { expect, test, type Page } from '@playwright/test'
import { designOf, openTabs, placed, screenPoint, writeOutput } from '../support/editor.ts'
import { liveDesign, seed } from '../support/seed.ts'

// Each check opens the editor (up to 30 s for the renderer on a slow runner) and then drags for a while.
test.describe.configure({ timeout: 120_000 })

const rect = (x: number, y: number, width: number, height: number, color: string, more: { rotation?: number; visible?: boolean } = {}) =>
  ({ x, y, width, height, shape: { kind: 'rect' as const, cornerRadius: 12 }, fills: [{ type: 'solid' as const, color }], ...more })

/** The live design plus a turned layer, a group of two, a locked layer and a hidden one. */
const design = (): DesignInput => {
  const base = liveDesign()
  return {
    ...base,
    meta: { ...base.meta, name: 'Selection' },
    nodes: {
      ...base.nodes,
      tilt: { type: 'graphic', parentId: 'p1', index: 'a4', name: 'Tilt', props: rect(560, 820, 300, 120, '#8E44FFFF', { rotation: 30 }) },
      g: { type: 'group', parentId: 'p1', index: 'a5', name: 'Group', props: { x: 120, y: 860, width: 200, height: 160 } },
      g1: { type: 'graphic', parentId: 'g', index: 'a0', name: 'G1', props: rect(120, 860, 90, 160, '#00A889FF') },
      g2: { type: 'graphic', parentId: 'g', index: 'a1', name: 'G2', props: rect(230, 860, 90, 160, '#FFB020FF') },
      locked: {
        type: 'graphic', parentId: 'p1', index: 'a6', name: 'Locked', props: rect(900, 900, 140, 140, '#444444FF'),
        lock: { move: true, resize: true, content: true, style: true, delete: true },
      },
      ghost: { type: 'graphic', parentId: 'p1', index: 'a7', name: 'Ghost', props: rect(420, 360, 120, 80, '#FF00FFFF', { visible: false }) },
    },
  }
}

interface Design {
  nodes: Record<string, { parentId: string; index: string; lock?: Record<string, boolean>; props: Record<string, unknown> }>
  overrides: Record<string, Record<string, Record<string, unknown>>>
}
const read = async (page: Page) => JSON.parse(await designOf(page)) as Design
const props = async (page: Page, id: string) => placed(await read(page), id, 'sq') as { x: number; y: number; width: number; height: number; rotation?: number; visible?: boolean }
const selection = (page: Page) => page.evaluate(() => window.razzlr?.selection() ?? [])
/** Presses an action's shortcut and waits for the redraw, so the handles stand where the box now is. */
const press = async (page: Page, action: ShortcutAction) => {
  await page.keyboard.press(pressFor(action))
  await page.evaluate(() => window.razzlr?.drawn())
}
const order = async (page: Page) => Object.entries((await read(page)).nodes)
  .filter(([, n]) => n.parentId === 'p1').sort(([a, x], [b, y]) => (x.index < y.index ? -1 : x.index > y.index ? 1 : a < b ? -1 : 1)).map(([id]) => id)

async function open(browser: Parameters<typeof openTabs>[0]) {
  const { tabs, errors } = await openTabs(browser, 1, await seed(design()))
  const page = tabs[0] as Page
  await page.setViewportSize({ width: 1440, height: 1000 })
  // Design pixels in steps of 5 land on whole screen pixels, so drags measure exactly.
  await page.evaluate(() => window.razzlr?.setCamera({ x: 100, y: 60, zoom: 0.8 }))
  await page.evaluate(() => window.razzlr?.drawn())
  return { page, errors }
}

/**
 * Drags with the mouse between two design pixels of the square, in a few steps like a hand would.
 * Modifier keys go down once the drag has started, as a designer presses Shift mid-drag; with
 * `before` they are held from the press, as for a Shift marquee that adds to the selection.
 */
async function drag(page: Page, from: { x: number; y: number }, to: { x: number; y: number }, modifiers: ('Shift' | 'Alt')[] = [], before = false) {
  const a = await screenPoint(page, from.x, from.y)
  const b = await screenPoint(page, to.x, to.y)
  await dragScreen(page, a, b, modifiers, before)
}
async function dragScreen(page: Page, a: { x: number; y: number }, b: { x: number; y: number }, modifiers: ('Shift' | 'Alt')[] = [], before = false) {
  await page.mouse.move(a.x, a.y)
  if (before) for (const key of modifiers) await page.keyboard.down(key)
  await page.mouse.down()
  await page.mouse.move((a.x + b.x) / 2, (a.y + b.y) / 2)
  if (!before) for (const key of modifiers) await page.keyboard.down(key)
  await page.mouse.move(b.x, b.y, { steps: 6 })
  await page.mouse.up()
  for (const key of modifiers) await page.keyboard.up(key)
  await page.evaluate(() => window.razzlr?.drawn())
}
async function click(page: Page, x: number, y: number, modifiers: 'Shift'[] = []) {
  const at = await screenPoint(page, x, y)
  for (const key of modifiers) await page.keyboard.down(key)
  await page.mouse.click(at.x, at.y)
  for (const key of modifiers) await page.keyboard.up(key)
  await page.evaluate(() => window.razzlr?.drawn())
}
/** Where a handle of the selection box is on screen now. */
async function handle(page: Page, which: string) {
  const box = await page.locator(`.selection .handle[data-handle="${which}"]`).boundingBox()
  if (!box) throw new Error(`no ${which} handle`)
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
}
const zoomOf = (page: Page) => page.evaluate(() => window.razzlr?.camera().zoom ?? 1)

test('click, shift-click and marquee select; locked and hidden layers are not picked', async ({ browser }) => {
  test.setTimeout(90_000)
  const { page, errors } = await open(browser)

  await click(page, 230, 180)
  expect(await selection(page)).toEqual(['box'])
  await expect(page.locator('.selection[data-layer="box"] .handle')).toHaveCount(8)
  await expect(page.locator('.selection-size')).toHaveText('300 × 200')
  writeOutput('selection-0-single.png', await page.screenshot())

  await click(page, 820, 240, ['Shift'])
  expect(await selection(page)).toEqual(['box', 'dot'])
  await expect(page.locator('.selection[data-count="2"] .handle')).toHaveCount(8)
  await expect(page.locator('.selection-member')).toHaveCount(2)
  await click(page, 820, 240, ['Shift'])
  expect(await selection(page)).toEqual(['box'])
  await press(page, 'deselect')
  expect(await selection(page)).toEqual([])

  // A marquee from empty canvas picks every top-level layer it touches: the box, the dot and the group.
  await drag(page, { x: 20, y: 30 }, { x: 760, y: 700 })
  expect((await selection(page)).sort()).toEqual(['arabic', 'box', 'dot', 'headline'])
  writeOutput('selection-1-marquee.png', await page.screenshot())
  await drag(page, { x: 20, y: 30 }, { x: 400, y: 300 })
  expect(await selection(page)).toEqual(['box'])
  // Shift adds what a second marquee touches.
  await drag(page, { x: 1060, y: 100 }, { x: 900, y: 200 }, ['Shift'], true)
  expect(await selection(page)).toEqual(['box', 'dot'])
  await expect(page.locator('.selection-member')).toHaveCount(2)
  writeOutput('selection-2-multiple.png', await page.screenshot())

  // Select all takes every layer that can be picked: not the locked one, nor the hidden one.
  await press(page, 'selectAll')
  expect((await selection(page)).sort()).toEqual(['arabic', 'box', 'dot', 'g', 'headline', 'tilt'])

  // A locked layer can't be picked or dragged: the press starts a marquee instead.
  await press(page, 'deselect')
  await drag(page, { x: 970, y: 970 }, { x: 1000, y: 1000 })
  expect(await selection(page)).toEqual([])
  expect(await props(page, 'locked')).toMatchObject({ x: 900, y: 900 })
  // A hidden layer draws nothing and can't be hit.
  await click(page, 480, 400)
  expect(await selection(page)).toEqual([])
  expect(errors).toEqual([])
})

test('move, resize and rotate with handles, each one undo step, on a turned layer too', async ({ browser }) => {
  test.setTimeout(120_000)
  const { page, errors } = await open(browser)
  const zoom = await zoomOf(page)

  // Move, then undo the whole drag at once.
  await drag(page, { x: 230, y: 180 }, { x: 330, y: 230 })
  expect(await props(page, 'box')).toMatchObject({ x: 180, y: 130 })
  await press(page, 'undo')
  expect(await props(page, 'box')).toMatchObject({ x: 80, y: 80 })
  // Shift keeps it to one axis.
  await drag(page, { x: 230, y: 180 }, { x: 330, y: 200 }, ['Shift'])
  expect(await props(page, 'box')).toMatchObject({ x: 180, y: 80 })

  // Resize from a corner, then undo it in one step.
  let se = await handle(page, 'se')
  await dragScreen(page, se, { x: se.x + 100 * zoom, y: se.y + 50 * zoom })
  expect(await props(page, 'box')).toMatchObject({ x: 180, y: 80, width: 400, height: 250 })
  writeOutput('selection-3-resized.png', await page.screenshot())
  await press(page, 'undo')
  expect(await props(page, 'box')).toMatchObject({ width: 300, height: 200 })
  // Shift keeps the proportions; alt grows about the centre.
  se = await handle(page, 'se')
  await dragScreen(page, se, { x: se.x + 150 * zoom, y: se.y + 10 * zoom }, ['Shift'])
  expect(await props(page, 'box')).toMatchObject({ x: 180, y: 80, width: 450, height: 300 })
  const e = await handle(page, 'e')
  await dragScreen(page, e, { x: e.x + 50 * zoom, y: e.y }, ['Alt'])
  expect(await props(page, 'box')).toMatchObject({ x: 130, y: 80, width: 550, height: 300 })

  // Rotate from just outside a corner; shift snaps to 15°. A quarter turn about the centre.
  const box = await props(page, 'box')
  const centre = await screenPoint(page, box.x + box.width / 2, box.y + box.height / 2)
  const ne = await handle(page, 'ne')
  const grab = { x: ne.x + 10, y: ne.y - 10 }
  const turned = { x: centre.x - (grab.y - centre.y), y: centre.y + (grab.x - centre.x) }
  await dragScreen(page, grab, { x: turned.x + 3, y: turned.y - 2 }, ['Shift'])
  expect((await props(page, 'box')).rotation).toBe(90)
  writeOutput('selection-4-rotated.png', await page.screenshot())
  await press(page, 'undo')
  expect((await props(page, 'box')).rotation ?? 0).toBe(0)

  // The turned layer: its east handle stretches it along its own 30° side, and its west edge stays put.
  await click(page, 710, 880)
  expect(await selection(page)).toEqual(['tilt'])
  const tilt = await props(page, 'tilt')
  const west = (b: typeof tilt) => {
    const a = ((b.rotation ?? 0) * Math.PI) / 180
    const cx = b.x + b.width / 2
    const cy = b.y + b.height / 2
    return { x: cx - (b.width / 2) * Math.cos(a), y: cy - (b.width / 2) * Math.sin(a) }
  }
  const east = await handle(page, 'e')
  const a30 = Math.PI / 6
  await dragScreen(page, east, { x: east.x + 100 * zoom * Math.cos(a30), y: east.y + 100 * zoom * Math.sin(a30) })
  const stretched = await props(page, 'tilt')
  expect(stretched.rotation).toBe(30)
  expect(stretched.width).toBeCloseTo(400, 0)
  expect(stretched.height).toBeCloseTo(120, 5)
  expect(west(stretched).x).toBeCloseTo(west(tilt).x, 0)
  expect(west(stretched).y).toBeCloseTo(west(tilt).y, 0)
  writeOutput('selection-5-turned-resized.png', await page.screenshot())
  // Moving it keeps its angle; turning it with shift lands on a 15° step.
  await drag(page, { x: 710, y: 880 }, { x: 690, y: 860 })
  expect(await props(page, 'tilt')).toMatchObject({ rotation: 30 })
  const sw = await handle(page, 'sw')
  const t = await props(page, 'tilt')
  const tc = await screenPoint(page, t.x + t.width / 2, t.y + t.height / 2)
  const out = { x: tc.x + (sw.x - tc.x) * 1.1, y: tc.y + (sw.y - tc.y) * 1.1 }
  await dragScreen(page, out, { x: tc.x + (out.y - tc.y) * -1, y: tc.y + (out.x - tc.x) }, ['Shift'])
  const spun = (await props(page, 'tilt')).rotation ?? 0
  expect(Math.abs(spun % 15)).toBe(0)
  expect(spun).not.toBe(30)
  await press(page, 'undo')
  expect((await props(page, 'tilt')).rotation).toBe(30)

  // Several layers: a marquee around the group takes it whole, and its layers move with it.
  await press(page, 'deselect')
  await drag(page, { x: 100, y: 1060 }, { x: 140, y: 1000 })
  expect(await selection(page)).toEqual(['g'])
  await drag(page, { x: 160, y: 940 }, { x: 200, y: 900 })
  expect(await props(page, 'g')).toMatchObject({ x: 160, y: 820 })
  expect(await props(page, 'g1')).toMatchObject({ x: 160, y: 820 })
  expect(await props(page, 'g2')).toMatchObject({ x: 270, y: 820 })
  // Resizing the group scales what is inside it.
  const gse = await handle(page, 'se')
  await dragScreen(page, gse, { x: gse.x + 200 * zoom, y: gse.y })
  expect(await props(page, 'g')).toMatchObject({ width: 400 })
  expect(await props(page, 'g2')).toMatchObject({ x: 380, width: 180 })
  await press(page, 'undo')
  expect(await props(page, 'g2')).toMatchObject({ x: 270, width: 90 })
  expect(errors).toEqual([])
})

test('nudge, duplicate, z-order, lock, hide and delete from the keyboard', async ({ browser }) => {
  test.setTimeout(90_000)
  const { page, errors } = await open(browser)
  await click(page, 230, 180)

  await press(page, 'nudgeRight')
  await press(page, 'nudgeDownFar')
  expect(await props(page, 'box')).toMatchObject({ x: 81, y: 90 })
  await press(page, 'undo')
  expect(await props(page, 'box')).toMatchObject({ x: 81, y: 80 })

  // Duplicate: a copy right above the original, selected.
  await press(page, 'duplicate')
  const [copy = ''] = await selection(page)
  expect(copy).not.toBe('box')
  expect(await props(page, copy)).toMatchObject({ x: 81, y: 80, width: 300, height: 200 })
  expect((await order(page)).slice(0, 2)).toEqual(['box', copy])
  await press(page, 'delete')
  expect((await read(page)).nodes[copy]).toBeUndefined()

  // Z-order, one undo step each.
  await click(page, 230, 180)
  const start = await order(page)
  await press(page, 'bringToFront')
  expect((await order(page)).at(-1)).toBe('box')
  await press(page, 'sendBackward')
  expect((await order(page)).at(-2)).toBe('box')
  await press(page, 'sendToBack')
  expect((await order(page))[0]).toBe('box')
  await press(page, 'bringForward')
  expect((await order(page))[1]).toBe('box')
  for (let i = 0; i < 4; i++) await press(page, 'undo')
  expect(await order(page)).toEqual(start)

  // Hide in this format: the layer stays selected so it can be shown again, and can't be hit meanwhile.
  await click(page, 820, 240)
  await press(page, 'hide')
  expect((await read(page)).overrides['format:sq']?.dot?.visible).toBe(false)
  expect(await selection(page)).toEqual(['dot'])
  writeOutput('selection-6-hidden.png', await page.screenshot())
  await press(page, 'deselect')
  await click(page, 820, 240)
  expect(await selection(page)).toEqual([])
  await page.evaluate(() => window.razzlr?.select(['dot']))
  await press(page, 'hide')
  expect(await props(page, 'dot')).toMatchObject({ visible: true })

  // Lock: every flag on, then the layer can't be picked or deleted; the same keys unlock it.
  await click(page, 230, 180)
  await press(page, 'lock')
  expect((await read(page)).nodes.box?.lock).toEqual({ move: true, resize: true, content: true, style: true, delete: true })
  await press(page, 'delete')
  expect((await read(page)).nodes.box).toBeDefined()
  await press(page, 'deselect')
  await click(page, 230, 180)
  expect(await selection(page)).toEqual([])
  await page.evaluate(() => window.razzlr?.select(['box']))
  await press(page, 'lock')
  expect((await read(page)).nodes.box?.lock).toBeUndefined()

  // Delete, and undo brings it back.
  await click(page, 820, 240)
  await press(page, 'delete')
  expect((await read(page)).nodes.dot).toBeUndefined()
  expect(await selection(page)).toEqual([])
  await press(page, 'undo')
  expect((await read(page)).nodes.dot).toBeDefined()
  expect(errors).toEqual([])
})
