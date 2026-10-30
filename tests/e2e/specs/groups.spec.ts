// Groups (#41), with real pointer and keyboard input: group three layers, resize the group, enter it
// with a double-click and move one layer inside, leave it with Escape, ungroup, and undo each step.
// Inside a turned group a drag and the arrow keys move a layer along the page as it is drawn.
import { boundsOf, centreOf, turn } from '@razzlr/doc'
import type { DesignInput } from '@razzlr/schema'
import { expect, test, type Page } from '@playwright/test'
import { screenPoint, writeOutput } from '../support/editor.ts'
import { liveDesign } from '../support/seed.ts'
import { click, drag, dragScreen, handle, openStage, order, press, read, selection, zoomOf, type Design } from '../support/stage.ts'

test.describe.configure({ timeout: 120_000 })

const rect = (x: number, y: number, width: number, height: number, color: string, rotation = 0) =>
  ({ x, y, width, height, rotation, shape: { kind: 'rect' as const, cornerRadius: 12 }, fills: [{ type: 'solid' as const, color }] })

/** The live design plus a tag, and a group turned 30° holding two layers. */
const design = (): DesignInput => {
  const base = liveDesign()
  return {
    ...base,
    meta: { ...base.meta, name: 'Groups' },
    nodes: {
      ...base.nodes,
      tag: { type: 'graphic', parentId: 'p1', index: 'a4', name: 'Tag', props: rect(420, 300, 160, 80, '#00A889FF') },
      turned: { type: 'group', parentId: 'p1', index: 'a5', name: 'Turned', props: { x: 560, y: 800, width: 400, height: 160, rotation: 30 } },
      t1: { type: 'graphic', parentId: 'turned', index: 'a0', name: 'T1', props: rect(560, 800, 160, 160, '#8E44FFFF') },
      t2: { type: 'graphic', parentId: 'turned', index: 'a1', name: 'T2', props: rect(800, 800, 160, 160, '#FFB020FF') },
    },
  }
}

type Placed = { x: number; y: number; width: number; height: number; rotation: number }
const box = (d: Design, id: string): Placed => {
  const p = { ...d.nodes[id]?.props, ...d.overrides['format:sq']?.[id] } as Partial<Placed>
  return { x: p.x ?? 0, y: p.y ?? 0, width: p.width ?? 0, height: p.height ?? 0, rotation: p.rotation ?? 0 }
}
const kids = (d: Design, id: string) => Object.entries(d.nodes).filter(([, n]) => n.parentId === id)
  .sort(([, a], [, b]) => (a.index < b.index ? -1 : 1)).map(([child]) => child)
/** A layer's centre on the page as drawn, after the groups around it turn it. */
function drawnCentre(d: Design, id: string) {
  let c = centreOf(box(d, id))
  for (let up = d.nodes[id]?.parentId; up && d.nodes[up]; up = d.nodes[up]?.parentId) c = turn(c, centreOf(box(d, up)), box(d, up).rotation)
  return c
}
/** A group's box is the box around what it holds, as drawn inside it. */
function expectHugs(d: Design, group: string) {
  const fit = boundsOf(kids(d, group).map((id) => box(d, id)))
  const own = box(d, group)
  for (const key of ['x', 'y', 'width', 'height'] as const) expect(own[key], `${group}.${key}`).toBeCloseTo(fit[key], 1)
}
const dblclick = async (page: Page, x: number, y: number) => {
  const at = await screenPoint(page, x, y)
  await page.mouse.dblclick(at.x, at.y)
  await page.evaluate(() => window.razzlr?.drawn())
}

test('group three layers, resize the group, enter it and move one, ungroup, and undo each step', async ({ browser }) => {
  const { page, errors } = await openStage(browser, design())
  const zoom = await zoomOf(page)
  const start = await read(page)

  // Group: click one, shift-click two more, then the shortcut.
  await click(page, 230, 180)
  await click(page, 820, 240, ['Shift'])
  await click(page, 500, 340, ['Shift'])
  await press(page, 'group')
  const [group = ''] = await selection(page)
  let now = await read(page)
  expect(now.nodes[group]).toMatchObject({ parentId: 'p1' })
  expect(kids(now, group)).toEqual(['box', 'dot', 'tag'])
  expect(box(now, group)).toMatchObject({ x: 80, y: 80, width: 860, height: 300 })
  // The group stands where the tag, the topmost of the three, was.
  expect((await order(page)).indexOf(group)).toBe((await order(page)).indexOf('arabic') + 1)
  writeOutput('groups-0-grouped.png', await page.screenshot())

  // Resize the group from its corner: what it holds scales with it.
  const se = await handle(page, 'se')
  await dragScreen(page, se, { x: se.x + 100 * zoom, y: se.y + 30 * zoom })
  now = await read(page)
  expect(box(now, group)).toMatchObject({ x: 80, y: 80, width: 960, height: 330 })
  expect(box(now, 'box').width).toBeCloseTo(300 * 960 / 860, 1)
  expect(box(now, 'dot').y).toBeCloseTo(80 + 40 * 1.1, 1)
  expectHugs(now, group)
  writeOutput('groups-1-resized.png', await page.screenshot())
  const resized = now

  // Double-click enters the group and picks the layer under the pointer.
  const dot = drawnCentre(now, 'dot')
  await dblclick(page, dot.x, dot.y)
  expect(await selection(page)).toEqual(['dot'])
  writeOutput('groups-2-entered.png', await page.screenshot())
  // A click on another layer inside picks it, not the group.
  const tag = drawnCentre(now, 'tag')
  await click(page, tag.x, tag.y)
  expect(await selection(page)).toEqual(['tag'])

  // Move the tag down past the group's edge: only it moves, and the group grows to hold it.
  await drag(page, tag, { x: tag.x + 60, y: tag.y + 100 })
  now = await read(page)
  expect(box(now, 'tag')).toMatchObject({ x: Math.round(box(resized, 'tag').x + 60), y: Math.round(box(resized, 'tag').y + 100) })
  expect(box(now, 'dot')).toEqual(box(resized, 'dot'))
  expect(box(now, group).height).toBeGreaterThan(330)
  expectHugs(now, group)
  writeOutput('groups-3-moved-inside.png', await page.screenshot())
  const moved = now

  // Escape goes back up: the group is selected again.
  await press(page, 'deselect')
  expect(await selection(page)).toEqual([group])

  // Ungroup: the layers are back on the page where the group was, still selected, unmoved.
  await press(page, 'ungroup')
  now = await read(page)
  expect(now.nodes[group]).toBeUndefined()
  expect(await selection(page)).toEqual(['box', 'dot', 'tag'])
  for (const id of ['box', 'dot', 'tag']) {
    expect(now.nodes[id]?.parentId).toBe('p1')
    expect(box(now, id)).toEqual(box(moved, id))
  }
  writeOutput('groups-4-ungrouped.png', await page.screenshot())

  // Undo each step, one at a time.
  await press(page, 'undo')
  now = await read(page)
  expect(kids(now, group)).toEqual(['box', 'dot', 'tag'])
  expect(box(now, group)).toEqual(box(moved, group))
  await press(page, 'undo')
  now = await read(page)
  expect(box(now, 'tag')).toEqual(box(resized, 'tag'))
  expect(box(now, group)).toEqual(box(resized, group))
  await press(page, 'undo')
  now = await read(page)
  expect(box(now, group)).toMatchObject({ width: 860, height: 300 })
  expect(box(now, 'box')).toEqual(box(start, 'box'))
  await press(page, 'undo')
  now = await read(page)
  expect(now.nodes[group]).toBeUndefined()
  expect(now).toEqual(start)
  expect(errors).toEqual([])
})

test('inside a turned group, a drag and the arrow keys move a layer along the page as drawn', async ({ browser }) => {
  const { page, errors } = await openStage(browser, design())
  let now = await read(page)
  const t2 = drawnCentre(now, 't2')
  const t1 = drawnCentre(now, 't1')

  // A click picks the turned group; a double-click goes in and picks T2.
  await click(page, t2.x, t2.y)
  expect(await selection(page)).toEqual(['turned'])
  await dblclick(page, t2.x, t2.y)
  expect(await selection(page)).toEqual(['t2'])
  // Its handles are turned with the group.
  const nw = await handle(page, 'nw')
  const ne = await handle(page, 'ne')
  expect((Math.atan2(ne.y - nw.y, ne.x - nw.x) * 180) / Math.PI).toBeCloseTo(30, 0)
  writeOutput('groups-5-inside-turned.png', await page.screenshot())

  // Dragged 100 to the right on the page, it lands 100 to the right on the page.
  await drag(page, t2, { x: t2.x + 100, y: t2.y })
  now = await read(page)
  const dragged = drawnCentre(now, 't2')
  // A move is kept in whole pixels inside the group, so the drawn centre is within a pixel.
  expect(Math.hypot(dragged.x - (t2.x + 100), dragged.y - t2.y)).toBeLessThan(1)
  expectHugs(now, 'turned')
  // T1 stays where it was drawn, though the group's box changed around it.
  expect(drawnCentre(now, 't1').x).toBeCloseTo(t1.x, 1)
  expect(drawnCentre(now, 't1').y).toBeCloseTo(t1.y, 1)

  // An arrow nudges 10 px down the page with shift.
  await press(page, 'nudgeDownFar')
  const nudged = drawnCentre(await read(page), 't2')
  expect(nudged.x).toBeCloseTo(dragged.x, 1)
  expect(nudged.y).toBeCloseTo(dragged.y + 10, 1)
  writeOutput('groups-6-moved-in-turned.png', await page.screenshot())
  expect(errors).toEqual([])
})
