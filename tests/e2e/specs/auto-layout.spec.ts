// Auto layout (#46), with real pointer and keyboard input: typing into a button's label grows the
// button and pushes what follows it along the row; and Shift+A turns a frame laid out by hand into
// auto layout without moving anything, after which deleting a child closes the gap.
import { expect, test, type Page } from '@playwright/test'
import type { DesignInput } from '@razzlr/schema'
import { exportHashOf, writeOutput } from '../support/editor.ts'
import { click, openStage, press, read, selection } from '../support/stage.ts'

test.describe.configure({ timeout: 120_000 })

type Node = DesignInput['nodes'][string]
const rect = (parentId: string, index: string, x: number, y: number, width: number, height: number, color: string): Node =>
  ({ type: 'graphic', parentId, index, name: index, props: { x, y, width, height, shape: { kind: 'rect', cornerRadius: 12 }, fills: [{ type: 'solid', color }] } }) as Node

const design = (): DesignInput => ({
  meta: { schemaVersion: 2, designId: 'replaced-by-the-api', name: 'Auto layout', kind: 'single', primaryFormatId: 'sq' },
  formats: { sq: { name: 'Square', width: 1080, height: 1080, order: 'a0' } },
  pages: { p1: { name: 'Page 1', order: 'a0', fills: [{ type: 'solid', color: '#FFF8F0FF' }] } },
  nodes: {
    // A row: a button that hugs its label, then a tile, 24 apart, centred across.
    bar: {
      type: 'frame', parentId: 'p1', index: 'a0', name: 'Bar',
      props: { x: 100, y: 100, width: 880, height: 200, fills: [{ type: 'solid', color: '#EEF1F6FF' }], layout: { direction: 'row', gap: 24, padding: { top: 24, right: 24, bottom: 24, left: 24 }, align: 'center' } },
    },
    btn: {
      type: 'frame', parentId: 'bar', index: 'a0', name: 'Button',
      props: { x: 0, y: 0, width: 10, height: 10, sizing: { width: 'hug', height: 'hug' }, fills: [{ type: 'solid', color: '#FF2E7EFF' }], layout: { direction: 'row', padding: { top: 16, right: 32, bottom: 16, left: 32 } } },
    },
    label: {
      type: 'text', parentId: 'btn', index: 'a0', name: 'Label',
      props: { x: 0, y: 0, width: 10, height: 10, text: 'Buy', boxMode: 'autoWidth', style: { fontFamily: 'Noto Sans', fontSize: 40, fontWeight: 700, color: '#FFFFFFFF' } },
    },
    tile: rect('bar', 'a1', 0, 0, 120, 120, '#2F6BFFFF'),
    // Laid out by hand: three tiles in a row, 20 apart, 30 in from the frame's top and left.
    shelf: {
      type: 'frame', parentId: 'p1', index: 'a1', name: 'Shelf',
      props: { x: 100, y: 500, width: 700, height: 220, fills: [{ type: 'solid', color: '#1F2329FF' }] },
    },
    one: rect('shelf', 'a0', 130, 530, 160, 160, '#FFB020FF'),
    two: rect('shelf', 'a1', 310, 530, 200, 160, '#00A88AFF'),
    three: rect('shelf', 'a2', 530, 530, 120, 160, '#9747FFFF'),
  },
  overrides: {},
})

const boxOf = (page: Page, id: string) => page.evaluate((id) => window.razzlr?.boxOf(id), id) as Promise<{ x: number; y: number; width: number; height: number }>
const undo = async (page: Page) => {
  await press(page, 'undo')
  await page.evaluate(() => window.razzlr?.drawn())
}

test('typing into a button\'s label grows the button and moves the tile after it along', async ({ browser }) => {
  const { page, errors } = await openStage(browser, design())
  const before = { btn: await boxOf(page, 'btn'), label: await boxOf(page, 'label'), tile: await boxOf(page, 'tile') }
  const startHash = await exportHashOf(page)
  // Laid out on open: the button hugs its label inside its padding, the tile follows 24 on.
  expect(before.btn.x).toBe(124)
  expect(before.label.x).toBe(156)
  expect(before.btn.width).toBeCloseTo(before.label.width + 64, 5)
  expect(before.btn.height).toBeCloseTo(before.label.height + 32, 5)
  expect(before.tile.x).toBeCloseTo(before.btn.x + before.btn.width + 24, 5)
  // Centred across the 200 tall bar.
  expect(before.btn.y + before.btn.height / 2).toBeCloseTo(200, 5)
  expect(before.tile.y).toBe(140)
  writeOutput('auto-layout-0-button.png', await page.screenshot({ animations: 'disabled' }))

  // Double-clicks go into the bar, then the button, then the label, where a caret lands at its end.
  const end = { x: before.label.x + before.label.width - 2, y: before.label.y + before.label.height / 2 }
  for (let i = 0; i < 3; i++) {
    const at = await page.evaluate(({ x, y }) => window.razzlr?.screenPoint(x, y), end) as { x: number; y: number }
    await page.mouse.dblclick(at.x, at.y)
    await page.evaluate(() => window.razzlr?.drawn())
  }
  await expect(page.locator('.caret')).toBeVisible()
  await page.keyboard.type(' now')
  await page.evaluate(() => window.razzlr?.drawn())
  writeOutput('auto-layout-1-typing.png', await page.screenshot({ animations: 'disabled' }))
  await page.keyboard.press('Escape')
  await page.evaluate(() => window.razzlr?.drawn())

  expect((await read(page)).nodes.label?.props.text).toBe('Buy now')
  const after = { btn: await boxOf(page, 'btn'), label: await boxOf(page, 'label'), tile: await boxOf(page, 'tile') }
  // The label is wider by the words typed, the button by as much, and the tile moved over by it.
  const grew = after.label.width - before.label.width
  expect(grew).toBeGreaterThan(60)
  expect(after.btn.width - before.btn.width).toBeCloseTo(grew, 5)
  expect(after.tile.x - before.tile.x).toBeCloseTo(grew, 5)
  expect(after.btn.x).toBe(124)
  expect(after.btn.height).toBeCloseTo(before.btn.height, 5)
  const typedHash = await exportHashOf(page)
  expect(typedHash).not.toBe(startHash)
  writeOutput('auto-layout-2-typed.png', await page.screenshot({ animations: 'disabled' }))

  // The typing is one undo step, and with it the layout goes back too.
  await undo(page)
  expect(await boxOf(page, 'btn')).toEqual(before.btn)
  expect(await boxOf(page, 'tile')).toEqual(before.tile)
  expect(await exportHashOf(page)).toBe(startHash)
  expect(errors).toEqual([])
})

test('Shift+A turns a frame into auto layout without moving anything, and a deleted child\'s gap closes', async ({ browser }) => {
  const { page, errors } = await openStage(browser, design())
  const ids = ['one', 'two', 'three'] as const
  const placedBy = async () => Object.fromEntries(await Promise.all(ids.map(async (id) => [id, await boxOf(page, id)] as const)))
  const before = await placedBy()
  const startHash = await exportHashOf(page)

  // A click on a tile picks the shelf; Shift+A reads the row, gap and padding off the tiles.
  await click(page, 200, 600)
  expect(await selection(page)).toEqual(['shelf'])
  await press(page, 'autoLayout')
  const d = await read(page)
  expect(d.nodes.shelf?.props).toMatchObject({ layout: { direction: 'row', gap: 20, align: 'start', padding: { top: 30, left: 30 } } })
  // Nothing moved: the same boxes and the same pixels.
  expect(await placedBy()).toEqual(before)
  expect(await exportHashOf(page)).toBe(startHash)
  writeOutput('auto-layout-3-switched.png', await page.screenshot({ animations: 'disabled' }))

  // Double-click into the shelf picks the middle tile; deleting it brings the last one over.
  const middle = await page.evaluate(() => window.razzlr?.screenPoint(400, 600)) as { x: number; y: number }
  await page.mouse.dblclick(middle.x, middle.y)
  await page.evaluate(() => window.razzlr?.drawn())
  expect(await selection(page)).toEqual(['two'])
  await press(page, 'delete')
  expect((await read(page)).nodes.two).toBeUndefined()
  expect((await boxOf(page, 'three')).x).toBe(130 + 160 + 20)
  expect((await boxOf(page, 'one')).x).toBe(130)
  writeOutput('auto-layout-4-deleted.png', await page.screenshot({ animations: 'disabled' }))

  // One undo puts the tile back, and the last one returns to where it was.
  await undo(page)
  expect(await placedBy()).toEqual(before)
  // One more takes auto layout off again.
  await undo(page)
  expect((await read(page)).nodes.shelf?.props).not.toHaveProperty('layout')
  expect(errors).toEqual([])
})
