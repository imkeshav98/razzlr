// Export (#55) in Chromium, through the Export menu: every format of a page as PNG downloads as one
// zip with a folder per format, and every file in it is byte for byte what Node exports from the
// same design; one format as JPG downloads as itself; and the main thread is never blocked for
// more than 50 ms while the export worker draws five formats.
import { readFileSync } from 'node:fs'
import { expect, test, type Page } from '../support/test.ts'
import { exportDesign, readZip } from '@dazbee/export'
import { FALLBACK_FAMILIES } from '@dazbee/fonts'
import { loadFontFiles } from '@dazbee/fonts/node'
import { loadCanvasKit } from '@dazbee/renderer/node'
import type { DesignInput } from '@dazbee/schema'
import { photo, upload } from '../support/assets.ts'
import { designOf, writeOutput } from '../support/editor.ts'
import { openStage } from '../support/stage.ts'
import { choose } from '../support/select.ts'

test.describe.configure({ timeout: 180_000 })

const FORMATS = {
  sq: { name: 'Square', width: 1080, height: 1080, order: 'a0' },
  pt: { name: 'Portrait 4:5', width: 1080, height: 1350, order: 'a1' },
  story: { name: 'Story', width: 1080, height: 1920, order: 'a2' },
  land: { name: 'Landscape', width: 1200, height: 628, order: 'a3' },
  mpu: { name: 'MPU', width: 300, height: 250, order: 'a4' },
}

const design = (assetId: string): DesignInput => ({
  meta: { schemaVersion: 3, designId: 'replaced-by-the-api', name: 'Spring drop', kind: 'single', primaryFormatId: 'sq' },
  formats: FORMATS,
  pages: {
    p1: { name: 'Hero', order: 'a0', fills: [{ type: 'solid', color: '#FFF6E8FF' }] },
    p2: { name: 'Offer', order: 'a1', fills: [{ type: 'solid', color: '#15121AFF' }] },
  },
  nodes: {
    photo: {
      type: 'graphic', parentId: 'p1', index: 'a0', name: 'Photo',
      props: { x: 80, y: 80, width: 920, height: 600, shape: { kind: 'rect', cornerRadius: 40 }, fills: [{ type: 'image', assetId, fit: 'fill', filter: 'vivid' }] },
    },
    title: {
      type: 'text', parentId: 'p1', index: 'a1', name: 'Title', role: 'headline',
      props: { x: 80, y: 740, width: 920, height: 140, text: 'Spring drop', style: { fontFamily: 'Noto Sans', fontSize: 110, fontWeight: 800, color: '#15121AFF' } },
    },
    badge: {
      type: 'graphic', parentId: 'p1', index: 'a2', name: 'Badge',
      props: { x: 820, y: 40, width: 220, height: 220, shape: { kind: 'star', points: 10, innerRadius: 0.75 }, fills: [{ type: 'solid', color: '#FF48B0FF' }] },
    },
    offer: {
      type: 'text', parentId: 'p2', index: 'a0', name: 'Offer',
      props: { x: 80, y: 400, width: 920, height: 140, text: '30% off', style: { fontFamily: 'Noto Sans', fontSize: 120, fontWeight: 800, color: '#FFFFFFFF' } },
    },
  },
  overrides: {
    // The other formats move and resize layers, as an agency's sizes do.
    'format:story': { title: { y: 1400 }, photo: { height: 1100 } },
    'format:land': { photo: { width: 560, height: 468 }, title: { x: 660, y: 200, width: 480, height: 260 }, badge: { x: 980, width: 160, height: 160 } },
    'format:mpu': { photo: { x: 10, y: 10, width: 280, height: 150 }, title: { x: 10, y: 170, width: 280, height: 40 }, badge: { x: 230, y: 4, width: 60, height: 60 } },
  },
})

/** Records every task that blocks the main thread for more than 50 ms, from now on. */
const watchLongTasks = (page: Page) => page.evaluate(() => {
  const seen: number[] = []
  new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) seen.push(Math.round(entry.duration))
  }).observe({ type: 'longtask', buffered: false })
  ;(window as unknown as { longTasks: number[] }).longTasks = seen
})
const longTasks = (page: Page) => page.evaluate(() => (window as unknown as { longTasks: number[] }).longTasks)

async function nodeExport(page: Page, assetId: string) {
  const ck = await loadCanvasKit()
  const json = JSON.parse(await designOf(page)) as unknown
  const stored = new Uint8Array(await (await page.request.get(`/brands/dev-brand-coffee/assets/${assetId}`)).body())
  const bytes = { fonts: loadFontFiles().map((f) => ({ family: f.family, bytes: f.bytes })), fallbackFamilies: [...FALLBACK_FAMILIES], images: { [assetId]: stored } }
  return (request: { pageIds: string[]; formatIds: string[]; type: 'png' | 'jpg'; quality?: number }) => exportDesign(ck, json, request, bytes).bytes
}

test('every format of a page as PNG is one zip whose files are what Node exports, and the stage stays responsive', async ({ browser }) => {
  const asset = await upload(photo)
  const { page, errors } = await openStage(browser, design(asset.id))
  await page.getByTestId('share-open').click()
  await page.getByTestId('export-open').click()
  const dialog = page.getByTestId('export')
  await expect(dialog).toBeVisible()
  await choose(page.getByTestId('export-page'), 'p1')
  await expect(page.getByTestId('export-run')).toHaveText('Export 5 files')
  writeOutput('export-0-menu.png', await page.screenshot())

  await watchLongTasks(page)
  const started = Date.now()
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByTestId('export-run').click()])
  expect(download.suggestedFilename()).toBe('Spring drop.zip')
  const zipped = new Uint8Array(readFileSync(await download.path()))
  const took = Date.now() - started
  // The task records arrive a frame after the task ends.
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 100))))
  const blocked = await longTasks(page)

  const entries = readZip(zipped)
  expect(entries.map((e) => e.path)).toEqual(Object.values(FORMATS).map((f) => `${f.name.replace(':', '-')}/Spring drop - Hero - ${f.name.replace(':', '-')}.png`))
  const node = await nodeExport(page, asset.id)
  for (const [i, formatId] of Object.keys(FORMATS).entries()) {
    const browserFile = entries[i]?.bytes
    expect(browserFile, formatId).toBeDefined()
    expect(Buffer.from(browserFile ?? []).equals(Buffer.from(node({ pageIds: ['p1'], formatIds: [formatId], type: 'png' }))), `${formatId} matches Node`).toBe(true)
  }
  writeOutput('export-1-zip.json', JSON.stringify({ files: entries.map((e) => ({ path: e.path, bytes: e.bytes.length })), zipBytes: zipped.length, ms: took, longTasks: blocked }, null, 2))
  writeOutput('export-2-story.png', Buffer.from(entries[2]?.bytes ?? []))
  expect(blocked, 'main-thread tasks over 50 ms while exporting').toEqual([])
  // The watch does see a task that blocks: 120 ms of work on the main thread is recorded.
  // (It runs from a timer, since a task is what the browser measures and an evaluate is not one.)
  await page.evaluate(() => new Promise((resolve) => setTimeout(() => {
    const end = performance.now() + 120
    while (performance.now() < end) { /* busy */ }
    resolve(null)
  })))
  await expect.poll(async () => (await longTasks(page)).length).toBe(1)
  expect(errors).toEqual([])
})

test('one format as JPG downloads as itself, at the quality picked, the same bytes as Node', async ({ browser }) => {
  const asset = await upload(photo)
  const { page, errors } = await openStage(browser, design(asset.id))
  await page.getByTestId('share-open').click()
  await page.getByTestId('export-open').click()
  await choose(page.getByTestId('export-page'), 'p2')
  // Only the landscape format.
  for (const formatId of ['sq', 'pt', 'story', 'mpu']) await page.getByTestId('export').locator(`[data-format="${formatId}"]`).uncheck()
  await page.locator('[data-type="jpg"]').click()
  await page.getByTestId('export-quality').fill('70')
  await page.getByTestId('export-quality').press('Enter')
  await expect(page.getByTestId('export-run')).toHaveText('Export 1 file')
  writeOutput('export-3-jpg-menu.png', await page.screenshot())
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByTestId('export-run').click()])
  expect(download.suggestedFilename()).toBe('Spring drop - Offer - Landscape.jpg')
  const jpg = readFileSync(await download.path())
  const node = await nodeExport(page, asset.id)
  expect(jpg.equals(Buffer.from(node({ pageIds: ['p2'], formatIds: ['land'], type: 'jpg', quality: 70 })))).toBe(true)
  // Lower quality is a smaller file.
  expect(jpg.length).toBeLessThan(node({ pageIds: ['p2'], formatIds: ['land'], type: 'jpg', quality: 100 }).length)
  writeOutput('export-4-offer.jpg', jpg)
  expect(errors).toEqual([])
})
