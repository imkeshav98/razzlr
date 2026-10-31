// Formats from presets (#38): add a story from the presets, see it start from the primary
// format's layout, rename it, show it alone, remove it and undo, all through the inspector.
import { expect, test, type Page } from '../support/test.ts'
import { designOf, openTabs, writeOutput } from '../support/editor.ts'

interface Design {
  meta: { primaryFormatId: string }
  formats: Record<string, { name: string; width: number; height: number }>
  overrides: Record<string, Record<string, Record<string, unknown>>>
}
const designIn = async (page: Page) => JSON.parse(await designOf(page)) as Design

test('a format added from presets starts from the primary layout, and is renamed, shown alone, removed and brought back', async ({ browser }) => {
  test.setTimeout(90_000)
  const { tabs, errors } = await openTabs(browser, 1)
  const page = tabs[0] as Page
  await page.setViewportSize({ width: 1440, height: 900 })
  const formats = page.getByTestId('formats')
  await expect(formats.getByRole('listitem')).toHaveCount(1)

  // Presets grouped by shape, and a custom size checked as it is typed.
  await page.getByRole('button', { name: 'Add format' }).click()
  const popover = page.getByRole('dialog', { name: 'Add format' })
  for (const shape of ['Square', 'Portrait', 'Tall', 'Landscape', 'Wide']) await expect(popover.getByRole('group', { name: shape })).toBeVisible()
  await popover.getByLabel('Width').fill('1600')
  await popover.getByLabel('Height').fill('500')
  await expect(popover.getByRole('alert')).toHaveText('Sizes run from 1:3 to 3:1.')
  await expect(popover.getByRole('button', { name: 'Add', exact: true })).toBeDisabled()
  await popover.getByLabel('Width').fill('1500')
  await expect(popover.getByRole('alert')).toHaveText('')
  writeOutput('formats-0-add.png', await page.screenshot())

  await popover.locator('[data-preset=story]').click()
  await expect(popover).toBeHidden()
  await expect(formats.getByRole('listitem')).toHaveCount(2)
  let design = await designIn(page)
  const story = Object.keys(design.formats).find((id) => design.formats[id]?.name === 'Story') ?? ''
  expect(design.formats[story]).toMatchObject({ width: 1080, height: 1920 })
  // The square's layout, 1080 wide either way, sits 420 px down the story: the middle.
  expect(design.overrides[`format:${story}`]?.headline).toEqual({ x: 80, y: 900, width: 920, height: 120 })
  expect(design.overrides[`format:${story}`]?.box).toEqual({ x: 80, y: 500, width: 300, height: 200 })
  await expect(page.locator(`.frame-label[data-frame="p1/${story}"]`)).toContainText('Story')
  writeOutput('formats-1-story-added.png', await page.screenshot())

  // Rename in place.
  const row = formats.locator(`[data-format="${story}"]`)
  await row.getByRole('button', { name: 'Rename: Story' }).dblclick()
  await row.getByRole('textbox', { name: 'Rename' }).fill('Reel')
  await row.getByRole('textbox', { name: 'Rename' }).press('Enter')
  await expect.poll(async () => (await designIn(page)).formats[story]?.name).toBe('Reel')
  await expect(page.locator(`.frame-label[data-frame="p1/${story}"]`)).toContainText('Reel')

  // Shown alone, then every format again.
  await row.hover()
  await row.getByRole('button', { name: 'Show alone' }).click()
  await expect(page.getByTestId('focus-chip')).toContainText('Showing Reel alone')
  expect(await page.evaluate(() => window.razzlr?.frames().map((f) => f.formatId))).toEqual([story])
  writeOutput('formats-2-focus.png', await page.screenshot())
  await page.getByTestId('focus-chip').getByRole('button', { name: 'Show all formats' }).click()
  await expect(page.getByTestId('focus-chip')).toBeHidden()
  expect(await page.evaluate(() => window.razzlr?.frames().length)).toBe(2)

  // Remove, then undo from the toast: the format and its layout come back whole.
  await row.hover()
  await row.getByRole('button', { name: 'Remove format' }).click()
  await expect(formats.getByRole('listitem')).toHaveCount(1)
  design = await designIn(page)
  expect(design.formats[story]).toBeUndefined()
  expect(design.overrides[`format:${story}`]).toBeUndefined()
  const toast = page.getByTestId('removed-toast')
  await expect(toast).toContainText('Reel removed')
  await toast.hover()
  writeOutput('formats-3-removed.png', await page.screenshot())
  await toast.getByRole('button', { name: 'Undo' }).click()
  await expect(formats.getByRole('listitem')).toHaveCount(2)
  design = await designIn(page)
  expect(design.formats[story]).toMatchObject({ name: 'Reel', width: 1080, height: 1920 })
  expect(design.overrides[`format:${story}`]?.headline).toEqual({ x: 80, y: 900, width: 920, height: 120 })

  // The primary format can't be removed; making the story primary moves the star.
  const square = formats.locator('[data-format="sq"]')
  await square.hover()
  await expect(square.getByRole('button', { name: 'Remove format' })).toBeDisabled()
  await row.hover()
  await row.getByRole('button', { name: 'Make primary' }).click()
  await expect.poll(async () => (await designIn(page)).meta.primaryFormatId).toBe(story)
  writeOutput('formats-4-primary.png', await page.screenshot())
  expect(errors).toEqual([])
})
