// The layers panel (#59) in Chromium, with real pointer and keyboard input: the tree in step with the
// stage's selection both ways, a layer dragged into a group (the stage redraws it there, one undo
// step), rename, lock and hide; the same by keyboard alone; and 300 layers scrolling smoothly with
// only the rows in view in the page.
import { expect, test, type Page } from '../support/test.ts'
import type { DesignInput } from '@dazbee/schema'
import { writeOutput } from '../support/editor.ts'
import { click, openStage, read } from '../support/stage.ts'

test.describe.configure({ timeout: 120_000 })

/** A row's height in the panel, in pixels (LAYER_ROW in components/editor/layers-panel.tsx). */
const ROW = 36

const rect = (x: number, y: number, width: number, height: number, color: string) =>
  ({ x, y, width, height, shape: { kind: 'rect' as const, cornerRadius: 16 }, fills: [{ type: 'solid' as const, color }] })

const design = (): DesignInput => ({
  meta: { schemaVersion: 2, designId: 'replaced-by-the-api', name: 'Layers panel', kind: 'single', primaryFormatId: 'sq' },
  formats: { sq: { name: 'Square', width: 1080, height: 1080, order: 'a0' } },
  pages: { p1: { name: 'Page 1', order: 'a0', fills: [{ type: 'solid', color: '#FFFFFFFF' }] } },
  nodes: {
    backdrop: { type: 'graphic', parentId: 'p1', index: 'a0', name: 'Backdrop', props: rect(40, 40, 1000, 1000, '#F4EDE4FF') },
    card: { type: 'group', parentId: 'p1', index: 'a1', name: 'Card', props: { x: 120, y: 620, width: 520, height: 300 } },
    c1: { type: 'graphic', parentId: 'card', index: 'a0', name: 'Card back', props: rect(120, 620, 520, 300, '#14213DFF') },
    c2: { type: 'graphic', parentId: 'card', index: 'a1', name: 'Card stripe', props: rect(160, 660, 440, 60, '#FCA311FF') },
    box: { type: 'graphic', parentId: 'p1', index: 'a2', name: 'Box', props: rect(120, 120, 400, 300, '#E0262BFF') },
    dot: { type: 'graphic', parentId: 'p1', index: 'a3', name: 'Dot', props: { ...rect(700, 680, 200, 200, '#1F9D55FF'), shape: { kind: 'ellipse' as const } } },
  },
  overrides: {},
})

const tree = (page: Page) => page.getByRole('tree')
const row = (page: Page, name: string) => tree(page).getByRole('treeitem').filter({ has: page.locator(`text="${name}"`) })
/** The rows' names as the panel lists them, top to bottom. */
const listed = (page: Page) => tree(page).getByRole('treeitem').evaluateAll((rows) => rows
  .sort((a, b) => Number.parseFloat((a as HTMLElement).style.top) - Number.parseFloat((b as HTMLElement).style.top))
  .map((r) => `${'  '.repeat(Number(r.getAttribute('aria-level')) - 1)}${r.textContent}`))
const node = async (page: Page, id: string) => (await read(page)).nodes[id] as unknown as { parentId: string; name: string; lock?: Record<string, boolean> }
/** The colour the export render draws at a design pixel. */
const colourAt = (page: Page, x: number, y: number) => page.evaluate(([x, y]) => {
  const pixels = window.dazbee?.exportPixels()
  const at = (y * 1080 + x) * 4
  return pixels ? [pixels[at], pixels[at + 1], pixels[at + 2]] : null
}, [x, y] as const)

async function openLayers(page: Page) {
  await page.getByRole('button', { name: 'Layers', exact: true }).click()
  await expect(tree(page)).toBeVisible()
}

test('the panel and the stage select together; drag into a group, rename, lock and hide', async ({ browser }) => {
  const { page, errors } = await openStage(browser, design())
  await openLayers(page)
  expect(await listed(page)).toEqual(['Dot', 'Box', 'Card', 'Backdrop'])
  await expect(row(page, 'Card')).toHaveAttribute('aria-expanded', 'false')

  // Select in the panel: the stage selects. Select on the stage: the panel follows.
  await row(page, 'Dot').click()
  expect(await page.evaluate(() => window.dazbee?.selection())).toEqual(['dot'])
  await expect(row(page, 'Dot')).toHaveAttribute('aria-selected', 'true')
  await click(page, 480, 380)
  await expect(row(page, 'Box')).toHaveAttribute('aria-selected', 'true')
  await expect(row(page, 'Dot')).toHaveAttribute('aria-selected', 'false')
  // A layer inside a group selected on the stage opens its group in the panel.
  await page.evaluate(() => window.dazbee?.select(['c2']))
  await expect(row(page, 'Card')).toHaveAttribute('aria-expanded', 'true')
  await expect(row(page, 'Card stripe')).toHaveAttribute('aria-selected', 'true')
  await expect.poll(() => listed(page)).toEqual(['Dot', 'Box', 'Card', '  Card stripe', '  Card back', 'Backdrop'])
  writeOutput('layers-0-tree.png', await page.screenshot())

  // Drag Dot onto the middle of Card: it goes inside, on top, and the group grows to hold it.
  const before = await page.evaluate(() => window.dazbee?.boxOf('card'))
  const target = await row(page, 'Card').boundingBox()
  await row(page, 'Dot').dragTo(row(page, 'Card'), { targetPosition: { x: 60, y: (target?.height ?? ROW) / 2 } })
  await expect.poll(async () => (await node(page, 'dot')).parentId).toBe('card')
  await expect.poll(() => listed(page)).toEqual(['Box', 'Card', '  Dot', '  Card stripe', '  Card back', 'Backdrop'])
  const after = await page.evaluate(() => window.dazbee?.boxOf('card'))
  expect(after).toEqual({ x: 120, y: 620, width: 780, height: 300 })
  expect(before).toEqual({ x: 120, y: 620, width: 520, height: 300 })
  // The stage redraws the group with the dot in it: selecting the group, its box takes in the dot.
  await row(page, 'Card').click()
  await page.evaluate(() => window.dazbee?.drawn())
  writeOutput('layers-1-dragged-into-group.png', await page.screenshot())
  // Dot drawn where it was: moving it in changed only where it sits in the tree.
  expect(await colourAt(page, 800, 780)).toEqual([31, 157, 85])
  // One undo puts it back.
  await page.evaluate(() => window.dazbee?.perform('undo'))
  await expect.poll(async () => (await node(page, 'dot')).parentId).toBe('p1')
  expect(await page.evaluate(() => window.dazbee?.boxOf('card'))).toEqual(before)

  // Drag Backdrop above Box: reordered among its siblings.
  const box = await row(page, 'Box').boundingBox()
  await row(page, 'Backdrop').dragTo(row(page, 'Box'), { targetPosition: { x: 60, y: 3 } })
  await expect.poll(() => listed(page)).toEqual(['Dot', 'Backdrop', 'Box', 'Card', '  Card stripe', '  Card back'])
  expect(box).not.toBeNull()
  // The backdrop now covers the box: the stage draws it on top.
  expect(await colourAt(page, 300, 200)).toEqual([244, 237, 228])
  await page.evaluate(() => window.dazbee?.perform('undo'))
  await expect.poll(() => listed(page)).toEqual(['Dot', 'Box', 'Card', '  Card stripe', '  Card back', 'Backdrop'])

  // Rename with a double-click.
  await row(page, 'Box').dblclick()
  const field = tree(page).getByRole('textbox', { name: 'Name of Box' })
  await expect(field).toBeFocused()
  await field.fill('Hero panel')
  writeOutput('layers-2-rename.png', await page.screenshot())
  await field.press('Enter')
  await expect.poll(async () => (await node(page, 'box')).name).toBe('Hero panel')
  await expect(row(page, 'Hero panel')).toBeFocused()

  // Lock: every flag, shown on the row; dragging the box on the stage leaves it where it was.
  await row(page, 'Hero panel').hover()
  await row(page, 'Hero panel').getByRole('button', { name: 'Lock Hero panel' }).click()
  await expect.poll(async () => (await node(page, 'box')).lock).toEqual({ move: true, resize: true, content: true, style: true, delete: true })
  await expect(row(page, 'Hero panel').getByRole('button', { name: 'Unlock Hero panel' })).toHaveAttribute('aria-pressed', 'true')

  // Hide: the stage no longer draws it; Show brings it back.
  expect(await colourAt(page, 300, 200)).toEqual([224, 38, 43])
  await row(page, 'Hero panel').getByRole('button', { name: 'Hide Hero panel' }).click()
  await expect.poll(() => colourAt(page, 300, 200)).toEqual([244, 237, 228])
  await page.mouse.move(900, 900)
  await page.evaluate(() => window.dazbee?.drawn())
  writeOutput('layers-3-locked-hidden.png', await page.screenshot())
  await row(page, 'Hero panel').getByRole('button', { name: 'Show Hero panel' }).click()
  await expect.poll(() => colourAt(page, 300, 200)).toEqual([224, 38, 43])
  expect(errors).toEqual([])
})

test('keyboard only: move through the tree, select, rename, lock, hide and move a layer into a group', async ({ browser }) => {
  const { page, errors } = await openStage(browser, design())
  await page.getByRole('button', { name: 'Layers', exact: true }).focus()
  await page.keyboard.press('Enter')
  await expect(tree(page)).toBeVisible()
  // Tab into the tree: it is one stop, on the first row.
  for (let i = 0; i < 8 && !(await page.evaluate(() => document.activeElement?.getAttribute('role') === 'treeitem')); i++) await page.keyboard.press('Tab')
  await expect(row(page, 'Dot')).toBeFocused()

  // Down selects the next row as it moves there.
  await page.keyboard.press('ArrowDown')
  await expect(row(page, 'Box')).toBeFocused()
  expect(await page.evaluate(() => window.dazbee?.selection())).toEqual(['box'])
  // The arrows moved the focus, not the box.
  expect((await read(page)).nodes.box?.props).toMatchObject({ x: 120, y: 120 })

  // Down to Card, Right opens it, Right again goes to its first child.
  await page.keyboard.press('ArrowDown')
  await expect(row(page, 'Card')).toBeFocused()
  await page.keyboard.press('ArrowRight')
  await expect(row(page, 'Card')).toHaveAttribute('aria-expanded', 'true')
  await page.keyboard.press('ArrowRight')
  await expect(row(page, 'Card stripe')).toBeFocused()
  // Left goes back to the group, and Left again closes it.
  await page.keyboard.press('ArrowLeft')
  await expect(row(page, 'Card')).toBeFocused()
  await page.keyboard.press('ArrowLeft')
  await expect(row(page, 'Card')).toHaveAttribute('aria-expanded', 'false')

  // Enter renames.
  await page.keyboard.press('ArrowUp')
  await expect(row(page, 'Box')).toBeFocused()
  await page.keyboard.press('Enter')
  await page.keyboard.type('Headline plate')
  await page.keyboard.press('Enter')
  await expect.poll(async () => (await node(page, 'box')).name).toBe('Headline plate')
  await expect(row(page, 'Headline plate')).toBeFocused()

  // The stage's own shortcuts act on the selected row: lock, then hide.
  await page.keyboard.press('ControlOrMeta+Shift+L')
  await expect.poll(async () => (await node(page, 'box')).lock?.move).toBe(true)
  await page.keyboard.press('ControlOrMeta+Shift+L')
  await expect.poll(async () => (await node(page, 'box')).lock).toBeUndefined()
  await page.keyboard.press('ControlOrMeta+Shift+H')
  await expect.poll(() => colourAt(page, 300, 200)).toEqual([244, 237, 228])
  await expect(row(page, 'Headline plate').getByRole('button', { name: 'Show Headline plate' })).toHaveAttribute('aria-pressed', 'true')
  await page.keyboard.press('ControlOrMeta+Shift+H')
  await expect.poll(() => colourAt(page, 300, 200)).toEqual([224, 38, 43])

  // Alt+Down moves it below Card; Alt+Right (Card is now above it) moves it into Card, on top.
  await page.keyboard.press('Alt+ArrowDown')
  await expect.poll(() => listed(page)).toEqual(['Dot', 'Card', 'Headline plate', 'Backdrop'])
  await expect(row(page, 'Headline plate')).toBeFocused()
  await page.keyboard.press('Alt+ArrowUp')
  await page.keyboard.press('Alt+ArrowUp')
  await expect.poll(() => listed(page)).toEqual(['Headline plate', 'Dot', 'Card', 'Backdrop'])
  await page.keyboard.press('Alt+ArrowDown')
  await page.keyboard.press('Alt+ArrowDown')
  await expect.poll(() => listed(page)).toEqual(['Dot', 'Card', 'Headline plate', 'Backdrop'])
  await page.keyboard.press('Alt+ArrowRight')
  await expect.poll(async () => (await node(page, 'box')).parentId).toBe('card')
  await expect.poll(() => listed(page)).toEqual(['Dot', 'Card', '  Headline plate', '  Card stripe', '  Card back', 'Backdrop'])
  await expect(row(page, 'Headline plate')).toBeFocused()
  writeOutput('layers-4-keyboard.png', await page.screenshot())
  // Alt+Left takes it out again, just above the group.
  await page.keyboard.press('Alt+ArrowLeft')
  await expect.poll(async () => (await node(page, 'box')).parentId).toBe('p1')
  await expect.poll(() => listed(page)).toEqual(['Dot', 'Headline plate', 'Card', '  Card stripe', '  Card back', 'Backdrop'])
  // Delete, from the panel, deletes the selected layer like on the stage.
  await page.keyboard.press('Delete')
  await expect.poll(async () => Object.keys((await read(page)).nodes)).not.toContain('box')
  expect(errors).toEqual([])
})

test('300 layers: only the rows in view are in the page, and scrolling costs the panel little', async ({ browser }) => {
  const nodes: DesignInput['nodes'] = {}
  for (let i = 0; i < 300; i++) {
    const index = `a${String(i).padStart(3, '0')}`
    nodes[`n${i}`] = { type: 'graphic', parentId: 'p1', index, name: `Layer ${i + 1}`, props: rect(20 + (i % 20) * 52, 20 + Math.floor(i / 20) * 70, 44, 60, i % 2 ? '#14213DFF' : '#FCA311FF') }
  }
  const { page, errors } = await openStage(browser, { ...design(), nodes })
  await openLayers(page)
  const scroller = page.getByTestId('layers-scroller')
  const rendered = await tree(page).getByRole('treeitem').count()
  expect(rendered).toBeLessThan(60)
  expect(await tree(page).evaluate((el) => el.getBoundingClientRect().height)).toBe(300 * ROW)

  // Every frame's time for a while, in ms, sorted.
  const frameTimes = (ms: number) => page.evaluate((ms) => new Promise<number[]>((resolve) => {
    const frames: number[] = []
    let last = performance.now()
    const start = last
    const tick = (now: number) => {
      frames.push(now - last)
      last = now
      if (now - start < ms) requestAnimationFrame(tick)
      else resolve(frames.slice(1).sort((a, b) => a - b))
    }
    requestAnimationFrame(tick)
  }), ms)
  const at = (frames: number[], q: number) => frames[Math.min(frames.length - 1, Math.floor(frames.length * q))] ?? Infinity
  // The page at rest with the panel open: what this machine's frames take with nothing moving. In
  // headless Chromium the frosted panels are composited in software, which is most of a frame here.
  await scroller.hover()
  const idle = await frameTimes(1000)
  // Script time in every long frame (over 50 ms) while scrolling, from the long animation frame
  // timings: what the panel itself costs, apart from compositing.
  await page.evaluate(() => {
    const seen: number[] = []
    ;(window as unknown as { scripts: number[] }).scripts = seen
    new PerformanceObserver((list) => {
      for (const frame of list.getEntries() as unknown as { scripts: { duration: number }[] }[]) seen.push(frame.scripts.reduce((sum, s) => sum + s.duration, 0))
    }).observe({ type: 'long-animation-frame' })
  })
  // Then scroll top to bottom and back with the wheel.
  const timing = frameTimes(2500)
  for (let i = 0; i < 40; i++) {
    await page.mouse.wheel(0, i < 20 ? 420 : -420)
    await page.waitForTimeout(30)
  }
  const frames = await timing
  const scripts = (await page.evaluate(() => (window as unknown as { scripts: number[] }).scripts)).sort((a, b) => a - b)
  const stats = {
    layers: 300, rowsInPage: rendered,
    idle: { frames: idle.length, medianMs: at(idle, 0.5), p95Ms: at(idle, 0.95) },
    scrolling: { frames: frames.length, medianMs: at(frames, 0.5), p95Ms: at(frames, 0.95), worstMs: frames.at(-1) },
    scriptPerLongFrame: { frames: scripts.length, medianMs: at(scripts, 0.5), p95Ms: scripts.length ? at(scripts, 0.95) : 0, worstMs: scripts.at(-1) ?? 0 },
  }
  console.log('layers panel scroll', JSON.stringify(stats))
  writeOutput('layers-scroll-300.json', JSON.stringify(stats, null, 2))
  test.info().annotations.push({ type: 'scroll 300 layers', description: JSON.stringify(stats) })
  // The panel's own work stays within one 60 fps frame (16.7 ms) in 95 frames of 100, however long
  // the machine takes to composite them; a busy machine's odd collection pause is the rest.
  expect(stats.scriptPerLongFrame.p95Ms).toBeLessThan(16.7)
  // And the rows followed the scroll: back at the top, the first row shows.
  await expect(row(page, 'Layer 300')).toBeInViewport()

  // End reaches the last row, which is then in the page and in view.
  await tree(page).getByRole('treeitem').first().focus()
  await page.keyboard.press('End')
  await expect(row(page, 'Layer 1')).toBeFocused()
  await expect(row(page, 'Layer 1')).toBeInViewport()
  expect(await tree(page).getByRole('treeitem').count()).toBeLessThan(60)
  writeOutput('layers-5-300-layers.png', await page.screenshot())
  expect(errors).toEqual([])
})
