// Snapping, smart guides, rulers, align and distribute (#42), with real pointer and keyboard input:
// a drag near another layer snaps and shows a guide, Ctrl turns snapping off, the inspector's
// buttons align and distribute three layers in one undo step each, the rulers mark the selection,
// and a drag among 300 layers keeps each pointer move's work inside a 60 Hz frame.
import type { DesignInput } from '@razzlr/schema'
import { expect, test, type Page } from '@playwright/test'
import { screenPoint, writeOutput } from '../support/editor.ts'
import { liveDesign } from '../support/seed.ts'
import { click, openStage, press, props, selection } from '../support/stage.ts'

test.describe.configure({ timeout: 120_000 })

const rect = (x: number, y: number, width: number, height: number, color: string) =>
  ({ x, y, width, height, shape: { kind: 'rect' as const, cornerRadius: 12 }, fills: [{ type: 'solid' as const, color }] })

/** The live design plus a tag between the box and the dot. */
const design = (): DesignInput => {
  const base = liveDesign()
  return {
    ...base,
    meta: { ...base.meta, name: 'Snapping' },
    nodes: { ...base.nodes, tag: { type: 'graphic', parentId: 'p1', index: 'a4', name: 'Tag', props: rect(470, 150, 120, 60, '#00A889FF') } },
  }
}

/** Presses on a design pixel and moves to another in steps, leaving the button down. */
async function hold(page: Page, from: { x: number; y: number }, to: { x: number; y: number }, keys: string[] = []) {
  const a = await screenPoint(page, from.x, from.y)
  const b = await screenPoint(page, to.x, to.y)
  await page.mouse.move(a.x, a.y)
  await page.mouse.down()
  for (const key of keys) await page.keyboard.down(key)
  await page.mouse.move(b.x, b.y, { steps: 8 })
  await page.evaluate(() => window.razzlr?.drawn())
}
async function release(page: Page, keys: string[] = []) {
  await page.mouse.up()
  for (const key of keys) await page.keyboard.up(key)
  await page.evaluate(() => window.razzlr?.drawn())
}
const guides = (page: Page) => page.locator('.stage-overlay .guide').evaluateAll((els) => els.map((el) => (el as HTMLElement).dataset.axis))

test('a drag snaps to another layer with a guide, and not with Ctrl held', async ({ browser }) => {
  const { page, errors } = await openStage(browser, design())
  // The dot's top is at 120; dragged up 37 it comes 3 px from the box's top at 80, within reach.
  await hold(page, { x: 820, y: 240 }, { x: 820, y: 203 })
  expect(await guides(page)).toContain('y')
  writeOutput('snapping-0-guide.png', await page.screenshot())
  await release(page)
  expect(await props(page, 'dot')).toMatchObject({ x: 700, y: 80 })
  expect(await page.locator('.stage-overlay .guide').count()).toBe(0)

  // Ctrl held: it lands exactly where the pointer puts it.
  await hold(page, { x: 820, y: 200 }, { x: 820, y: 203 }, ['Control'])
  expect(await guides(page)).toEqual([])
  await release(page, ['Control'])
  expect(await props(page, 'dot')).toMatchObject({ y: 83 })

  // Equal spacing: the tag between the box (right edge 380) and the dot (left edge 700), 3 px
  // off centre, snaps to 100 px from each, with both gaps marked.
  await hold(page, { x: 530, y: 180 }, { x: 533, y: 180 })
  const gaps = await page.locator('.stage-overlay .gap span').allTextContents()
  writeOutput('snapping-1-equal-gaps.png', await page.screenshot())
  await release(page)
  expect(await props(page, 'tag')).toMatchObject({ x: 480 })
  expect(gaps).toEqual(['100', '100'])
  expect(errors).toEqual([])
})

test('the inspector aligns and distributes three layers, one undo step each', async ({ browser }) => {
  const { page, errors } = await openStage(browser, design())
  const arrange = page.getByTestId('arrange')
  // The Arrange card shows only once something is selected (#83).
  await expect(arrange).toHaveCount(0)

  await click(page, 230, 180)
  await click(page, 530, 180, ['Shift'])
  await click(page, 820, 240, ['Shift'])
  expect(await selection(page)).toEqual(['box', 'tag', 'dot'])
  await expect(arrange.locator('[data-action="distributeHorizontal"]')).toBeEnabled()

  await arrange.locator('[data-action="alignTop"]').click()
  await page.evaluate(() => window.razzlr?.drawn())
  expect([(await props(page, 'box')).y, (await props(page, 'tag')).y, (await props(page, 'dot')).y]).toEqual([80, 80, 80])
  // Box 80–380, tag 120 wide, dot 700–940: 860 across, 660 of it layers, so 100 between each.
  await arrange.locator('[data-action="distributeHorizontal"]').click()
  await page.evaluate(() => window.razzlr?.drawn())
  expect([(await props(page, 'box')).x, (await props(page, 'tag')).x, (await props(page, 'dot')).x]).toEqual([80, 480, 700])
  writeOutput('snapping-2-aligned-distributed.png', await page.screenshot())

  await press(page, 'undo')
  expect((await props(page, 'tag')).x).toBe(470)
  expect((await props(page, 'tag')).y).toBe(80)
  await press(page, 'undo')
  expect((await props(page, 'tag')).y).toBe(150)

  // One layer lines up with the format: Alt+H centres the dot on the page.
  await click(page, 820, 240)
  await press(page, 'alignCentre')
  expect((await props(page, 'dot')).x).toBe(420)
  expect(errors).toEqual([])
})

test('rulers count design pixels from the frame, mark the selection, and hide with Shift+R', async ({ browser }) => {
  const { page, errors } = await openStage(browser, design())
  const top = page.locator('.stage-overlay .ruler[data-axis="x"]')
  await expect(top).toBeVisible()
  // At 80% numbered ticks are 100 design pixels apart.
  const ticks = await top.locator('.ruler-tick').allTextContents()
  expect(ticks).toEqual(expect.arrayContaining(['0', '100', '500', '1000']))
  await click(page, 820, 240)
  expect(await top.locator('.ruler-end').allTextContents()).toEqual(['700', '940'])
  expect(await page.locator('.stage-overlay .ruler[data-axis="y"] .ruler-end').allTextContents()).toEqual(['120', '360'])
  writeOutput('snapping-3-rulers.png', await page.screenshot())
  await press(page, 'toggleRulers')
  await expect(top).toHaveCount(0)
  expect(errors).toEqual([])
})

test('dragging among 300 layers keeps each pointer move, snapping included, inside a frame', async ({ browser }) => {
  const base = design()
  const nodes: DesignInput['nodes'] = { ...base.nodes }
  for (let i = 0; i < 300; i++) {
    const x = 20 + (i % 20) * 52
    const y = 420 + Math.floor(i / 20) * 42
    nodes[`r${i}`] = { type: 'graphic', parentId: 'p1', index: `b${String(i).padStart(3, '0')}`, name: `R${i}`, props: rect(x, y, 40, 30, '#9AA4B2FF') }
  }
  const { page, errors } = await openStage(browser, { ...base, meta: { ...base.meta, name: '300 layers' }, nodes })
  await click(page, 820, 240)
  // Time every pointer move from its capture to the end of its handling, and every redraw.
  await page.evaluate(() => {
    const times = { handle: [] as number[], draw: [] as number[] }
    let started = 0
    window.addEventListener('pointermove', () => { started = performance.now() }, { capture: true })
    window.addEventListener('pointermove', () => { times.handle.push(performance.now() - started) })
    window.razzlr?.onDraw((_design, _at, info) => times.draw.push(info.ms))
    ;(window as unknown as { times: typeof times }).times = times
  })
  const a = await screenPoint(page, 820, 240)
  await page.mouse.move(a.x, a.y)
  await page.mouse.down()
  for (let i = 1; i <= 60; i++) {
    await page.mouse.move(a.x - i * 4, a.y + i * 5)
    await page.evaluate(() => window.razzlr?.drawn())
  }
  await page.mouse.up()
  const times = await page.evaluate(() => (window as unknown as { times: { handle: number[]; draw: number[] } }).times)
  const pct = (xs: number[], p: number) => [...xs].sort((x, y) => x - y)[Math.min(xs.length - 1, Math.floor(xs.length * p))] ?? 0
  const line = `300 layers, 60 pointer moves: handling (command and snapping) median ${pct(times.handle, 0.5).toFixed(2)} ms, p95 ${pct(times.handle, 0.95).toFixed(2)} ms; redraw median ${pct(times.draw, 0.5).toFixed(1)} ms, p95 ${pct(times.draw, 0.95).toFixed(1)} ms over ${times.draw.length} redraws`
  console.log(line)
  writeOutput('snapping-300-layers.txt', `${line}\n`)
  expect(times.handle.length).toBeGreaterThanOrEqual(60)
  expect(pct(times.handle, 0.95)).toBeLessThan(16.7)
  expect(errors).toEqual([])
})
