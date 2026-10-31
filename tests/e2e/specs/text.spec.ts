// Rich text editing (#47) with real pointer and keyboard input: a double-clicked word made bold;
// a range across an Arabic and Latin boundary whose boxes sit where the caret and word selection
// say; the text tool, line breaks, copy, cut and paste; each typing session one undo step.
import { expect, test, type Page } from '../support/test.ts'
import type { DesignInput } from '@razzlr/schema'
import { exportHashOf, writeOutput } from '../support/editor.ts'
import { openStage, press, read, selection } from '../support/stage.ts'

test.describe.configure({ timeout: 120_000 })

const design = (): DesignInput => ({
  meta: { schemaVersion: 2, designId: 'replaced-by-the-api', name: 'Rich text', kind: 'single', primaryFormatId: 'sq' },
  formats: { sq: { name: 'Square', width: 1080, height: 1080, order: 'a0' } },
  pages: { p1: { name: 'Page 1', order: 'a0', fills: [{ type: 'solid', color: '#FFF8F0FF' }] } },
  nodes: {
    body: {
      type: 'text', parentId: 'p1', index: 'a0', name: 'Body',
      props: { x: 80, y: 100, width: 920, height: 90, text: 'Fresh roast every morning', style: { fontFamily: 'Noto Sans', fontSize: 64, color: '#1F2329FF' } },
    },
    mixed: {
      type: 'text', parentId: 'p1', index: 'a1', name: 'Mixed',
      props: { x: 80, y: 300, width: 920, height: 130, text: 'خصم Razzlr اليوم', style: { fontFamily: 'Noto Naskh Arabic', fontSize: 80, color: '#1F2329FF' } },
    },
  },
  overrides: {},
})

type Rect = { x: number; y: number; width: number; height: number }
const textRuns = async (page: Page, id: string) => ((await read(page)).nodes[id]?.props as { runs: unknown[] }).runs
const textOf = async (page: Page, id: string) => ((await read(page)).nodes[id]?.props as { text: string }).text
const drawn = (page: Page) => page.evaluate(() => window.razzlr?.drawn())
const at = (page: Page, x: number, y: number) => page.evaluate(({ x, y }) => window.razzlr?.screenPoint(x, y), { x, y }) as Promise<{ x: number; y: number }>
const boxes = async (page: Page) => (await page.locator('.text-selection').evaluateAll((els) => els.map((el) => el.getBoundingClientRect().toJSON() as Rect)))
  .sort((a, b) => a.x - b.x)
const caretX = async (page: Page) => {
  const box = await page.locator('.caret').boundingBox()
  if (!box) throw new Error('no caret')
  return box.x + box.width / 2
}
/** Double-clicks a design point and waits for the redraw. */
async function dblclick(page: Page, x: number, y: number) {
  const p = await at(page, x, y)
  await page.mouse.dblclick(p.x, p.y)
  await drawn(page)
}
/** Presses keys while typing, then waits for the redraw. */
async function keys(page: Page, ...pressed: string[]) {
  for (const key of pressed) await page.keyboard.press(key)
  await drawn(page)
}
/** Puts the caret at an offset: to the start, then right one grapheme at a time. */
async function caretAtOffset(page: Page, offset: number) {
  await keys(page, 'ControlOrMeta+A', 'ArrowLeft', ...Array<string>(offset).fill('ArrowRight'))
}

test('a double-clicked word is made bold with the keyboard, one undo step with the typing', async ({ browser }) => {
  const { page, errors } = await openStage(browser, design())
  const before = await exportHashOf(page)
  // Into the text, then a double click on "roast" selects it.
  await dblclick(page, 300, 140)
  await expect(page.locator('.caret')).toBeVisible()
  await dblclick(page, 300, 140)
  await expect(page.locator('.text-selection')).toHaveCount(1)
  writeOutput('text-0-word.png', await page.screenshot({ animations: 'disabled' }))
  await keys(page, 'ControlOrMeta+B')
  expect(await textRuns(page, 'body')).toEqual([{ start: 6, end: 11, style: { fontWeight: 700 } }])
  // Underline too: the run keeps both.
  await keys(page, 'ControlOrMeta+U')
  expect(await textRuns(page, 'body')).toEqual([{ start: 6, end: 11, style: { fontWeight: 700, underline: true } }])
  const bold = await exportHashOf(page)
  expect(bold).not.toBe(before)
  writeOutput('text-1-bold.png', await page.screenshot({ animations: 'disabled' }))
  // A second press takes bold off again.
  await keys(page, 'ControlOrMeta+B')
  expect(await textRuns(page, 'body')).toEqual([{ start: 6, end: 11, style: { fontWeight: 400, underline: true } }])
  await keys(page, 'ControlOrMeta+B', 'Escape')
  expect(await textRuns(page, 'body')).toEqual([{ start: 6, end: 11, style: { fontWeight: 700, underline: true } }])
  expect(await exportHashOf(page)).toBe(bold)
  // The whole typing session is one undo step.
  await press(page, 'undo')
  await drawn(page)
  expect(await textRuns(page, 'body')).toEqual([])
  expect(await exportHashOf(page)).toBe(before)
  expect(errors).toEqual([])
})

test('a range across an Arabic and Latin boundary has a box for each direction, where the caret and word selection put them', async ({ browser }) => {
  const { page, errors } = await openStage(browser, design())
  // "خصم Razzlr اليوم": Arabic 0–3, a space, "Razzlr" 4–10, a space, Arabic 11–16.
  await dblclick(page, 900, 360)
  await expect(page.locator('.caret')).toBeVisible()
  // Where the carets inside each word are: after "خ" (1), after "Raz" (7), and at Razzlr's end (10).
  await caretAtOffset(page, 1)
  const afterKha = await caretX(page)
  await caretAtOffset(page, 7)
  const afterRaz = await caretX(page)
  await caretAtOffset(page, 10)
  const razzlrEnd = await caretX(page)
  // A double click on Razzlr (just left of the caret after "Raz") selects just it: one
  // left-to-right box ending where its caret is.
  const line = await page.locator('.caret').boundingBox()
  if (!line) throw new Error('no caret')
  await page.mouse.dblclick(afterRaz - 6, line.y + line.height / 2)
  await drawn(page)
  const word = await boxes(page)
  expect(word).toHaveLength(1)
  const razzlr = word[0] as Rect
  expect(razzlr.x + razzlr.width).toBeCloseTo(razzlrEnd, 0)
  expect(razzlr.x).toBeLessThan(afterRaz)

  // From after "خ", Shift+Right six times: "صم", the space, then "Raz".
  await caretAtOffset(page, 1)
  await keys(page, ...Array<string>(6).fill('Shift+ArrowRight'))
  const range = await boxes(page)
  writeOutput('text-2-bidi.png', await page.screenshot({ animations: 'disabled' }))
  expect(range).toHaveLength(2)
  const [latin, arabic] = range as [Rect, Rect]
  // The Latin box starts where Razzlr starts and ends after "Raz"; the Arabic one runs from the
  // end of Razzlr, over the space, to after "خ". They meet and don't overlap.
  expect(latin.x).toBeCloseTo(razzlr.x, 0)
  expect(latin.x + latin.width).toBeCloseTo(afterRaz, 0)
  expect(arabic.x).toBeCloseTo(razzlrEnd, 0)
  expect(arabic.x + arabic.width).toBeCloseTo(afterKha, 0)
  expect(latin.x + latin.width).toBeLessThanOrEqual(arabic.x + 0.5)
  // Bold on it reaches exactly those characters.
  await keys(page, 'ControlOrMeta+B')
  expect(await textRuns(page, 'mixed')).toEqual([{ start: 1, end: 7, style: { fontWeight: 700 } }])
  writeOutput('text-3-bidi-bold.png', await page.screenshot({ animations: 'disabled' }))
  expect(errors).toEqual([])
})

test('the text tool makes text by a click or a box, with line breaks, copy, cut and paste', async ({ browser }) => {
  const { page, errors } = await openStage(browser, design())
  const start = new Set(Object.keys((await read(page)).nodes))
  const before = await exportHashOf(page)
  await press(page, 'toolText')
  await expect(page.locator('[role="toolbar"] [data-tool="text"]')).toHaveAttribute('aria-pressed', 'true')
  const click = await at(page, 100, 600)
  await page.mouse.click(click.x, click.y)
  await drawn(page)
  await expect(page.locator('.caret')).toBeVisible()
  await page.keyboard.type('Hello')
  await keys(page, 'Enter')
  await page.keyboard.type('World')
  await drawn(page)
  const [id = ''] = Object.keys((await read(page)).nodes).filter((n) => !start.has(n))
  expect(await textOf(page, id)).toBe('Hello\nWorld')
  // Text made by a click grows as it is typed: its box is as big as its words.
  const grown = (await read(page)).nodes[id]?.props as { boxMode: string; width: number; height: number; x: number; y: number }
  expect(grown).toMatchObject({ boxMode: 'autoWidth', x: 100, y: 600 })
  expect(grown.width).toBeGreaterThan(100)
  expect(grown.height).toBeGreaterThan(100)
  expect(await selection(page)).toEqual([id])

  // Copy "World" (a double click), paste it at the end; cut the last three letters.
  const p = (await read(page)).nodes[id]?.props as { x: number; y: number; width: number; height: number }
  await dblclick(page, p.x + 40, p.y + p.height * 0.75)
  await expect(page.locator('.text-selection')).toHaveCount(1)
  await keys(page, 'ControlOrMeta+C', 'End', 'ControlOrMeta+V')
  expect(await textOf(page, id)).toBe('Hello\nWorldWorld')
  await keys(page, 'Shift+ArrowLeft', 'Shift+ArrowLeft', 'Shift+ArrowLeft', 'ControlOrMeta+X')
  expect(await textOf(page, id)).toBe('Hello\nWorldWo')
  await keys(page, 'ArrowUp', 'Home', 'ControlOrMeta+V')
  expect(await textOf(page, id)).toBe('rldHello\nWorldWo')
  writeOutput('text-4-tool.png', await page.screenshot({ animations: 'disabled' }))
  await keys(page, 'Escape')

  // Making the text and typing into it was one undo step.
  await press(page, 'undo')
  await drawn(page)
  expect((await read(page)).nodes[id]).toBeUndefined()
  expect(await exportHashOf(page)).toBe(before)

  // A drag makes a box of that size that wraps; left empty, it goes again.
  await press(page, 'toolText')
  const from = await at(page, 100, 700)
  const to = await at(page, 400, 800)
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  await page.mouse.move(to.x, to.y, { steps: 6 })
  await page.mouse.up()
  await drawn(page)
  const [boxed = ''] = Object.keys((await read(page)).nodes).filter((n) => !start.has(n))
  expect((await read(page)).nodes[boxed]?.props).toMatchObject({ boxMode: 'fixed', x: 100, y: 700, width: 300, height: 100 })
  await keys(page, 'Escape')
  expect((await read(page)).nodes[boxed]).toBeUndefined()
  expect(await exportHashOf(page)).toBe(before)
  expect(errors).toEqual([])
})
