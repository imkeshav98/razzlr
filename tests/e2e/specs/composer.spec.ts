// The brief's toolbar (#136) in Chromium: the Formats dropdown picks what Make drafts makes and
// keeps one picked, + adds a reference ad or images uploaded to the brand's assets as thumbnails
// above the brief, and Brand kit opens the whole kit to pick from. Each choice is a form field.
import { AssetSummary, EMPTY_BRAND_KIT, type BrandKit } from '@razzlr/schema'
import { expect, test } from '../support/test.ts'
import { photo } from '../support/assets.ts'
import { writeOutput } from '../support/editor.ts'
import { API_URL, DEV_BRAND, liveDesign, seed } from '../support/seed.ts'

test.use({ viewport: { width: 1440, height: 900 } })

const putKit = (brandId: string, kit: BrandKit) =>
  fetch(`${API_URL}/brands/${brandId}/kit`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(kit) })

test('the Formats dropdown picks the formats Make drafts makes, and one always stays picked', async ({ page }) => {
  // The home, then the editor opening, which alone may take its 30 s on a busy runner.
  test.setTimeout(60_000)
  await page.goto(`/brands/${DEV_BRAND}`)
  const button = page.getByTestId('brief-formats')
  const dropdown = page.getByRole('dialog', { name: 'Formats' })
  await expect(button).toHaveText(/1 format/)
  await button.click()
  await expect(page.getByTestId('brief-format-feed-square')).toBeChecked()
  // Square is the only one picked, so it stays.
  await dropdown.getByText('Square', { exact: true }).click()
  await expect(page.getByTestId('brief-format-feed-square')).toBeChecked()
  await dropdown.getByText('Story', { exact: true }).click()
  await expect(page.getByTestId('brief-format-story')).toBeChecked()
  await expect(button).toHaveText(/2 formats/)
  writeOutput('composer-0-formats.png', await page.screenshot())

  await page.keyboard.press('Escape')
  await expect(dropdown).toBeHidden()
  await expect(button).toBeFocused()

  const brief = `Two formats ${crypto.randomUUID().slice(0, 6)}`
  await page.getByLabel('Brief').fill(brief)
  await page.getByRole('button', { name: 'Make drafts' }).click()
  await expect(page).toHaveURL(new RegExp(`/brands/${DEV_BRAND}/designs/[\\w-]+$`), { timeout: 20_000 })
  await expect(page.getByTestId('status')).toHaveAttribute('data-ready', '', { timeout: 30_000 })
  const design = await page.evaluate(() => window.razzlr?.design())
  expect(design?.meta.name).toBe(brief)
  expect(Object.values(design?.formats ?? {}).map((f) => [f.width, f.height])).toEqual([[1080, 1080], [1080, 1920]])
})

test('+ adds a reference ad and uploaded images above the brief, each taken off again by its ✕', async ({ page }) => {
  test.setTimeout(60_000)
  const run = crypto.randomUUID().slice(0, 6)
  const name = `Reference ${run}`
  const designId = await seed(liveDesign(), name)
  await page.goto(`/brands/${DEV_BRAND}`)
  const add = page.getByRole('button', { name: 'Add a reference or images' })

  // A reference ad: one of the brand's designs.
  await add.click()
  await page.getByRole('button', { name: /^Reference ad/ }).click()
  await page.getByTestId('brief-references').getByRole('button', { name }).click()
  const reference = page.getByTestId('brief-reference')
  await expect(reference).toBeVisible()
  await expect(page.locator('input[name="reference"]')).toHaveValue(designId)
  writeOutput('composer-1-reference.png', await page.screenshot())
  await reference.getByRole('button', { name: `Remove ${name}` }).click()
  await expect(reference).toHaveCount(0)
  await expect(page.locator('input[name="reference"]')).toHaveCount(0)

  // Images: chosen from the + menu, uploaded into the brand's assets.
  await add.click()
  const chooser = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: /^Upload images/ }).click()
  await (await chooser).setFiles([{ name: `sneaker-${run}.jpg`, mimeType: 'image/jpeg', buffer: Buffer.from(photo) }])
  const image = page.getByTestId('brief-image')
  await expect(image.locator('img')).toBeVisible({ timeout: 20_000 })
  const assetId = await page.locator('input[name="image"]').inputValue()
  const assets = AssetSummary.array().parse(await (await fetch(`${API_URL}/brands/${DEV_BRAND}/assets`)).json())
  expect(assets.map((a) => a.id)).toContain(assetId)
  writeOutput('composer-2-image.png', await page.screenshot())
  await image.getByRole('button', { name: `Remove sneaker-${run}.jpg` }).click()
  await expect(image).toHaveCount(0)
  await expect(page.locator('input[name="image"]')).toHaveCount(0)
})

test('Brand kit opens the whole kit: the switch, and each colour, font and the voice picked or not', async ({ page }) => {
  // A brand of its own here, so the brand kit checks elsewhere never change it under this one.
  const brandId = 'dev-brand-cycles'
  const kit: BrandKit = {
    colors: [{ token: 'ink', name: 'Ink', value: '#1A1420FF' }, { token: 'pop', name: 'Pop pink', value: '#FF48B0FF' }],
    fonts: [{ token: 'heading', name: 'Headings', family: 'Bricolage Grotesque' }],
    logoAssetId: null,
    voice: 'Warm, quick and never pushy.',
  }
  expect((await putKit(brandId, kit)).ok).toBe(true)
  try {
    await page.goto(`/brands/${brandId}`)
    const button = page.getByTestId('brief-kit')
    await expect(button).toHaveAttribute('aria-pressed', 'true')
    await button.click()
    const panel = page.getByTestId('brief-kit-panel')
    await expect(panel).toContainText('2 of 2 colours, 1 of 1 fonts')
    await expect(panel).toContainText('Warm, quick and never pushy.')
    await expect(page.locator('input[name="kitColor"]')).toHaveCount(2)

    // Leave one colour out.
    const pink = panel.getByRole('button', { name: 'Pop pink' })
    await pink.click()
    await expect(pink).toHaveAttribute('aria-pressed', 'false')
    await expect(panel).toContainText('1 of 2 colours')
    await expect(page.locator('input[name="kitColor"]')).toHaveCount(1)
    await expect(page.locator('input[name="kitColor"]')).toHaveValue('ink')
    await expect(page.locator('input[name="kitFont"]')).toHaveValue('heading')
    await expect(page.locator('input[name="kitVoice"]')).toHaveValue('on')
    writeOutput('composer-3-kit.png', await page.screenshot())

    // The switch turns the whole kit off: nothing of it is sent.
    const use = panel.getByRole('switch', { name: 'Use brand kit' })
    await use.click()
    await expect(use).toHaveAttribute('aria-checked', 'false')
    await expect(page.locator('input[name="kit"], input[name="kitColor"], input[name="kitFont"], input[name="kitVoice"]')).toHaveCount(0)

    await page.keyboard.press('Escape')
    await expect(panel).toBeHidden()
    await expect(button).toHaveAttribute('aria-pressed', 'false')
    await expect(button).toBeFocused()
  } finally {
    await putKit(brandId, EMPTY_BRAND_KIT)
  }
})
