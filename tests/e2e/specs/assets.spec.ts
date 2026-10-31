// The asset library (#52) in Chromium: two images uploaded at once, each with its progress shown,
// one tagged, found again by that tag, and dragged onto the design, where it becomes a graphic with
// the image as its fill at the drop point, in one undo step. A click places one too, for those who
// can't drag.
import { crc32, deflateSync } from 'node:zlib'
import { randomUUID } from 'node:crypto'
import { expect, test, type Page } from '@playwright/test'
import { AssetSummary, type DesignInput } from '@razzlr/schema'
import { screenPoint, writeOutput } from '../support/editor.ts'
import { API_URL, DEV_BRAND } from '../support/seed.ts'
import { openStage, read } from '../support/stage.ts'

test.describe.configure({ timeout: 120_000 })

const run = randomUUID().slice(0, 8)

/**
 * A 900 × 600 PNG: a two-colour gradient with grain, so it compresses poorly and takes a moment to
 * upload, and its own colours, so a run never uploads the bytes of another.
 */
function photo(from: [number, number, number], to: [number, number, number]) {
  const width = 900
  const height = 600
  const chunk = (type: string, data: Buffer) => {
    const length = Buffer.alloc(4)
    length.writeUInt32BE(data.length)
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
    const crc = Buffer.alloc(4)
    crc.writeUInt32BE(crc32(body))
    return Buffer.concat([length, body, crc])
  }
  const header = Buffer.alloc(13)
  header.writeUInt32BE(width, 0)
  header.writeUInt32BE(height, 4)
  header.set([8, 2, 0, 0, 0], 8)
  const rows = Buffer.alloc(height * (1 + width * 3))
  let noise = [...run].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const t = (x + y) / (width + height)
      noise = (noise * 1664525 + 1013904223) >>> 0
      const grain = (noise >>> 28) - 8
      for (let c = 0; c < 3; c++) rows[y * (1 + width * 3) + 1 + x * 3 + c] = Math.max(0, Math.min(255, Math.round((from[c] ?? 0) * (1 - t) + (to[c] ?? 0) * t) + grain))
    }
  }
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  return Buffer.concat([signature, chunk('IHDR', header), chunk('IDAT', deflateSync(rows)), chunk('IEND', Buffer.alloc(0))])
}

const design = (): DesignInput => ({
  meta: { schemaVersion: 2, designId: 'replaced-by-the-api', name: 'Asset library', kind: 'single', primaryFormatId: 'sq' },
  formats: { sq: { name: 'Square', width: 1080, height: 1080, order: 'a0' } },
  pages: { p1: { name: 'Page 1', order: 'a0', fills: [{ type: 'solid', color: '#FFFFFFFF' }] } },
  nodes: {},
  overrides: {},
})

/** The graphics on the page filled with an image, and the asset each shows. */
async function images(page: Page) {
  const nodes = (await read(page)).nodes as unknown as Record<string, { parentId: string; props: { x: number; y: number; width: number; height: number; fills?: { type: string; assetId?: string }[] } }>
  return Object.entries(nodes).filter(([, n]) => n.props.fills?.[0]?.type === 'image').map(([id, n]) => ({ id, assetId: n.props.fills?.[0]?.assetId, ...n.props }))
}

test('uploads two images with progress, tags one, finds it by its tag and drags it onto the design', async ({ browser }) => {
  const { page, errors } = await openStage(browser, design())
  await page.locator('[data-panel="assets"]').click()
  const library = page.getByTestId('asset-library')
  await expect(library).toBeVisible()

  // Every progress value the bars show, as they show it.
  await page.evaluate(() => {
    const seen: number[] = []
    ;(window as unknown as { progress: number[] }).progress = seen
    new MutationObserver(() => {
      document.querySelectorAll('[data-testid="asset-uploads"] [role="progressbar"]').forEach((bar) => seen.push(Number(bar.getAttribute('aria-valuenow'))))
    }).observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['aria-valuenow'] })
  })
  // A slow uplink, so the bars have time to move.
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 20, downloadThroughput: -1, uploadThroughput: 400 * 1024 })

  const beach = `Beach ${run}`
  const mountain = `Mountain ${run}`
  await library.locator('input[type="file"]').setInputFiles([
    { name: `${beach}.png`, mimeType: 'image/png', buffer: photo([255, 196, 92], [24, 140, 200]) },
    { name: `${mountain}.png`, mimeType: 'image/png', buffer: photo([40, 70, 50], [230, 235, 240]) },
  ])
  await expect(library.getByRole('progressbar')).toHaveCount(2)
  writeOutput('assets-0-uploading.png', await page.screenshot())
  const item = (name: string) => library.locator('li[data-asset]').filter({ hasText: name })
  await expect(item(beach)).toBeVisible({ timeout: 30_000 })
  await expect(item(mountain)).toBeVisible({ timeout: 30_000 })
  await expect(library.getByTestId('asset-uploads')).toHaveCount(0)
  await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 })
  const progress = await page.evaluate(() => (window as unknown as { progress: number[] }).progress)
  expect(progress.some((p) => p > 0 && p < 100), `the bars moved: ${progress.join(', ')}`).toBe(true)

  // Both thumbnails are the small copies the API made.
  for (const name of [beach, mountain]) {
    await expect.poll(() => item(name).locator('img').evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth)).toBe(320)
  }

  // Tag the beach.
  await item(beach).getByRole('button', { name: /Name and tags/ }).click()
  const details = page.getByTestId('asset-details')
  await details.getByRole('textbox', { name: 'Add a tag and press Enter' }).fill(`sunny-${run}`)
  await details.getByRole('textbox', { name: 'Add a tag and press Enter' }).press('Enter')
  await expect(details.getByRole('listitem').filter({ hasText: `sunny-${run}` })).toBeVisible()
  writeOutput('assets-1-tagging.png', await page.screenshot())
  await details.getByRole('button', { name: 'Done' }).click()
  await expect(details).toHaveCount(0)

  // Find it by the tag: only the beach.
  await library.getByRole('searchbox', { name: 'Search by name or tag' }).fill(`sunny-${run}`)
  await expect(library.locator('li[data-asset]')).toHaveCount(1)
  await expect(item(beach)).toBeVisible()
  const listed = AssetSummary.array().parse(await (await fetch(`${API_URL}/brands/${DEV_BRAND}/assets?q=${encodeURIComponent(`sunny-${run}`)}`)).json())
  expect(listed.map((a) => [a.name, a.tags])).toEqual([[beach, [`sunny-${run}`]]])
  const beachId = listed[0]?.id
  writeOutput('assets-2-found-by-tag.png', await page.screenshot())

  // Drag it onto the square, centred on design pixel (760, 360).
  const stage = page.getByTestId('stage')
  const box = await stage.boundingBox()
  const drop = await screenPoint(page, 760, 360)
  const flyout = await page.getByTestId('flyout').boundingBox()
  expect(box && flyout && drop.x > flyout.x + flyout.width, 'the drop point is clear of the flyout').toBe(true)
  await item(beach).getByRole('button', { name: `Place ${beach} on the design` }).dragTo(stage, { targetPosition: { x: drop.x - (box?.x ?? 0), y: drop.y - (box?.y ?? 0) } })
  await expect.poll(async () => (await images(page)).length).toBe(1)
  const [placed] = await images(page)
  // Half the square wide at most, the photo's shape kept, centred where it was dropped.
  expect(placed).toMatchObject({ assetId: beachId, width: 540, height: 360, x: 490, y: 180 })
  expect(await page.evaluate(() => window.razzlr?.selection())).toEqual([placed?.id])
  // Its bytes arrive and it is drawn: the middle of the image is the photo, not the white page.
  // The export waits for the bytes, so it draws the photo, not the white page.
  const middle = await page.evaluate(async () => {
    const file = await window.razzlr?.exportFiles({ pageIds: ['p1'], formatIds: ['sq'], type: 'png' })
    const bitmap = await createImageBitmap(new Blob([new Uint8Array(file?.bytes ?? [])], { type: 'image/png' }))
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
    const context = canvas.getContext('2d')
    context?.drawImage(bitmap, 0, 0)
    return [...(context?.getImageData(760, 360, 1, 1).data ?? [])]
  })
  expect(middle.slice(0, 3)).not.toEqual([255, 255, 255])
  await expect.poll(async () => page.evaluate(() => {
    try {
      return window.razzlr?.exportPixels().length ?? 0
    } catch {
      return 0
    }
  }), { timeout: 15_000 }).toBeGreaterThan(0)
  await page.evaluate(() => window.razzlr?.drawn())
  writeOutput('assets-3-dropped.png', await page.screenshot())

  // One undo step takes it away again.
  await page.evaluate(() => window.razzlr?.perform('undo'))
  await expect.poll(async () => (await images(page)).length).toBe(0)

  // Without a drag: a click places the mountain in the middle of the square.
  await library.getByRole('searchbox', { name: 'Search by name or tag' }).fill(mountain)
  await expect(library.locator('li[data-asset]')).toHaveCount(1)
  await item(mountain).getByRole('button', { name: `Place ${mountain} on the design` }).click()
  await expect.poll(async () => (await images(page)).length).toBe(1)
  const [clicked] = await images(page)
  expect(clicked).toMatchObject({ width: 540, height: 360, x: 270, y: 360 })
  expect(errors).toEqual([])
})
