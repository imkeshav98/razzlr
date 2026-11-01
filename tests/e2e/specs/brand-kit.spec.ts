// Brand kits (#53) in Chromium: set up a kit with a colour, apply it to a layer, change the colour
// and see the layer change, with the design itself untouched; another design bound to the same
// colour opens in the new one, and one undo lets the layer go of the brand again. The flyout opens
// as a picker: its colour tiles and font rows apply the kit, and the Page card shows the colours.
import { expect, test, type Page } from '../support/test.ts'
import { BrandKit, EMPTY_BRAND_KIT, type DesignInput } from '@razzlr/schema'
import { editorPath, writeOutput } from '../support/editor.ts'
import { API_URL, DEV_BRAND, seed } from '../support/seed.ts'
import { openStage, read } from '../support/stage.ts'

test.describe.configure({ timeout: 120_000 })

const navy = '#14213DFF'
const design = (bindings?: Record<string, string>): DesignInput => ({
  meta: { schemaVersion: 2, designId: 'replaced-by-the-api', name: 'Brand kit', kind: 'single', primaryFormatId: 'sq' },
  formats: { sq: { name: 'Square', width: 1080, height: 1080, order: 'a0' } },
  pages: { p1: { name: 'Page 1', order: 'a0', fills: [{ type: 'solid', color: '#FFFFFFFF' }] } },
  nodes: {
    box: {
      type: 'graphic', parentId: 'p1', index: 'a0', name: 'Box', ...(bindings ? { bindings } : {}),
      props: { x: 640, y: 140, width: 300, height: 300, shape: { kind: 'rect', cornerRadius: 24 }, fills: [{ type: 'solid', color: navy }] },
    },
  },
  overrides: {},
})

const kitNow = async () => BrandKit.parse(await (await fetch(`${API_URL}/brands/${DEV_BRAND}/kit`)).json())
/** The colour the export render draws in the middle of the box. */
const boxColor = (page: Page) => page.evaluate(() => {
  const pixels = window.razzlr?.exportPixels()
  const at = (290 * 1080 + 790) * 4
  return pixels ? [pixels[at], pixels[at + 1], pixels[at + 2]] : null
})
const storedFill = async (page: Page) => {
  const box = (await read(page)).nodes.box as unknown as { bindings?: Record<string, string>; props: { fills: { color: string }[] } }
  return { bindings: box.bindings, color: box.props.fills.at(-1)?.color }
}

test.beforeAll(async () => {
  // This brand's kit starts empty for these checks.
  const response = await fetch(`${API_URL}/brands/${DEV_BRAND}/kit`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(EMPTY_BRAND_KIT) })
  expect(response.status).toBe(200)
})

test('a layer bound to a brand colour changes when the brand colour does', async ({ browser }) => {
  const { page, errors } = await openStage(browser, design())
  await page.locator('[data-panel="brand"]').click()
  const kit = page.getByTestId('brand-kit')
  await expect(kit).toHaveAttribute('data-mode', 'pick')
  await expect(kit.getByText('No colours yet. Add them with Edit.')).toBeVisible()
  await kit.getByRole('button', { name: 'Edit', exact: true }).click()
  await expect(kit).toHaveAttribute('data-mode', 'edit')

  // Set up the kit: one colour, named and given a value.
  await kit.getByRole('button', { name: 'Add colour' }).click()
  const row = kit.locator('li[data-token]').first()
  const token = await row.getAttribute('data-token')
  expect(token).toBe('colour-1')
  await row.getByRole('textbox', { name: 'Name of colour 1' }).fill('Harbour red')
  await row.getByRole('textbox', { name: 'Name of colour 1' }).press('Enter')
  await row.getByRole('textbox', { name: 'Hex value of Harbour red' }).fill('e0262b')
  await row.getByRole('textbox', { name: 'Hex value of Harbour red' }).press('Enter')
  await expect.poll(async () => (await kitNow()).colors).toEqual([{ token: 'colour-1', name: 'Harbour red', value: '#E0262BFF' }])
  writeOutput('brand-kit-0-kit.png', await page.screenshot())

  // Apply it to the box: the box follows brand:colour-1 and stores its value too.
  const apply = row.getByRole('button', { name: 'Apply Harbour red to the selection' })
  await expect(apply).toBeDisabled()
  await page.evaluate(() => window.razzlr?.select(['box']))
  await apply.click()
  await expect.poll(() => storedFill(page)).toEqual({ bindings: { fill: 'brand:colour-1' }, color: '#E0262BFF' })
  await expect(row.getByRole('button', { name: 'Stop following Harbour red' })).toHaveAttribute('aria-pressed', 'true')
  await expect.poll(() => boxColor(page)).toEqual([224, 38, 43])
  await page.evaluate(() => window.razzlr?.drawn())
  writeOutput('brand-kit-1-applied.png', await page.screenshot())

  // Change the brand colour: the box redraws green, and the design itself is as it was.
  const before = await read(page)
  await row.getByRole('textbox', { name: 'Hex value of Harbour red' }).fill('#1F9D55')
  await row.getByRole('textbox', { name: 'Hex value of Harbour red' }).press('Enter')
  await expect.poll(() => boxColor(page)).toEqual([31, 157, 85])
  expect(await read(page)).toEqual(before)
  await expect.poll(async () => (await kitNow()).colors[0]?.value).toBe('#1F9D55FF')
  await page.evaluate(() => window.razzlr?.drawn())
  writeOutput('brand-kit-2-changed.png', await page.screenshot())

  // The export the user downloads is drawn in the new colour too.
  const exported = await page.evaluate(async () => {
    const file = await window.razzlr?.exportFiles({ pageIds: ['p1'], formatIds: ['sq'], type: 'png' })
    const bitmap = await createImageBitmap(new Blob([new Uint8Array(file?.bytes ?? [])], { type: 'image/png' }))
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
    const context = canvas.getContext('2d')
    context?.drawImage(bitmap, 0, 0)
    return [...(context?.getImageData(790, 290, 1, 1).data ?? [])].slice(0, 3)
  })
  expect(exported).toEqual([31, 157, 85])

  // One undo: the box no longer follows the brand and is navy again.
  await page.evaluate(() => window.razzlr?.perform('undo'))
  await expect.poll(() => storedFill(page)).toEqual({ bindings: undefined, color: navy })
  await expect.poll(() => boxColor(page)).toEqual([20, 33, 61])
  expect(errors).toEqual([])
})

test('the picker applies a colour tile and a font row, and the Page card shows the colours', async ({ browser }) => {
  const kit = { ...EMPTY_BRAND_KIT, colors: [{ token: 'sun', name: 'Sun', value: '#FF8A3DFF' }, { token: 'roast', name: 'Roast', value: '#2A140AFF' }], fonts: [{ token: 'body', name: 'Body', family: 'Noto Sans' }] }
  await fetch(`${API_URL}/brands/${DEV_BRAND}/kit`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(kit) })
  const content = design()
  content.nodes.title = {
    type: 'text', parentId: 'p1', index: 'a1', name: 'Title',
    props: { x: 80, y: 80, width: 600, height: 120, text: 'Cold brew', style: { fontFamily: 'Noto Sans', fontSize: 96, fontWeight: 700, color: '#111111FF' } },
  } as DesignInput['nodes'][string]
  const { page, errors } = await openStage(browser, content)

  // With nothing selected, the Page card offers the brand's colours before the fixed set.
  const brandRow = page.getByTestId('page-brand-colors')
  await expect(brandRow.getByRole('button')).toHaveCount(2)
  await brandRow.getByRole('button', { name: 'Sun #FF8A3D' }).click()
  await expect.poll(async () => ((await read(page)) as unknown as { pages: Record<string, { fills: unknown[] }> }).pages.p1?.fills).toEqual([{ type: 'solid', color: '#FF8A3DFF' }])

  await page.locator('[data-panel="brand"]').click()
  const picker = page.getByTestId('brand-kit')
  await expect(picker).toHaveAttribute('data-mode', 'pick')
  const sun = picker.getByRole('button', { name: 'Apply Sun to the selection' })
  await expect(sun).toBeDisabled()
  await page.evaluate(() => window.razzlr?.select(['box']))
  await sun.click()
  await expect.poll(() => storedFill(page)).toEqual({ bindings: { fill: 'brand:sun' }, color: '#FF8A3DFF' })
  await expect(picker.getByRole('button', { name: 'Stop following Sun' })).toHaveAttribute('aria-pressed', 'true')
  // The font rows need text selected.
  await expect(picker.getByRole('button', { name: 'Apply Body to the selection' })).toBeDisabled()
  await page.evaluate(() => window.razzlr?.select(['title']))
  await picker.getByRole('button', { name: 'Apply Body to the selection' }).click()
  await expect.poll(async () => ((await read(page)).nodes.title as unknown as { bindings?: Record<string, string> }).bindings).toMatchObject({ fontFamily: 'brand:body' })
  await page.evaluate(() => window.razzlr?.drawn())
  writeOutput('brand-kit-3-picker.png', await page.screenshot())
  expect(errors).toEqual([])
})

test('another design bound to the brand colour opens in its current value', async ({ browser }) => {
  // Bound when the colour was red, stored red; the brand has since changed it.
  const kit = { ...EMPTY_BRAND_KIT, colors: [{ token: 'colour-1', name: 'Harbour red', value: '#1F9D55FF' }] }
  await fetch(`${API_URL}/brands/${DEV_BRAND}/kit`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(kit) })
  const content = design({ fill: 'brand:colour-1' })
  const box = content.nodes.box as { props: { fills: { type: string; color: string }[] } }
  box.props.fills = [{ type: 'solid', color: '#E0262BFF' }]
  const designId = await seed(content)
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } })
  const page = await context.newPage()
  await page.goto(editorPath(designId))
  await expect(page.getByTestId('status')).toHaveAttribute('data-ready', '', { timeout: 30_000 })
  await expect.poll(() => boxColor(page)).toEqual([31, 157, 85])
  await context.close()
})
