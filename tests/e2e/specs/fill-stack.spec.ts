// A layer's fills as a stack, with real pointer and keyboard input: the list shows the top coat
// first; + puts a see-through colour on top of a photo; its swatch turns it into a linear gradient
// whose stop is edited; a drag swaps the two; the eye hides one. The stage and a PNG export show the
// same, and the browser's export matches Node's to the pixel.
import { createHash } from 'node:crypto'
import { expect, test, type Page } from '../support/test.ts'
import { FALLBACK_FAMILIES } from '@dazbee/fonts'
import { loadFontFiles } from '@dazbee/fonts/node'
import { renderDesign } from '@dazbee/renderer'
import { loadCanvasKit } from '@dazbee/renderer/node'
import { AssetLink, type DesignInput } from '@dazbee/schema'
import { api, photo, upload } from '../support/assets.ts'
import { designOf, exportHashOf, screenPoint, writeOutput } from '../support/editor.ts'
import { click, openStage, press, read } from '../support/stage.ts'

test.describe.configure({ timeout: 120_000 })

const design = (assetId: string): DesignInput => ({
  meta: { schemaVersion: 3, designId: 'replaced-by-the-api', name: 'Fill stack', kind: 'single', primaryFormatId: 'sq' },
  formats: { sq: { name: 'Square', width: 1080, height: 1080, order: 'a0' } },
  pages: { p1: { name: 'Page 1', order: 'a0', fills: [{ type: 'solid', color: '#FFF8F0FF' }] } },
  nodes: {
    card: { type: 'graphic', parentId: 'p1', index: 'a0', name: 'Card', props: { x: 540, y: 140, width: 440, height: 440, shape: { kind: 'rect', cornerRadius: 32 }, fills: [{ type: 'image', assetId, fit: 'fill' }] } },
  },
  overrides: {},
})

type Fill = { type: string; color?: string; visible?: boolean; stops?: { offset: number; color: string }[] }
const fillsOf = async (page: Page) => ((await read(page)).nodes.card?.props.fills ?? []) as Fill[]
const undo = async (page: Page) => {
  await press(page, 'undo')
  await page.evaluate(() => window.dazbee?.drawn())
}
/** One pixel of the stage, and of the PNG the editor exports, at a design pixel of the square. */
async function stageAndExport(page: Page, x: number, y: number) {
  const at = await screenPoint(page, x, y)
  await page.evaluate(() => window.dazbee?.drawn())
  // What the screen shows there: a one-pixel screenshot, decoded in the page.
  const shot = (await page.screenshot({ clip: { x: Math.round(at.x), y: Math.round(at.y), width: 1, height: 1 }, animations: 'disabled' })).toString('base64')
  const stage = await page.evaluate(async (png) => {
    const bitmap = await createImageBitmap(await (await fetch(`data:image/png;base64,${png}`)).blob())
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
    const context = canvas.getContext('2d')
    context?.drawImage(bitmap, 0, 0)
    return [...(context?.getImageData(0, 0, 1, 1).data ?? [])].slice(0, 3)
  }, shot)
  const exported = await page.evaluate(async ({ x, y }) => {
    const file = await window.dazbee?.exportFiles({ pageIds: ['p1'], formatIds: ['sq'], type: 'png' })
    const bitmap = await createImageBitmap(new Blob([new Uint8Array(file?.bytes ?? [])], { type: 'image/png' }))
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
    const context = canvas.getContext('2d')
    context?.drawImage(bitmap, 0, 0)
    return [...(context?.getImageData(x, y, 1, 1).data ?? [])].slice(0, 3)
  }, { x, y })
  return { stage, exported }
}

test('a gradient over a photo: added on top, a stop edited, the two reordered, one hidden; stage and export agree', async ({ browser }) => {
  const asset = await upload(photo)
  const { page, errors } = await openStage(browser, design(asset.id))
  await click(page, 760, 360)
  const card = page.getByTestId('fill-card')
  await card.locator('[data-fold]').click()

  // + puts a see-through colour on top; the list shows it first.
  await card.getByRole('button', { name: 'Add fill' }).click()
  await expect.poll(async () => (await fillsOf(page)).map((f) => f.type)).toEqual(['image', 'solid'])
  await expect(card.locator('[data-row="1"]')).toHaveAttribute('data-item', 'fills-1')
  await expect(card.locator('[data-row="1"] [data-paint]')).toHaveAttribute('data-paint', 'solid')

  // Its swatch turns it into a linear gradient, which keeps its colour as the first stop.
  await card.locator('[data-row="1"]').getByTestId('paint-swatch').click()
  const editor = page.getByTestId('paint-editor')
  await editor.getByRole('radio', { name: 'Linear gradient' }).click()
  await expect.poll(async () => (await fillsOf(page))[1]?.type).toBe('linear')
  // The second stop: pink, half see-through.
  await editor.locator('[data-stop="1"]').click()
  await editor.getByRole('textbox', { name: 'Stop 2 hex' }).fill('FF2E7E')
  await editor.getByRole('textbox', { name: 'Stop 2 hex' }).press('Enter')
  await editor.getByRole('textbox', { name: 'Stop 2 opacity' }).fill('70')
  await editor.getByRole('textbox', { name: 'Stop 2 opacity' }).press('Enter')
  await expect.poll(async () => (await fillsOf(page))[1]?.stops?.[1]?.color).toBe('#FF2E7EB3')
  // A click on the bar adds a stop there.
  const bar = await editor.getByTestId('gradient-bar').boundingBox()
  if (!bar) throw new Error('no bar')
  await page.mouse.click(bar.x + bar.width * 0.5, bar.y + bar.height / 2)
  await expect.poll(async () => (await fillsOf(page))[1]?.stops?.length).toBe(3)
  await expect(editor.locator('[data-stop]')).toHaveCount(3)
  writeOutput('fill-stack-1-gradient-editor.png', await page.screenshot({ animations: 'disabled' }))
  await page.keyboard.press('Escape')
  await expect(editor).toBeHidden()
  const over = await stageAndExport(page, 940, 540)
  for (let c = 0; c < 3; c++) expect(Math.abs((over.stage[c] ?? 0) - (over.exported[c] ?? 0)), `channel ${c}: ${over.stage} vs ${over.exported}`).toBeLessThanOrEqual(8)
  writeOutput('fill-stack-2-gradient-over-photo.png', await page.screenshot({ animations: 'disabled' }))

  // A drag of the photo's row onto the gradient's puts the photo on top.
  const from = await card.locator('[data-row="2"]').getByTestId('row-grip').boundingBox()
  const to = await card.locator('[data-row="1"]').boundingBox()
  if (!from || !to) throw new Error('no rows')
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2)
  await page.mouse.down()
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2 - 4, { steps: 6 })
  await page.mouse.up()
  await expect.poll(async () => (await fillsOf(page)).map((f) => f.type)).toEqual(['linear', 'image'])
  await expect(card.locator('[data-row="1"] [data-paint]')).toHaveAttribute('data-paint', 'image')
  writeOutput('fill-stack-3-reordered.png', await page.screenshot({ animations: 'disabled' }))
  // The grip's arrow keys move it back.
  await card.locator('[data-row="1"]').getByTestId('row-grip').press('ArrowDown')
  await expect.poll(async () => (await fillsOf(page)).map((f) => f.type)).toEqual(['image', 'linear'])

  // The eye hides the gradient without deleting it; the photo shows alone again.
  await card.locator('[data-row="1"]').getByTestId('paint-visible').click()
  await expect.poll(async () => (await fillsOf(page))[1]?.visible).toBe(false)
  await page.evaluate(() => window.dazbee?.drawn())
  const hidden = await stageAndExport(page, 940, 540)
  for (let c = 0; c < 3; c++) expect(Math.abs((hidden.stage[c] ?? 0) - (hidden.exported[c] ?? 0))).toBeLessThanOrEqual(8)
  expect(hidden.exported).not.toEqual(over.exported)
  writeOutput('fill-stack-4-hidden.png', await page.screenshot({ animations: 'disabled' }))

  // The browser's export and Node's are the same pixels.
  await card.locator('[data-row="1"]').getByTestId('paint-visible').click()
  await expect.poll(async () => (await fillsOf(page))[1]?.visible).toBeUndefined()
  const browserHash = await exportHashOf(page)
  const doc = JSON.parse(await designOf(page)) as DesignInput
  const link = AssetLink.parse(await api(`/assets/${asset.id}`))
  const stored = new Uint8Array(await (await fetch(link.url)).arrayBuffer())
  const ck = await loadCanvasKit()
  const node = renderDesign(ck, doc, 'p1', 'sq', { fonts: loadFontFiles().map((f) => ({ family: f.family, bytes: f.bytes })), fallbackFamilies: [...FALLBACK_FAMILIES], images: { [asset.id]: stored } })
  expect(createHash('sha256').update(node.pixels).digest('hex')).toBe(browserHash)

  // Each change was one undo step: show, hide, the two moves, the stop added, the colour, the gradient, the add.
  for (let i = 0; i < 9; i++) await undo(page)
  expect(await fillsOf(page)).toEqual([{ type: 'image', assetId: asset.id, fit: 'fill', opacity: 1 }])
  expect(errors).toEqual([])
})

test('a stroke and the page background take the same paint editor: an angular stroke, a radial page', async ({ browser }) => {
  const asset = await upload(photo)
  const { page, errors } = await openStage(browser, design(asset.id))
  await click(page, 760, 360)
  const stroke = page.getByTestId('stroke-card')
  await stroke.locator('[data-fold]').click()
  await stroke.getByRole('button', { name: 'Add stroke' }).click()
  await stroke.locator('[data-row="1"]').getByTestId('paint-swatch').click()
  const editor = page.getByTestId('paint-editor')
  await editor.getByRole('radio', { name: 'Angular gradient' }).click()
  await expect.poll(async () => ((await read(page)).nodes.card?.props.strokes as { paint: Fill }[])[0]?.paint.type).toBe('angular')
  await editor.getByRole('textbox', { name: 'Gradient angle' }).fill('45')
  await editor.getByRole('textbox', { name: 'Gradient angle' }).press('Enter')
  await expect.poll(async () => ((await read(page)).nodes.card?.props.strokes as { paint: { angle?: number } }[])[0]?.paint.angle).toBe(45)
  await page.keyboard.press('Escape')

  // With nothing selected, the Page card's Fine-tune holds the page's background as a stack too.
  await press(page, 'deselect')
  const pageCard = page.getByTestId('page-card')
  await pageCard.getByRole('button', { name: 'Fine-tune' }).click()
  const layers = pageCard.getByTestId('page-fills')
  await layers.locator('[data-row="1"]').getByTestId('paint-swatch').click()
  await editor.getByRole('radio', { name: 'Radial gradient' }).click()
  await expect.poll(async () => ((await read(page)) as unknown as { pages: Record<string, { fills: Fill[] }> }).pages.p1?.fills[0]?.type).toBe('radial')
  await editor.getByRole('textbox', { name: 'Gradient size' }).fill('80')
  await editor.getByRole('textbox', { name: 'Gradient size' }).press('Enter')
  await page.keyboard.press('Escape')
  await page.evaluate(() => window.dazbee?.drawn())
  writeOutput('fill-stack-5-stroke-and-page.png', await page.screenshot({ animations: 'disabled' }))
  // A second background layer, an image, goes on top of the gradient.
  await layers.getByRole('button', { name: 'Add a background layer' }).click()
  await layers.locator('[data-row="1"]').getByTestId('paint-swatch').click()
  await editor.getByTestId('paint-image').click()
  const picker = page.getByTestId('paint-image-picker')
  await picker.locator(`li[data-asset="${asset.id}"] button`).click()
  await expect.poll(async () => ((await read(page)) as unknown as { pages: Record<string, { fills: Fill[] }> }).pages.p1?.fills.map((f) => f.type)).toEqual(['radial', 'image'])
  expect(errors).toEqual([])
})
