// Driving the editor stage with real pointer and keyboard input, for the selection and group
// checks (#40, #41): drags with modifiers pressed as a hand would, shortcut presses from the one
// table, and reading layers back from the document.
import { pressFor, type ShortcutAction } from '@dazbee/editor/shortcuts'
import type { DesignInput } from '@dazbee/schema'
import type { Browser, Page } from '@playwright/test'
import { designOf, openTabs, placed, screenPoint } from './editor.ts'
import { seed } from './seed.ts'

/**
 * Opens a fresh copy of a design in one tab, 1440 × 1000, with the camera where design pixels in
 * steps of 5 land on whole screen pixels, so drags measure exactly.
 */
export async function openStage(browser: Browser, content: DesignInput) {
  const { tabs, errors } = await openTabs(browser, 1, await seed(content))
  const page = tabs[0] as Page
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.evaluate(() => window.dazbee?.setCamera({ x: 100, y: 60, zoom: 0.8 }))
  await page.evaluate(() => window.dazbee?.drawn())
  return { page, errors }
}

export interface Design {
  nodes: Record<string, { parentId: string; index: string; lock?: Record<string, boolean>; props: Record<string, unknown> }>
  overrides: Record<string, Record<string, Record<string, unknown>>>
}
export const read = async (page: Page) => JSON.parse(await designOf(page)) as Design
export const props = async (page: Page, id: string) => placed(await read(page), id, 'sq') as { x: number; y: number; width: number; height: number; rotation?: number; visible?: boolean }
export const selection = (page: Page) => page.evaluate(() => window.dazbee?.selection() ?? [])
/** Presses an action's shortcut and waits for the redraw, so the handles stand where the box now is. */
export const press = async (page: Page, action: ShortcutAction) => {
  await page.keyboard.press(pressFor(action))
  await page.evaluate(() => window.dazbee?.drawn())
}
export const order = async (page: Page) => Object.entries((await read(page)).nodes)
  .filter(([, n]) => n.parentId === 'p1').sort(([a, x], [b, y]) => (x.index < y.index ? -1 : x.index > y.index ? 1 : a < b ? -1 : 1)).map(([id]) => id)

/**
 * Drags with the mouse between two design pixels of the square, in a few steps like a hand would.
 * Modifier keys go down once the drag has started, as a designer presses Shift mid-drag; with
 * `before` they are held from the press, as for a Shift marquee that adds to the selection.
 */
export async function drag(page: Page, from: { x: number; y: number }, to: { x: number; y: number }, modifiers: ('Shift' | 'Alt')[] = [], before = false) {
  const a = await screenPoint(page, from.x, from.y)
  const b = await screenPoint(page, to.x, to.y)
  await dragScreen(page, a, b, modifiers, before)
}
export async function dragScreen(page: Page, a: { x: number; y: number }, b: { x: number; y: number }, modifiers: ('Shift' | 'Alt')[] = [], before = false) {
  await page.mouse.move(a.x, a.y)
  if (before) for (const key of modifiers) await page.keyboard.down(key)
  await page.mouse.down()
  await page.mouse.move((a.x + b.x) / 2, (a.y + b.y) / 2)
  if (!before) for (const key of modifiers) await page.keyboard.down(key)
  await page.mouse.move(b.x, b.y, { steps: 6 })
  await page.mouse.up()
  for (const key of modifiers) await page.keyboard.up(key)
  await page.evaluate(() => window.dazbee?.drawn())
}
export async function click(page: Page, x: number, y: number, modifiers: 'Shift'[] = []) {
  const at = await screenPoint(page, x, y)
  for (const key of modifiers) await page.keyboard.down(key)
  await page.mouse.click(at.x, at.y)
  for (const key of modifiers) await page.keyboard.up(key)
  await page.evaluate(() => window.dazbee?.drawn())
}
/** Where a handle of the selection box is on screen now. */
export async function handle(page: Page, which: string) {
  const box = await page.locator(`.selection .handle[data-handle="${which}"]`).boundingBox()
  if (!box) throw new Error(`no ${which} handle`)
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
}
export const zoomOf = (page: Page) => page.evaluate(() => window.dazbee?.camera().zoom ?? 1)

/**
 * Opens every folded row of the Details card and the effects' Fine-tune, as a person clicks them,
 * so a check can reach every number.
 */
export async function unfoldAll(page: Page) {
  const closed = page.locator('[data-testid="details-card"] [data-fold][aria-expanded="false"], [data-testid="effects-card"] button[aria-expanded="false"]:not([role="combobox"])')
  while (await closed.count() > 0) await closed.first().click()
}
