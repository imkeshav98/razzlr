// Canvas gestures follow the container they act on, with real pointer and keyboard input: an auto
// layout frame resized from its handle keeps its circles' size and reflows them; a plain frame
// keeps what it holds as it is while a group scales it; a child of auto layout resized gets a fixed
// size and its siblings move up; a child dragged moves along the flow, or out of the frame; the
// arrow keys reorder along the flow and explain across it; auto text resized keeps the size given.
import { expect, test, type Page } from '../support/test.ts'
import type { DesignInput } from '@dazbee/schema'
import { writeOutput } from '../support/editor.ts'
import { click, dragScreen, handle, openStage, press, read, selection } from '../support/stage.ts'
import { screenPoint } from '../support/editor.ts'

test.describe.configure({ timeout: 120_000 })

type Node = DesignInput['nodes'][string]
const circle = (name: string, index: string): Node =>
  ({ type: 'graphic', parentId: 'row', index, name, props: { x: 0, y: 0, width: 100, height: 100, shape: { kind: 'ellipse' }, fills: [{ type: 'solid', color: ['#FF2E7EFF', '#2F6BFFFF', '#FFB020FF', '#00A88AFF'][Number(index.slice(1))] ?? '#000000FF' }] } }) as Node
const rect = (name: string, parentId: string, index: string, x: number, y: number, width: number, height: number, color: string): Node =>
  ({ type: 'graphic', parentId, index, name, props: { x, y, width, height, shape: { kind: 'rect' }, fills: [{ type: 'solid', color }] } }) as Node

const design = (): DesignInput => ({
  meta: { schemaVersion: 3, designId: 'replaced-by-the-api', name: 'Gestures and layout', kind: 'single', primaryFormatId: 'sq' },
  formats: { sq: { name: 'Square', width: 1080, height: 1080, order: 'a0' }, wide: { name: 'Wide', width: 1920, height: 1080, order: 'a1' } },
  pages: { p1: { name: 'Page 1', order: 'a0', fills: [{ type: 'solid', color: '#FFF8F0FF' }] } },
  nodes: {
    // Four circles in a row that wraps, the frame as tall as they need.
    row: {
      type: 'frame', parentId: 'p1', index: 'a0', name: 'Row',
      props: { x: 60, y: 60, width: 520, height: 140, sizing: { width: 'fixed', height: 'hug' }, fills: [{ type: 'solid', color: '#EEF1F6FF' }], layout: { direction: 'row', gap: 20, padding: { top: 20, right: 20, bottom: 20, left: 20 }, wrap: true, lineGap: 20 } },
    },
    c0: circle('C0', 'a0'), c1: circle('C1', 'a1'), c2: circle('C2', 'a2'), c3: circle('C3', 'a3'),
    plain: { type: 'frame', parentId: 'p1', index: 'a1', name: 'Plain', props: { x: 660, y: 60, width: 340, height: 220, fills: [{ type: 'solid', color: '#1F2329FF' }] } },
    inner: rect('Inner', 'plain', 'a0', 700, 100, 120, 80, '#9747FFFF'),
    grp: { type: 'group', parentId: 'p1', index: 'a2', name: 'Group', props: { x: 660, y: 360, width: 300, height: 120 } },
    g0: rect('G0', 'grp', 'a0', 660, 360, 120, 120, '#FF2E7EFF'),
    g1: rect('G1', 'grp', 'a1', 840, 360, 120, 120, '#2F6BFFFF'),
    turned: { type: 'frame', parentId: 'p1', index: 'a3', name: 'Turned', props: { x: 640, y: 640, width: 320, height: 200, rotation: 30, clip: false, fills: [{ type: 'solid', color: '#E8E0FFFF' }] } },
    tchild: rect('Turned child', 'turned', 'a0', 680, 680, 100, 60, '#00A88AFF'),
    label: { type: 'text', parentId: 'p1', index: 'a4', name: 'Label', props: { x: 60, y: 560, width: 300, height: 66, text: 'Fresh coffee', boxMode: 'autoWidth', style: { fontFamily: 'Noto Sans', fontSize: 48, fontWeight: 700, color: '#1F2329FF' } } },
  },
  overrides: {},
})

type Box = { x: number; y: number; width: number; height: number }
const boxOf = (page: Page, id: string, formatId = 'sq') => page.evaluate(({ id, formatId }) => window.dazbee?.boxOf(id, 'p1', formatId), { id, formatId }) as Promise<Box>
const near = (a: Box, b: Box, what: string) => {
  for (const k of ['x', 'y', 'width', 'height'] as const) expect(Math.abs(a[k] - b[k]), `${what} ${k}: ${a[k]} vs ${b[k]}`).toBeLessThanOrEqual(0.5)
}
const order = async (page: Page, parentId: string) => Object.entries((await read(page)).nodes)
  .filter(([, n]) => n.parentId === parentId).sort(([, a], [, b]) => (a.index < b.index ? -1 : 1)).map(([id]) => id)
const undo = async (page: Page) => {
  await press(page, 'undo')
  await page.evaluate(() => window.dazbee?.drawn())
}
/** Drags the selection's handle by a distance in design pixels. */
async function dragHandle(page: Page, which: string, dx: number, dy: number) {
  const from = await handle(page, which)
  const zoom = await page.evaluate(() => window.dazbee?.camera().zoom ?? 1)
  await dragScreen(page, from, { x: from.x + dx * zoom, y: from.y + dy * zoom })
}
async function dragDesign(page: Page, from: { x: number; y: number }, to: { x: number; y: number }, shot?: string) {
  const a = await screenPoint(page, from.x, from.y)
  const b = await screenPoint(page, to.x, to.y)
  await page.mouse.move(a.x, a.y)
  await page.mouse.down()
  await page.mouse.move((a.x + b.x) / 2, (a.y + b.y) / 2, { steps: 4 })
  await page.mouse.move(b.x, b.y, { steps: 6 })
  if (shot) writeOutput(shot, await page.screenshot({ animations: 'disabled' }))
  await page.mouse.up()
  await page.evaluate(() => window.dazbee?.drawn())
}

test('an auto layout frame resized from its handle keeps its circles\' size and reflows them; one undo step', async ({ browser }) => {
  const { page, errors } = await openStage(browser, design())
  const before = await Promise.all(['c0', 'c1', 'c2', 'c3'].map((id) => boxOf(page, id)))
  // One row of four: 20 + 4 × 100 + 3 × 20 + 20 = 520 wide, 140 tall.
  expect(before.map((b) => b.y)).toEqual([80, 80, 80, 80])
  await click(page, 70, 70)
  expect(await selection(page)).toEqual(['row'])
  writeOutput('layout-resize-0-before.png', await page.screenshot({ animations: 'disabled' }))
  // Narrower, to 320: two circles a line, so two lines.
  await dragHandle(page, 'e', -200, 0)
  const after = await Promise.all(['c0', 'c1', 'c2', 'c3'].map((id) => boxOf(page, id)))
  for (const [i, b] of after.entries()) expect([b.width, b.height], `c${i} keeps its size`).toEqual([100, 100])
  expect(after.map((b) => [b.x, b.y])).toEqual([[80, 80], [200, 80], [80, 200], [200, 200]])
  near(await boxOf(page, 'row'), { x: 60, y: 60, width: 320, height: 260 }, 'row')
  const row = (await read(page)).overrides['format:sq']?.row as { width?: number; sizing?: unknown } | undefined
  expect(row?.width).toBe(320)
  writeOutput('layout-resize-1-reflowed.png', await page.screenshot({ animations: 'disabled' }))
  // The other format is as it was.
  near(await boxOf(page, 'row', 'wide'), { x: 60, y: 60, width: 520, height: 140 }, 'row in wide')
  await undo(page)
  near(await boxOf(page, 'row'), { x: 60, y: 60, width: 520, height: 140 }, 'row after undo')
  expect(errors).toEqual([])
})

test('the dragged axis of a hugging frame becomes fixed, so it takes the size dragged', async ({ browser }) => {
  const content = design()
  ;(content.nodes.row as { props: Record<string, unknown> }).props.sizing = { width: 'hug', height: 'hug' }
  const { page, errors } = await openStage(browser, content)
  await click(page, 70, 70)
  await dragHandle(page, 'e', -200, 0)
  // It hugged four circles, 500 wide; dragged 200 in, it is 300 wide and wraps them in twos.
  expect((await read(page)).overrides['format:sq']?.row?.sizing).toEqual({ width: 'fixed', height: 'hug' })
  near(await boxOf(page, 'row'), { x: 60, y: 60, width: 300, height: 260 }, 'row')
  await undo(page)
  expect((await read(page)).overrides['format:sq']?.row?.sizing).toBeUndefined()
  expect(errors).toEqual([])
})

test('a plain frame keeps what it holds as it is, also turned; a group still scales it', async ({ browser }) => {
  const { page, errors } = await openStage(browser, design())
  const inner = await boxOf(page, 'inner')
  await click(page, 960, 260)
  expect(await selection(page)).toEqual(['plain'])
  await dragHandle(page, 'w', 40, 0)
  await dragHandle(page, 's', 0, 60)
  near(await boxOf(page, 'inner'), inner, 'inner')
  near(await boxOf(page, 'plain'), { x: 700, y: 60, width: 300, height: 280 }, 'plain')

  // Turned: the layer inside stays where it is drawn.
  const tchild = await boxOf(page, 'tchild')
  await click(page, 900, 790)
  expect(await selection(page)).toEqual(['turned'])
  await dragHandle(page, 'w', 40, 20)
  near(await boxOf(page, 'tchild'), tchild, 'turned child')
  writeOutput('layout-resize-2-frames.png', await page.screenshot({ animations: 'disabled' }))

  // A group scales what it holds.
  await click(page, 700, 420)
  expect(await selection(page)).toEqual(['grp'])
  await dragHandle(page, 'e', -150, 0)
  near(await boxOf(page, 'g1'), { x: 750, y: 360, width: 60, height: 120 }, 'g1 scaled')
  expect(errors).toEqual([])
})

test('a child of auto layout: a resize fixes its size and the flow moves up; a drag moves it along the flow or out', async ({ browser }) => {
  const { page, errors } = await openStage(browser, design())
  const at = await screenPoint(page, 130, 130)
  await page.mouse.dblclick(at.x, at.y)
  await page.evaluate(() => window.dazbee?.drawn())
  expect(await selection(page)).toEqual(['c0'])
  await dragHandle(page, 'e', 60, 0)
  expect((await boxOf(page, 'c0')).width).toBe(160)
  expect((await read(page)).overrides['format:sq']?.c0?.sizing).toBeUndefined()
  expect((await boxOf(page, 'c1')).x).toBe(260)
  // Its place is the flow's: the resize wrote no position.
  expect((await read(page)).overrides['format:sq']?.c0?.x).toBeUndefined()
  await undo(page)

  // Dragged past C2: it goes after it, a line showing where.
  await dragDesign(page, { x: 130, y: 130 }, { x: 375, y: 130 }, 'layout-move-1-line.png')
  expect(await order(page, 'row')).toEqual(['c1', 'c2', 'c0', 'c3'])
  expect((await boxOf(page, 'c0')).x).toBe(320)
  await undo(page)
  expect(await order(page, 'row')).toEqual(['c0', 'c1', 'c2', 'c3'])

  // Dragged out of the frame: it leaves it, and lands where it was dropped.
  await dragDesign(page, { x: 130, y: 130 }, { x: 330, y: 830 }, 'layout-move-2-out.png')
  expect((await read(page)).nodes.c0?.parentId).toBe('p1')
  near(await boxOf(page, 'c0'), { x: 280, y: 780, width: 100, height: 100 }, 'c0 out')
  // In the other format it stays where its flow had it.
  near(await boxOf(page, 'c0', 'wide'), { x: 80, y: 80, width: 100, height: 100 }, 'c0 out in wide')
  expect((await boxOf(page, 'c1')).x).toBe(80)
  writeOutput('layout-move-3-left.png', await page.screenshot({ animations: 'disabled' }))
  await undo(page)
  expect((await read(page)).nodes.c0?.parentId).toBe('row')
  expect(errors).toEqual([])
})

test('the arrow keys move a child along its flow; across it, or align, auto layout decides and the page says so', async ({ browser }) => {
  const { page, errors } = await openStage(browser, design())
  const at = await screenPoint(page, 250, 130)
  await page.mouse.dblclick(at.x, at.y)
  await page.evaluate(() => window.dazbee?.drawn())
  expect(await selection(page)).toEqual(['c1'])
  await press(page, 'nudgeRight')
  expect(await order(page, 'row')).toEqual(['c0', 'c2', 'c1', 'c3'])
  await press(page, 'nudgeLeft')
  await press(page, 'nudgeLeft')
  expect(await order(page, 'row')).toEqual(['c1', 'c0', 'c2', 'c3'])
  await press(page, 'nudgeDown')
  await expect(page.getByTestId('notice-toast')).toContainText('Auto layout places this layer')
  writeOutput('layout-nudge-notice.png', await page.screenshot({ animations: 'disabled' }))
  expect(await order(page, 'row')).toEqual(['c1', 'c0', 'c2', 'c3'])
  const before = JSON.stringify(await read(page))
  await press(page, 'alignBottom')
  expect(JSON.stringify(await read(page))).toBe(before)
  await expect(page.getByTestId('notice-toast')).toBeVisible()
  expect(errors).toEqual([])
})

test('auto width text resized takes the size given instead of snapping back', async ({ browser }) => {
  const { page, errors } = await openStage(browser, design())
  await click(page, 120, 590)
  expect(await selection(page)).toEqual(['label'])
  const was = await boxOf(page, 'label')
  await dragHandle(page, 'e', -120, 0)
  const overrides = (await read(page)).overrides['format:sq']?.label as { boxMode?: string; width?: number }
  expect(overrides.boxMode).toBe('autoHeight')
  expect((await boxOf(page, 'label')).width).toBeCloseTo(was.width - 120, 0)
  // Taller than one line now, as it wraps in the width given.
  expect((await boxOf(page, 'label')).height).toBeGreaterThan(was.height)
  await dragHandle(page, 's', 0, 40)
  expect(((await read(page)).overrides['format:sq']?.label as { boxMode?: string }).boxMode).toBe('fixed')
  writeOutput('layout-text-resize.png', await page.screenshot({ animations: 'disabled' }))
  expect(errors).toEqual([])
})

test('a fill child grows with its frame; in a wrapped flow a drag lands next to the layer it is dropped by', async ({ browser }) => {
  const content = design()
  // C1 fills the row's room left over.
  ;(content.nodes.c1 as { props: Record<string, unknown> }).props.sizing = { width: 'fill', height: 'fixed' }
  ;(content.nodes.row as { props: Record<string, unknown> }).props.layout = { direction: 'row', gap: 20, padding: { top: 20, right: 20, bottom: 20, left: 20 } }
  const { page, errors } = await openStage(browser, content)
  const fill = (await boxOf(page, 'c1')).width
  await click(page, 70, 70)
  await dragHandle(page, 'e', 100, 0)
  expect((await boxOf(page, 'c1')).width).toBeCloseTo(fill + 100, 0)
  for (const id of ['c0', 'c2', 'c3']) expect((await boxOf(page, id)).width).toBe(100)
  await undo(page)
  expect(errors).toEqual([])
})

test('in a wrapped flow, a layer dropped beside one on the first line goes next to it', async ({ browser }) => {
  const { page, errors } = await openStage(browser, design())
  await click(page, 70, 70)
  await dragHandle(page, 'e', -200, 0)
  // Two lines: C0 C1 / C2 C3. C3 dropped just after C0, on the first line.
  expect((await boxOf(page, 'c3')).y).toBe(200)
  const at = await screenPoint(page, 250, 250)
  await page.mouse.dblclick(at.x, at.y)
  await page.evaluate(() => window.dazbee?.drawn())
  expect(await selection(page)).toEqual(['c3'])
  await dragDesign(page, { x: 250, y: 250 }, { x: 150, y: 120 }, 'layout-move-4-wrapped.png')
  expect(await order(page, 'row')).toEqual(['c0', 'c3', 'c1', 'c2'])
  // The last one can't go further along: the page says so.
  await press(page, 'nudgeRight')
  await press(page, 'nudgeRight')
  await press(page, 'nudgeRight')
  await expect(page.getByTestId('notice-toast')).toContainText('already at that end')
  expect(errors).toEqual([])
})
