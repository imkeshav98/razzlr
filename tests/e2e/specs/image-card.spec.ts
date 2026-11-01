// The Image card (#154) in Chromium, with real input: a filter picked from tiles of the picture
// itself, how the image fits the layer, and behind Fine-tune its opacity and adjustments.
import { expect, test, type Locator, type Page } from '../support/test.ts'
import type { DesignInput } from '@dazbee/schema'
import { photo, upload } from '../support/assets.ts'
import { writeOutput } from '../support/editor.ts'
import { openStage } from '../support/stage.ts'
import { choose } from '../support/select.ts'

test.describe.configure({ timeout: 120_000 })

const design = (assetId: string): DesignInput => ({
  meta: { schemaVersion: 3, designId: 'replaced-by-the-api', name: 'Image card', kind: 'single', primaryFormatId: 'sq' },
  formats: { sq: { name: 'Square', width: 1080, height: 1080, order: 'a0' } },
  pages: { p1: { name: 'Page 1', order: 'a0', fills: [{ type: 'solid', color: '#FFFFFFFF' }] } },
  nodes: {
    photo: {
      type: 'graphic', parentId: 'p1', index: 'a0', name: 'Photo',
      props: { x: 140, y: 140, width: 800, height: 800, shape: { kind: 'rect', cornerRadius: 24 }, fills: [{ type: 'image', assetId, fit: 'fill' }] },
    },
    box: {
      type: 'graphic', parentId: 'p1', index: 'a1', name: 'Box',
      props: { x: 40, y: 40, width: 80, height: 80, shape: { kind: 'rect' }, fills: [{ type: 'solid', color: '#14213DFF' }] },
    },
  },
  overrides: {},
})

const imageOf = async (page: Page) =>
  (await page.evaluate(() => window.dazbee?.design().nodes.photo?.props) as { fills: Record<string, unknown>[] }).fills[0]
const enter = async (field: Locator, value: string) => {
  await field.fill(value)
  await field.press('Enter')
}

test('the Image card sets the filter, the fit, the opacity and the adjustments', async ({ browser }) => {
  const asset = await upload(photo)
  const { page, errors } = await openStage(browser, design(asset.id))

  // A plain shape has no Image card.
  await page.evaluate(() => window.dazbee?.select(['box']))
  await expect(page.getByTestId('fill-card')).toBeVisible()
  await expect(page.getByTestId('image-card')).toHaveCount(0)

  await page.evaluate(() => window.dazbee?.select(['photo']))
  const card = page.getByTestId('image-card')
  const filters = card.getByRole('radiogroup', { name: 'Filter' })
  await expect(filters.getByRole('radio')).toHaveCount(7)
  await expect(filters.getByRole('radio', { name: 'Original' })).toHaveAttribute('aria-checked', 'true')
  // Each tile shows the picture itself.
  await expect(filters.locator('img').first()).toHaveJSProperty('complete', true)

  await filters.getByRole('radio', { name: 'Warm' }).click()
  await choose(card.getByRole('combobox', { name: 'Fit' }), 'fit')
  await expect.poll(() => imageOf(page)).toMatchObject({ filter: 'warm', fit: 'fit' })

  await card.getByRole('button', { name: 'Fine-tune' }).click()
  await enter(card.getByRole('textbox', { name: 'Image opacity' }), '80')
  await enter(card.getByRole('textbox', { name: 'Contrast' }), '30')
  await enter(card.getByRole('textbox', { name: 'Saturation' }), '-250')
  await card.getByRole('textbox', { name: 'Exposure' }).press('Shift+ArrowUp')
  await expect.poll(() => imageOf(page)).toMatchObject({ opacity: 0.8, adjust: { exposure: 10, contrast: 30, saturation: -100, temperature: 0, tint: 0 } })
  await page.evaluate(() => window.dazbee?.drawn())
  writeOutput('image-card.png', await page.screenshot())

  // Original takes the filter off again.
  await filters.getByRole('radio', { name: 'Original' }).click()
  await expect.poll(async () => (await imageOf(page))?.filter).toBeUndefined()
  expect(errors).toEqual([])
})
