// A format's own changes (#157) in Chromium: the scope card lists, by card, what the format shown
// has of its own for the selected layers, and each one, or all of them, goes back to following the
// other formats in one undo step.
import { expect, test, type Locator, type Page } from '../support/test.ts'
import type { DesignInput } from '@dazbee/schema'
import { writeOutput } from '../support/editor.ts'
import { openStage, unfoldAll } from '../support/stage.ts'

test.describe.configure({ timeout: 120_000 })

const design = (): DesignInput => ({
  meta: { schemaVersion: 3, designId: 'replaced-by-the-api', name: 'Own changes', kind: 'single', primaryFormatId: 'sq' },
  formats: {
    sq: { name: 'Square', width: 1080, height: 1080, order: 'a0' },
    story: { name: 'Story', width: 1080, height: 1920, order: 'a1' },
  },
  pages: { p1: { name: 'Page 1', order: 'a0', fills: [{ type: 'solid', color: '#FFFFFFFF' }] } },
  nodes: {
    box: { type: 'graphic', parentId: 'p1', index: 'a0', name: 'Box', props: { x: 80, y: 80, width: 300, height: 200, shape: { kind: 'rect' }, fills: [{ type: 'solid', color: '#E0262BFF' }] } },
  },
  overrides: {},
})

const squareOwn = (page: Page) => page.evaluate(() => JSON.parse(JSON.stringify(window.dazbee?.design().overrides['format:sq']?.box ?? {}))) as Promise<Record<string, unknown>>
const enter = async (field: Locator, value: string) => {
  await field.fill(value)
  await field.press('Enter')
}

test('the scope card lists what this format has of its own and resets it', async ({ browser }) => {
  const { page, errors } = await openStage(browser, design())
  await page.evaluate(() => window.dazbee?.select(['box']))
  await unfoldAll(page)
  const scope = page.getByTestId('scope-card')
  await expect(scope.getByTestId('own-changes')).toHaveCount(0)

  // Changes made to this format only show up, grouped as the cards are.
  await enter(page.getByTestId('layout-card').getByRole('spinbutton', { name: 'X position' }), '200')
  await enter(page.getByTestId('layout-card').getByRole('spinbutton', { name: 'Width' }), '400')
  await enter(page.getByTestId('fill-card').getByRole('textbox', { name: 'Colour 1 hex' }), '14213d')
  await expect.poll(() => squareOwn(page)).toMatchObject({ x: 200, width: 400 })
  const own = scope.getByTestId('own-changes')
  await expect(own).toContainText('Square has its own')
  await expect(own.getByRole('listitem')).toHaveText(['Position and size', 'Fill'])
  writeOutput('own-changes.png', await page.screenshot())

  // One group back to the base, then all of it; one undo brings the group back.
  await own.getByRole('button', { name: 'Reset Fill to follow the other formats' }).click()
  await expect.poll(async () => Object.keys(await squareOwn(page)).sort()).toEqual(['width', 'x'])
  await page.evaluate(() => window.dazbee?.perform('undo'))
  await expect.poll(async () => Object.keys(await squareOwn(page)).sort()).toEqual(['fills', 'width', 'x'])
  await own.getByRole('button', { name: 'Reset all' }).click()
  await expect.poll(() => squareOwn(page)).toEqual({})
  await expect(scope.getByTestId('own-changes')).toHaveCount(0)
  await expect(page.getByTestId('layout-card').getByRole('spinbutton', { name: 'X position' })).toHaveValue('80')
  expect(errors).toEqual([])
})
