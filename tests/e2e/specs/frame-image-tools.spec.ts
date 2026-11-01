// The frame and image tools, with real pointer and keyboard input: F draws a frame, and one drawn
// around layers takes them in without moving them; Mod+Alt+G and the Arrange card frame the
// selection; Shift+A on shapes wraps them in an auto layout frame where they stand; I opens the
// image picker, and the image picked lands where the stage is clicked, one undo step.
import { expect, test, type Page } from '../support/test.ts'
import type { DesignInput } from '@dazbee/schema'
import { photo } from '../support/assets.ts'
import { writeOutput } from '../support/editor.ts'
import { click, drag, openStage, press, read, selection } from '../support/stage.ts'

test.describe.configure({ timeout: 120_000 })

type Node = DesignInput['nodes'][string]
const rect = (name: string, index: string, x: number, y: number, width: number, height: number, color: string): Node =>
  ({ type: 'graphic', parentId: 'p1', index, name, props: { x, y, width, height, shape: { kind: 'rect', cornerRadius: 12 }, fills: [{ type: 'solid', color }] } }) as Node

const design = (): DesignInput => ({
  meta: { schemaVersion: 3, designId: 'replaced-by-the-api', name: 'Frames', kind: 'single', primaryFormatId: 'sq' },
  formats: { sq: { name: 'Square', width: 1080, height: 1080, order: 'a0' }, wide: { name: 'Wide', width: 1920, height: 1080, order: 'a1' } },
  pages: { p1: { name: 'Page 1', order: 'a0', fills: [{ type: 'solid', color: '#FFF8F0FF' }] } },
  nodes: {
    a: rect('A', 'a0', 100, 100, 160, 120, '#FF2E7EFF'),
    b: { ...rect('B', 'a1', 300, 140, 120, 120, '#2F6BFFFF'), props: { ...rect('B', 'a1', 300, 140, 120, 120, '#2F6BFFFF').props, rotation: 15 } } as Node,
    c: rect('C', 'a2', 600, 100, 140, 140, '#FFB020FF'),
    d: rect('D', 'a3', 780, 160, 160, 100, '#00A88AFF'),
    // A row, tops lined up, 40 apart: auto layout reads it as it stands.
    e: rect('E', 'a4', 120, 600, 200, 160, '#9747FFFF'),
    f: rect('F', 'a5', 360, 600, 120, 100, '#1F2329FF'),
  },
  // The wide format moves A and B apart and makes A smaller: a frame drawn around them in the square holds them there too.
  overrides: { 'format:wide': { a: { x: 900, y: 500, width: 80, height: 60 }, b: { x: 1300, y: 600 } } },
})

type Box = { x: number; y: number; width: number; height: number }
const boxOf = (page: Page, id: string) => page.evaluate((id) => window.dazbee?.boxOf(id), id) as Promise<Box>
const near = (a: Box, b: Box) => {
  for (const k of ['x', 'y', 'width', 'height'] as const) expect(Math.abs(a[k] - b[k]), `${k}: ${a[k]} vs ${b[k]}`).toBeLessThanOrEqual(0.5)
}
const wideBoxOf = (page: Page, id: string) => page.evaluate((id) => window.dazbee?.boxOf(id, 'p1', 'wide'), id) as Promise<Box>
const holds = (outer: Box, inner: Box) => {
  expect(inner.x).toBeGreaterThanOrEqual(outer.x - 0.5)
  expect(inner.y).toBeGreaterThanOrEqual(outer.y - 0.5)
  expect(inner.x + inner.width).toBeLessThanOrEqual(outer.x + outer.width + 0.5)
  expect(inner.y + inner.height).toBeLessThanOrEqual(outer.y + outer.height + 0.5)
}
const childrenOf = async (page: Page, parentId: string) => Object.entries((await read(page)).nodes)
  .filter(([, n]) => n.parentId === parentId).sort(([, x], [, y]) => (x.index < y.index ? -1 : 1)).map(([id]) => id)
const undo = async (page: Page) => {
  await press(page, 'undo')
  await page.evaluate(() => window.dazbee?.drawn())
}

test('F draws a frame; a frame drawn around layers takes them in without moving them', async ({ browser }) => {
  const { page, errors } = await openStage(browser, design())
  const before = { a: await boxOf(page, 'a'), b: await boxOf(page, 'b') }

  // A frame on empty space: drawn where dragged, selected, and the select tool comes back.
  await press(page, 'toolFrame')
  await expect(page.locator('[data-tool="frame"]')).toHaveAttribute('aria-pressed', 'true')
  await drag(page, { x: 600, y: 400 }, { x: 900, y: 520 })
  const [lone] = await selection(page)
  const loneNode = (await read(page)).nodes[lone ?? '']
  expect(loneNode).toMatchObject({ parentId: 'p1', props: { x: 600, y: 400, width: 300, height: 120 } })
  expect(await page.evaluate(() => window.dazbee?.tool())).toBe('select')
  await expect(page.locator('[data-tool="select"]')).toHaveAttribute('aria-pressed', 'true')
  writeOutput('frame-1-drawn.png', await page.screenshot({ animations: 'disabled' }))
  // One undo step takes it away.
  await undo(page)
  expect((await read(page)).nodes[lone ?? '']).toBeUndefined()

  // A click draws a frame of the default size, centred on it.
  await press(page, 'toolFrame')
  await click(page, 700, 800)
  const [clicked] = await selection(page)
  expect((await read(page)).nodes[clicked ?? '']).toMatchObject({ props: { x: 600, y: 700, width: 200, height: 200 } })
  await undo(page)
  const wideBefore = { a: await wideBoxOf(page, 'a'), b: await wideBoxOf(page, 'b') }

  // Around A and the turned B: both go inside it, and neither moves on the stage.
  await press(page, 'toolFrame')
  await drag(page, { x: 80, y: 80 }, { x: 460, y: 300 })
  const [frame] = await selection(page)
  expect(await childrenOf(page, frame ?? '')).toEqual(['a', 'b'])
  near(await boxOf(page, 'a'), before.a)
  near(await boxOf(page, 'b'), before.b)
  // C, outside it, stays on the page.
  expect((await read(page)).nodes.c?.parentId).toBe('p1')
  // In the wide format, where A and B are elsewhere, they don't move either, and the frame holds them.
  near(await wideBoxOf(page, 'a'), wideBefore.a)
  holds(await wideBoxOf(page, frame ?? ''), wideBefore.a)
  holds(await wideBoxOf(page, frame ?? ''), { x: 1300, y: 600, width: 120, height: 120 })
  writeOutput('frame-2-around.png', await page.screenshot({ animations: 'disabled' }))
  await undo(page)
  expect((await read(page)).nodes.a?.parentId).toBe('p1')
  expect((await read(page)).nodes[frame ?? '']).toBeUndefined()
  expect(errors).toEqual([])
})

test('Mod+Alt+G and the Arrange card frame the selection; Shift+A wraps shapes in auto layout without moving them', async ({ browser }) => {
  const { page, errors } = await openStage(browser, design())
  const before = { c: await boxOf(page, 'c'), d: await boxOf(page, 'd'), e: await boxOf(page, 'e'), f: await boxOf(page, 'f') }

  await click(page, 660, 160)
  await click(page, 860, 210, ['Shift'])
  expect(await selection(page)).toEqual(['c', 'd'])
  await press(page, 'frameSelection')
  const [framed] = await selection(page)
  let now = await read(page)
  expect(now.nodes[framed ?? '']).toMatchObject({ props: { x: 600, y: 100, width: 340, height: 160, clip: false, fills: [] } })
  expect(await childrenOf(page, framed ?? '')).toEqual(['c', 'd'])
  near(await boxOf(page, 'c'), before.c)
  near(await boxOf(page, 'd'), before.d)
  writeOutput('frame-3-selection.png', await page.screenshot({ animations: 'disabled' }))
  await undo(page)
  expect((await read(page)).nodes.c?.parentId).toBe('p1')

  // The same from the Arrange card's button.
  await click(page, 660, 160)
  await click(page, 860, 210, ['Shift'])
  await page.locator('[data-testid="arrange"] [data-action="frameSelection"]').click()
  const [carded] = await selection(page)
  expect(await childrenOf(page, carded ?? '')).toEqual(['c', 'd'])
  await undo(page)

  // Shift+A on two shapes: an auto layout frame that hugs them, laid out as they stand.
  await click(page, 220, 680)
  await click(page, 420, 650, ['Shift'])
  await press(page, 'autoLayout')
  const [auto] = await selection(page)
  now = await read(page)
  expect(now.nodes[auto ?? '']?.props).toMatchObject({ layout: { direction: 'row', gap: 40, align: 'start' }, sizing: { width: 'hug', height: 'hug' } })
  expect(await childrenOf(page, auto ?? '')).toEqual(['e', 'f'])
  near(await boxOf(page, 'e'), before.e)
  near(await boxOf(page, 'f'), before.f)
  near(await boxOf(page, auto ?? ''), { x: 120, y: 600, width: 360, height: 160 })
  writeOutput('frame-4-auto-layout.png', await page.screenshot({ animations: 'disabled' }))
  // With a frame among the selection, Shift+A switches that frame's auto layout instead: off here, and C stays on the page.
  await click(page, 660, 160, ['Shift'])
  expect(await selection(page)).toEqual([auto, 'c'])
  await press(page, 'autoLayout')
  now = await read(page)
  expect(now.nodes[auto ?? '']?.props.layout).toBeUndefined()
  expect(now.nodes.c?.parentId).toBe('p1')
  await undo(page)
  // One undo step for the whole wrap.
  await undo(page)
  expect((await read(page)).nodes[auto ?? '']).toBeUndefined()
  expect((await read(page)).nodes.e?.parentId).toBe('p1')
  expect(errors).toEqual([])
})

test('I opens the image picker; the image uploaded there lands where the stage is clicked, one undo step', async ({ browser }) => {
  const { page, errors } = await openStage(browser, design())
  await press(page, 'toolImage')
  const picker = page.getByTestId('image-picker')
  await expect(picker).toBeVisible()
  await expect(page.locator('[data-tool="image"]')).toHaveAttribute('aria-pressed', 'true')
  writeOutput('image-1-picker.png', await page.screenshot({ animations: 'disabled' }))
  await picker.locator('input[type="file"]').setInputFiles({ name: 'sneaker.jpg', mimeType: 'image/jpeg', buffer: Buffer.from(photo) })
  // Picked: the picker goes and the stage waits for a click.
  await expect(picker).toBeHidden({ timeout: 30_000 })
  expect(await page.evaluate(() => window.dazbee?.imageArmed())).toBe(true)
  const layers = Object.keys((await read(page)).nodes).length

  await click(page, 540, 800)
  const [placed] = await selection(page)
  const node = (await read(page)).nodes[placed ?? ''] as unknown as { props: { x: number; y: number; width: number; height: number; fills: { type: string }[] } }
  expect(node.props.fills[0]?.type).toBe('image')
  // Centred on the click, at most half the format across.
  expect(Math.abs(node.props.x + node.props.width / 2 - 540)).toBeLessThanOrEqual(1)
  expect(Math.abs(node.props.y + node.props.height / 2 - 800)).toBeLessThanOrEqual(1)
  expect(node.props.width).toBeLessThanOrEqual(540)
  expect(await page.evaluate(() => window.dazbee?.tool())).toBe('select')
  await page.evaluate(() => window.dazbee?.drawn())
  writeOutput('image-2-placed.png', await page.screenshot({ animations: 'disabled' }))

  await undo(page)
  expect((await read(page)).nodes[placed ?? '']).toBeUndefined()
  expect(Object.keys((await read(page)).nodes).length).toBe(layers)

  // A brand image picked in the picker covers the box dragged on the stage.
  await press(page, 'toolImage')
  await expect(picker).toBeVisible()
  await picker.locator('[data-asset] button').first().click()
  await expect(picker).toBeHidden()
  await drag(page, { x: 100, y: 850 }, { x: 400, y: 1000 })
  const [dragged] = await selection(page)
  expect((await read(page)).nodes[dragged ?? '']).toMatchObject({ props: { x: 100, y: 850, width: 300, height: 150, fills: [{ type: 'image', fit: 'fill' }] } })
  writeOutput('image-3-dragged.png', await page.screenshot({ animations: 'disabled' }))
  await undo(page)

  // Pressing I again and closing the picker goes back to the select tool.
  await press(page, 'toolImage')
  await expect(picker).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(picker).toBeHidden()
  expect(await page.evaluate(() => window.dazbee?.tool())).toBe('select')
  expect(errors).toEqual([])
})

test('F, I and Mod+Alt+G are in the shortcuts list', async ({ browser }) => {
  const { page } = await openStage(browser, design())
  await page.keyboard.press('Shift+Slash')
  const dialog = page.getByTestId('shortcuts')
  await expect(dialog).toBeVisible()
  await expect(dialog.locator('[data-shortcut="toolFrame"]')).toContainText('F')
  await expect(dialog.locator('[data-shortcut="toolImage"]')).toContainText('I')
  await expect(dialog.locator('[data-shortcut="frameSelection"]')).toContainText('G')
  writeOutput('frame-5-shortcuts.png', await page.screenshot({ animations: 'disabled' }))
})
