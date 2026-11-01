// The Box and paragraphs card (#153) in Chromium, with real input: box mode, lines at most and
// lifting the limit, paragraph spacing, lists, underline and strikethrough, shrinking to fit with
// its sizes, and an outline with its width and colour.
import { expect, test, type Locator, type Page } from '../support/test.ts'
import type { DesignInput } from '@dazbee/schema'
import { writeOutput } from '../support/editor.ts'
import { openStage, unfoldAll } from '../support/stage.ts'
import { choose } from '../support/select.ts'

test.describe.configure({ timeout: 120_000 })

const design = (): DesignInput => ({
  meta: { schemaVersion: 3, designId: 'replaced-by-the-api', name: 'Paragraphs', kind: 'single', primaryFormatId: 'sq' },
  formats: { sq: { name: 'Square', width: 1080, height: 1080, order: 'a0' } },
  pages: { p1: { name: 'Page 1', order: 'a0', fills: [{ type: 'solid', color: '#FFF8F0FF' }] } },
  nodes: {
    copy: {
      type: 'text', parentId: 'p1', index: 'a0', name: 'Copy',
      props: {
        x: 80, y: 80, width: 920, height: 600,
        text: 'Cold brew is back\nOat milk on the house\nEvery weekend this summer',
        style: { fontFamily: 'Noto Sans', fontSize: 72, fontWeight: 800, color: '#1A1420FF' },
      },
    },
  },
  overrides: {},
})

type TextProps = Record<string, unknown> & { style: Record<string, unknown> }
const copy = (page: Page) => page.evaluate(() => window.dazbee?.design().nodes.copy?.props) as Promise<TextProps>
const enter = async (field: Locator, value: string) => {
  await field.fill(value)
  await field.press('Enter')
}

test('the Box and paragraphs card sets the box, lines, lists, decoration, fit and outline', async ({ browser }) => {
  const { page, errors } = await openStage(browser, design())
  await page.evaluate(() => window.dazbee?.select(['copy']))
  await unfoldAll(page)
  const card = page.getByTestId('paragraph-card')
  await expect(card).toBeVisible()

  await choose(card.getByRole('combobox', { name: 'Box' }), 'fixed')
  await choose(card.getByRole('combobox', { name: 'List' }), 'bullet')
  await enter(card.getByRole('textbox', { name: 'Paragraph spacing' }), '24')
  await enter(card.getByRole('textbox', { name: 'Lines at most' }), '2')
  await expect.poll(() => copy(page)).toMatchObject({ boxMode: 'fixed', list: 'bullet', paragraphSpacing: 24, maxLines: 2 })

  await card.getByRole('button', { name: 'Underline' }).click()
  await card.getByRole('button', { name: 'Strikethrough' }).click()
  await card.getByRole('button', { name: 'Strikethrough' }).click()
  await expect(card.getByRole('button', { name: 'Underline' })).toHaveAttribute('aria-pressed', 'true')
  await expect.poll(async () => (await copy(page)).style).toMatchObject({ underline: true, strikethrough: false })

  await card.getByRole('button', { name: 'Outline', exact: true }).click()
  await enter(card.getByRole('textbox', { name: 'Outline width' }), '4')
  await enter(card.getByRole('textbox', { name: 'Outline hex' }), 'ff3d6e')
  await expect.poll(async () => (await copy(page)).style.outline).toEqual({ width: 4, color: '#FF3D6EFF' })
  await page.evaluate(() => window.dazbee?.drawn())
  writeOutput('paragraph-card.png', await page.screenshot())

  // Shrink to fit starts from half the size up to the size; the smallest can't pass the largest.
  await card.getByRole('button', { name: 'Shrink to fit' }).click()
  await expect.poll(async () => (await copy(page)).shrinkToFit).toEqual({ min: 36, max: 72 })
  await enter(card.getByRole('textbox', { name: 'Smallest size' }), '90')
  await expect.poll(async () => (await copy(page)).shrinkToFit).toEqual({ min: 72, max: 72 })

  // 0 lines lifts the limit; turning things off removes them.
  await enter(card.getByRole('textbox', { name: 'Lines at most' }), '0')
  await choose(card.getByRole('combobox', { name: 'List' }), 'none')
  await card.getByRole('button', { name: 'Shrink to fit' }).click()
  await card.getByRole('button', { name: 'Outline', exact: true }).click()
  await expect.poll(async () => {
    const props = await copy(page)
    return [props.maxLines, props.list, props.shrinkToFit, props.style.outline]
  }).toEqual([undefined, undefined, undefined, undefined])
  await expect(card.getByRole('textbox', { name: 'Lines at most' })).toHaveValue('')

  // One undo takes the outline back.
  await page.evaluate(() => window.dazbee?.perform('undo'))
  await expect.poll(async () => (await copy(page)).style.outline).toEqual({ width: 4, color: '#FF3D6EFF' })
  expect(errors).toEqual([])
})
