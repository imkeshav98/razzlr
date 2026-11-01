// Phase 1's exit check (#61) in Chromium, through real input only: a designer starts a design from
// the brief, sets up the brand kit, uploads a photo and a font, builds an ad in the square, adds
// four more formats and moves the headline in one of them, then exports every format as PNG, JPG,
// PDF and SVG through the Export menu. Each file is byte for byte what Node exports from the same
// design and files; PNG and JPG are pixel for pixel Node's render, and PDF and SVG, drawn by pdfium
// and resvg, stay within EXIT_VECTOR_LIMIT of it. The numbers go to output/exit-check.json.
import { readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { PDFiumLibrary } from '@hyzyla/pdfium'
import { exportDesign, readZip } from '@dazbee/export'
import { FALLBACK_FAMILIES } from '@dazbee/fonts'
import { loadFontFiles } from '@dazbee/fonts/node'
import { encodePng } from '@dazbee/pixels/pixels'
import { overWhite, rasterisePdf, rasteriseSvg, vectorDifference } from '@dazbee/pixels/vector'
import { renderDesign } from '@dazbee/renderer'
import { loadCanvasKit } from '@dazbee/renderer/node'
import type { ExportType } from '@dazbee/schema'
import { expect, test, type Page } from '../support/test.ts'
import { photo } from '../support/assets.ts'
import { designOf, OUTPUT, screenPoint, writeOutput } from '../support/editor.ts'
import { press } from '../support/stage.ts'

test.describe.configure({ timeout: 600_000 })

const BRAND = 'dev-brand-cycles'
const run = crypto.randomUUID().slice(0, 6)
const righteous = new Uint8Array(readFileSync(join(import.meta.dirname, '..', 'assets', 'fonts', 'Righteous-Regular.ttf')))
/** The most a PDF or SVG of this ad may differ from the CPU render, in percent of its pixels. */
const EXIT_VECTOR_LIMIT = 1

interface Stored {
  meta: { name: string }
  formats: Record<string, { name: string; width: number; height: number }>
  pages: Record<string, { fills: { type: string; color?: string }[] }>
  nodes: Record<string, { type: string; bindings?: Record<string, string>; props: Record<string, unknown> & { fills?: { type: string; assetId?: string }[] } }>
  overrides: Record<string, Record<string, Record<string, unknown>>>
}
const stored = async (page: Page) => JSON.parse(await designOf(page)) as Stored
const drawn = (page: Page) => page.evaluate(() => window.dazbee?.drawn())
const shot = async (page: Page, name: string) => writeOutput(`exit-check-${name}.png`, await page.screenshot())

test('an ad set rebuilt in 5 formats through real input exports PNG, JPG, PDF and SVG that match Node', async ({ browser }) => {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 }, acceptDownloads: true, recordVideo: { dir: join(OUTPUT, 'exit-check-video'), size: { width: 1440, height: 1000 } },
  })
  const page = await context.newPage()
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))

  // The brief opens a blank square.
  await page.goto(`/brands/${BRAND}`)
  await page.getByLabel('Brief').fill(`Trail days ${run}`)
  await page.getByRole('button', { name: 'Make drafts' }).click()
  await expect(page.getByTestId('status')).toHaveAttribute('data-ready', '', { timeout: 30_000 })
  await page.getByTestId('start-blank').click()
  await page.evaluate(() => window.dazbee?.setCamera({ x: 120, y: 80, zoom: 0.7 }))
  await drawn(page)

  // The brand kit gets two colours, typed in by hand.
  const colour = `Trail green ${run}`
  const accent = `Sun ${run}`
  await page.locator('[data-panel="brand"]').click()
  const kit = page.getByTestId('brand-kit')
  await kit.getByRole('button', { name: 'Edit', exact: true }).click()
  for (const [named, hex] of [[colour, '1F7A4D'], [accent, 'FFB627']] as const) {
    await kit.getByRole('button', { name: 'Add colour' }).click()
    const row = kit.locator('li[data-token]').last()
    await row.getByRole('textbox', { name: /^Name of colour/ }).fill(named)
    await row.getByRole('textbox', { name: /^Name of colour/ }).press('Enter')
    await row.getByRole('textbox', { name: `Hex value of ${named}` }).fill(hex)
    await row.getByRole('textbox', { name: `Hex value of ${named}` }).press('Enter')
    await expect(row.getByRole('textbox', { name: `Hex value of ${named}` })).toHaveValue(new RegExp(hex, 'i'))
  }
  await shot(page, '0-brand-kit')

  // A photo goes into the brand's assets and is dragged onto the square.
  await page.locator('[data-panel="assets"]').click()
  const library = page.getByTestId('asset-library')
  const name = `Sneaker ${run}`
  // Bytes after the JPEG's end make each run's file its own, since assets are stored by hash.
  await library.locator('input[type="file"]').setInputFiles({ name: `${name}.jpg`, mimeType: 'image/jpeg', buffer: Buffer.concat([photo, Buffer.from(run)]) })
  const item = library.locator('li[data-asset]').filter({ hasText: name })
  await expect(item).toBeVisible({ timeout: 30_000 })
  const stage = page.getByTestId('stage')
  const box = await stage.boundingBox()
  const drop = await screenPoint(page, 600, 420)
  await item.getByRole('button', { name: `Place ${name} on the design` }).dragTo(stage, { targetPosition: { x: drop.x - (box?.x ?? 0), y: drop.y - (box?.y ?? 0) } })
  await expect.poll(async () => Object.values((await stored(page)).nodes).filter((n) => n.props.fills?.some((f) => f.type === 'image')).length).toBe(1)
  await page.keyboard.press('Escape')
  await drawn(page)

  // The page takes the brand colour from the Page card.
  await page.mouse.click(40, 900)
  await page.getByTestId('page-brand-colors').getByRole('button', { name: new RegExp(`^${colour}`) }).click()
  await expect.poll(async () => (await stored(page)).pages.p1?.fills).toEqual([{ type: 'solid', color: '#1F7A4DFF' }])

  // A badge drawn with the rectangle tool, in the brand colour from the kit.
  await press(page, 'toolRect')
  const from = await screenPoint(page, 800, 60)
  const to = await screenPoint(page, 1020, 200)
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  await page.mouse.move(to.x, to.y, { steps: 6 })
  await page.mouse.up()
  await drawn(page)
  await page.locator('[data-panel="brand"]').click()
  await kit.getByRole('button', { name: `Apply ${accent} to the selection` }).click()
  await expect.poll(async () => Object.values((await stored(page)).nodes).filter((n) => n.bindings?.fill?.startsWith('brand:')).length).toBe(1)
  await page.keyboard.press('Escape')

  // A headline typed with the text tool, then set in an uploaded font.
  await press(page, 'toolText')
  const at = await screenPoint(page, 80, 860)
  await page.mouse.click(at.x, at.y)
  await drawn(page)
  await page.keyboard.type('Ride further')
  await page.keyboard.press('Escape')
  await drawn(page)
  const headline = Object.entries((await stored(page)).nodes).find(([, n]) => n.type === 'text')?.[0] ?? ''
  expect(headline).not.toBe('')
  expect(await page.evaluate(() => window.dazbee?.selection())).toEqual([headline])
  await page.getByTestId('font-open').click()
  // An upload from the list joins the brand's fonts and is set at once.
  await page.getByTestId('font-upload').setInputFiles({ name: 'Righteous-Regular.ttf', mimeType: 'font/ttf', buffer: Buffer.from(righteous) })
  await expect.poll(async () => ((await stored(page)).nodes[headline]?.props.style as { fontFamily: string }).fontFamily).toBe('Righteous')
  // The size slider runs from 8 to 240: a click 57% along sets about 140.
  const slider = page.getByTestId('text-look').getByRole('slider', { name: 'Size' })
  const track = await slider.boundingBox()
  if (!track) throw new Error('no size slider')
  await page.mouse.click(track.x + (track.width * (140 - 8)) / (240 - 8), track.y + track.height / 2)
  await expect.poll(async () => ((await stored(page)).nodes[headline]?.props.style as { fontSize: number }).fontSize).toBeGreaterThan(120)
  await page.mouse.click(40, 900)
  await page.locator('[data-panel="brand"]').click()
  await expect(kit).toBeHidden()
  await drawn(page)
  await shot(page, '1-square')

  // Four more formats from presets, each starting from the square's layout scaled to fit.
  for (const preset of ['feed-portrait', 'story', 'link-image', 'medium-rectangle']) {
    await page.getByRole('button', { name: 'Add format' }).click()
    await page.getByRole('dialog', { name: 'Add format' }).locator(`[data-preset=${preset}]`).click()
  }
  await expect.poll(async () => Object.keys((await stored(page)).formats).length).toBe(5)
  const design = await stored(page)
  const story = Object.entries(design.formats).find(([, f]) => f.height === 1920)?.[0] ?? ''
  await page.evaluate(() => window.dazbee?.fitAll())
  await drawn(page)

  // The headline moves down in the story only, into the tall format's lower third.
  const before = { ...design.nodes[headline]?.props, ...design.overrides[`format:${story}`]?.[headline] } as { x: number; y: number; width: number; height: number }
  await press(page, 'toolSelect')
  const grab = await screenPoint(page, before.x + before.width / 2, before.y + before.height / 2, { pageId: 'p1', formatId: story })
  const lift = await screenPoint(page, before.x + before.width / 2, before.y + before.height / 2 + 600, { pageId: 'p1', formatId: story })
  await page.mouse.move(grab.x, grab.y)
  await page.mouse.down()
  await page.mouse.move(lift.x, lift.y, { steps: 8 })
  await page.mouse.up()
  await drawn(page)
  const after = await stored(page)
  expect((after.overrides[`format:${story}`]?.[headline] as { y: number }).y).toBeGreaterThan(before.y + 500)
  expect(after.nodes[headline]?.props.y).toBe(design.nodes[headline]?.props.y)
  await page.keyboard.press('Escape')
  await drawn(page)
  await shot(page, '2-five-formats')

  // Every format as each file type, through the Export menu.
  const files: Partial<Record<ExportType, Map<string, Uint8Array>>> = {}
  for (const type of ['png', 'jpg', 'pdf', 'svg'] as const) {
    await page.getByRole('button', { name: 'Share' }).click()
    await page.getByText('Export', { exact: true }).click()
    await page.locator(`[data-type="${type}"]`).click()
    if (type === 'png') await shot(page, '3-export')
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByTestId('export-run').click()])
    const zip = new Uint8Array(readFileSync(await download.path()))
    files[type] = new Map(readZip(zip).map((entry) => [entry.path, entry.bytes]))
    await page.keyboard.press('Escape')
  }

  // Node exports the same design from the same files.
  const final = await stored(page)
  const json = JSON.parse(await designOf(page)) as unknown
  const assetId = Object.values(final.nodes).flatMap((n) => n.props.fills ?? []).find((f) => f.type === 'image')?.assetId ?? ''
  const image = new Uint8Array(await (await page.request.get(`/brands/${BRAND}/assets/${assetId}`)).body())
  const bytes = {
    fonts: [...loadFontFiles().map((f) => ({ family: f.family, bytes: f.bytes })), { family: 'Righteous', bytes: righteous }],
    fallbackFamilies: [...FALLBACK_FAMILIES],
    images: { [assetId]: image },
  }
  const ck = await loadCanvasKit()
  const pdfium = await PDFiumLibrary.init()
  const results: Record<string, unknown>[] = []
  for (const [formatId, format] of Object.entries(final.formats)) {
    const result: Record<string, unknown> = { format: format.name, size: `${format.width}×${format.height}` }
    for (const type of ['png', 'jpg', 'pdf', 'svg'] as const) {
      const node = exportDesign(ck, json, { pageIds: ['p1'], formatIds: [formatId], type }, bytes).bytes
      const entry = [...(files[type] ?? new Map<string, Uint8Array>()).entries()].find(([path]) => path.startsWith(`${format.name}/`))
      expect(entry, `${type} for ${format.name} is in the zip`).toBeDefined()
      const browserFile = entry?.[1] ?? new Uint8Array()
      expect(Buffer.from(browserFile).equals(Buffer.from(node)), `${format.name} ${type} is Node's, byte for byte`).toBe(true)
      result[type] = { bytes: browserFile.length, identicalToNode: true }
    }
    const cpu = overWhite(renderDesign(ck, json, 'p1', formatId, bytes))
    const pdf = await rasterisePdf(pdfium, files.pdf?.get([...files.pdf.keys()].find((p) => p.startsWith(`${format.name}/`)) ?? '') ?? new Uint8Array())
    const svg = rasteriseSvg(files.svg?.get([...files.svg.keys()].find((p) => p.startsWith(`${format.name}/`)) ?? '') ?? new Uint8Array())
    const vector = { pdf: Number(vectorDifference(cpu, pdf).toFixed(3)), svg: Number(vectorDifference(cpu, svg).toFixed(3)) }
    result.vectorPercentDiffering = vector
    writeOutput(`exit-check-4-${formatId}-pdf.png`, Buffer.from(encodePng(ck, pdf)))
    writeOutput(`exit-check-4-${formatId}-svg.png`, Buffer.from(encodePng(ck, svg)))
    expect(vector.pdf, `${format.name} PDF, % of pixels differing`).toBeLessThanOrEqual(EXIT_VECTOR_LIMIT)
    expect(vector.svg, `${format.name} SVG, % of pixels differing`).toBeLessThanOrEqual(EXIT_VECTOR_LIMIT)
    results.push(result)
  }
  pdfium.destroy()
  writeOutput('exit-check.json', JSON.stringify({ design: final.meta.name, layers: Object.keys(final.nodes).length, formats: results }, null, 2))
  expect(errors).toEqual([])
  await context.close()
  const video = await page.video()?.path()
  if (video) writeOutput('exit-check.webm', readFileSync(video))
  rmSync(join(OUTPUT, 'exit-check-video'), { recursive: true, force: true })
})
