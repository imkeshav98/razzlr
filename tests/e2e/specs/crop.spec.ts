// Image fills on the stage (#48), with real pointer and keyboard input: Enter crops a photo, a drag
// moves the image inside its shape and a corner drag scales it, each one undo step, and the
// cropped export matches Node's pixel for pixel; and two layers made a mask in one key press.
import { createHash } from 'node:crypto'
import { expect, test, type Page } from '@playwright/test'
import { FALLBACK_FAMILIES } from '@razzlr/fonts'
import { loadFontFiles } from '@razzlr/fonts/node'
import { renderDesign } from '@razzlr/renderer'
import { loadCanvasKit } from '@razzlr/renderer/node'
import type { DesignInput } from '@razzlr/schema'
import { photo, upload } from '../support/assets.ts'
import { designOf, exportHashOf, screenPoint, writeOutput } from '../support/editor.ts'
import { click, drag, dragScreen, openStage, press, read, selection } from '../support/stage.ts'

test.describe.configure({ timeout: 120_000 })

const design = (assetId: string): DesignInput => ({
  meta: { schemaVersion: 2, designId: 'replaced-by-the-api', name: 'Crop', kind: 'single', primaryFormatId: 'sq' },
  formats: { sq: { name: 'Square', width: 1080, height: 1080, order: 'a0' } },
  pages: { p1: { name: 'Page 1', order: 'a0', fills: [{ type: 'solid', color: '#FFF6E8FF' }] } },
  nodes: {
    // A 1920 × 1200 photo filling a 600 square: shown at half size, 360 cut off each side.
    photo: {
      type: 'graphic', parentId: 'p1', index: 'a0', name: 'Photo',
      props: { x: 140, y: 140, width: 600, height: 600, shape: { kind: 'rect', cornerRadius: 40 }, fills: [{ type: 'image', assetId, fit: 'fill' }] },
    },
    // A disc under a poster, for the mask.
    disc: {
      type: 'graphic', parentId: 'p1', index: 'a1', name: 'Disc',
      props: { x: 800, y: 800, width: 200, height: 200, shape: { kind: 'ellipse' }, fills: [{ type: 'solid', color: '#15121AFF' }] },
    },
    poster: {
      type: 'graphic', parentId: 'p1', index: 'a2', name: 'Poster',
      props: { x: 780, y: 780, width: 280, height: 280, shape: { kind: 'rect' }, fills: [{ type: 'image', assetId, fit: 'fill', filter: 'vivid' }] },
    },
  },
  overrides: {},
})

const fillOf = async (page: Page, id: string) => {
  const d = await read(page)
  return ((d.overrides['format:sq']?.[id]?.fills ?? d.nodes[id]?.props.fills) as Record<string, unknown>[])[0]
}
const cornerHandle = async (page: Page, i: number) => {
  const box = await page.locator(`.crop-image .handle[data-crop-corner="${i}"]`).boundingBox()
  if (!box) throw new Error(`no crop corner ${i}`)
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
}
const undo = async (page: Page) => press(page, 'undo')

test('Enter crops a photo: a drag moves it, a corner scales it, each one undo step, and the export matches Node', async ({ browser }) => {
  const asset = await upload(photo)
  const { page, errors } = await openStage(browser, design(asset.id))
  const before = await exportHashOf(page)
  await click(page, 400, 400)
  expect(await selection(page)).toEqual(['photo'])
  await press(page, 'editPoints')
  await expect(page.locator('.crop-image')).toBeVisible()
  // The whole image sits 180 out past each side: 960 × 600 at half size.
  const whole = await page.locator('.crop-image').boundingBox()
  const zoom = await page.evaluate(() => window.razzlr?.camera().zoom ?? 1)
  expect((whole?.width ?? 0) / zoom).toBeCloseTo(960, 0)
  expect((whole?.height ?? 0) / zoom).toBeCloseTo(600, 0)
  writeOutput('crop-0-entered.png', await page.screenshot({ animations: 'disabled' }))

  // Drag the image 100 to the end: it shows 200 image pixels further towards its start.
  await drag(page, { x: 400, y: 400 }, { x: 500, y: 400 })
  expect(await fillOf(page, 'photo')).toMatchObject({ fit: 'crop', crop: { x: 160, y: 0, width: 1200, height: 1200 } })
  const moved = await exportHashOf(page)
  expect(moved).not.toBe(before)
  writeOutput('crop-1-moved.png', await page.screenshot({ animations: 'disabled' }))

  // Its bottom end corner, at (60 + 960, 740), dragged out to 1200 wide: the top start corner
  // stays, it keeps its aspect, and the crop is 960 image pixels across.
  const corner = await cornerHandle(page, 2)
  const to = await screenPoint(page, 60 + 1200, 740 + 100)
  await dragScreen(page, corner, to)
  expect(await fillOf(page, 'photo')).toMatchObject({ fit: 'crop', crop: { x: 128, y: 0, width: 960, height: 960 } })
  // Dragged back in past the box, it stops at the least size that still covers it.
  await dragScreen(page, await cornerHandle(page, 2), await screenPoint(page, 300, 300))
  const least = (await fillOf(page, 'photo'))?.crop as { width: number; height: number }
  expect(least.height).toBe(1200)
  await undo(page)
  writeOutput('crop-2-scaled.png', await page.screenshot({ animations: 'disabled' }))

  // The export of the cropped design is Node's, pixel for pixel.
  const ck = await loadCanvasKit()
  const stored = new Uint8Array(await (await page.request.get(`/brands/dev-brand-coffee/assets/${asset.id}`)).body())
  const node = renderDesign(ck, JSON.parse(await designOf(page)), 'p1', 'sq', {
    fonts: loadFontFiles().map((f) => ({ family: f.family, bytes: f.bytes })), fallbackFamilies: [...FALLBACK_FAMILIES], images: { [asset.id]: stored },
  })
  expect(await exportHashOf(page)).toBe(createHash('sha256').update(node.pixels).digest('hex'))

  // Escape ends the crop; the layer stays selected.
  await page.keyboard.press('Escape')
  await page.evaluate(() => window.razzlr?.drawn())
  await expect(page.locator('.crop-image')).toHaveCount(0)
  expect(await selection(page)).toEqual(['photo'])
  writeOutput('crop-3-done.png', await page.screenshot({ animations: 'disabled' }))

  // One undo per drag: the corner, then the move, and the photo fills its shape again.
  await undo(page)
  expect(await fillOf(page, 'photo')).toMatchObject({ crop: { x: 160, width: 1200 } })
  expect(await exportHashOf(page)).toBe(moved)
  await undo(page)
  expect((await read(page)).overrides['format:sq']?.photo).toBeUndefined()
  expect(await exportHashOf(page)).toBe(before)
  expect(errors).toEqual([])
})

test('a double click crops too, and a click outside the image ends it', async ({ browser }) => {
  const asset = await upload(photo)
  const { page, errors } = await openStage(browser, design(asset.id))
  const at = await screenPoint(page, 400, 400)
  await page.mouse.dblclick(at.x, at.y)
  await page.evaluate(() => window.razzlr?.drawn())
  await expect(page.locator('.crop-image')).toBeVisible()
  await click(page, 400, 900)
  await expect(page.locator('.crop-image')).toHaveCount(0)
  expect(errors).toEqual([])
})

test('two layers become a mask and what it masks in one key press, and one undo', async ({ browser }) => {
  const asset = await upload(photo)
  const { page, errors } = await openStage(browser, design(asset.id))
  const before = await exportHashOf(page)
  const start = new Set(Object.keys((await read(page)).nodes))
  // A marquee around the disc and the poster over it.
  await drag(page, { x: 770, y: 770 }, { x: 1075, y: 1075 })
  expect((await selection(page)).sort()).toEqual(['disc', 'poster'])
  await press(page, 'mask')
  const d = await read(page)
  const [group = ''] = Object.keys(d.nodes).filter((id) => !start.has(id))
  expect(await selection(page)).toEqual([group])
  expect(d.nodes.disc?.parentId).toBe(group)
  expect(d.nodes.poster?.parentId).toBe(group)
  // The disc, at the bottom, masks the poster: it shows only in the circle.
  expect(d.nodes.disc?.props.mask).toBe('alpha')
  expect(d.nodes.poster?.props).not.toHaveProperty('mask')
  expect(await exportHashOf(page)).not.toBe(before)
  writeOutput('mask-0-masked.png', await page.screenshot({ animations: 'disabled' }))
  // A click on the poster's corner, outside the circle, picks nothing now.
  await click(page, 790, 1050)
  expect(await selection(page)).toEqual([])
  await click(page, 900, 900)
  expect(await selection(page)).toEqual([group])

  await undo(page)
  expect((await read(page)).nodes[group]).toBeUndefined()
  expect(await exportHashOf(page)).toBe(before)
  expect(errors).toEqual([])
})
