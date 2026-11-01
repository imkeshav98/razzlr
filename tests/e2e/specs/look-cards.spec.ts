// The visual-first property cards (layout A, as in the final mock) in Chromium: text's size on a
// slider and its colour from the brand kit, the effects as tiles, and the numbers folded into the
// Details card's rows, each showing its values until it opens.
import { expect, test, type Page } from '../support/test.ts'
import { EMPTY_BRAND_KIT, type DesignInput } from '@razzlr/schema'
import { writeOutput } from '../support/editor.ts'
import { API_URL, DEV_BRAND } from '../support/seed.ts'
import { openStage } from '../support/stage.ts'

test.describe.configure({ timeout: 120_000 })

const design = (): DesignInput => ({
  meta: { schemaVersion: 2, designId: 'replaced-by-the-api', name: 'Look cards', kind: 'single', primaryFormatId: 'sq' },
  formats: { sq: { name: 'Square', width: 1080, height: 1080, order: 'a0' } },
  pages: { p1: { name: 'Page 1', order: 'a0', fills: [{ type: 'solid', color: '#FF8A3DFF' }] } },
  nodes: {
    headline: {
      type: 'text', parentId: 'p1', index: 'a0', name: 'Headline',
      props: { x: 76, y: 162, width: 610, height: 204, text: 'Cold brew is back', style: { fontFamily: 'Noto Sans', fontSize: 96, fontWeight: 800, color: '#FFFFFFFF' } },
    },
    badge: {
      type: 'graphic', parentId: 'p1', index: 'a1', name: 'Badge',
      props: { x: 80, y: 700, width: 280, height: 280, shape: { kind: 'ellipse' }, fills: [{ type: 'solid', color: '#FFE14DFF' }] },
    },
  },
  overrides: {},
})

type Node = { bindings?: Record<string, string>; props: Record<string, unknown> & { style?: Record<string, unknown> } }
const node = (page: Page, id: string) => page.evaluate((id) => window.razzlr?.design().nodes[id], id) as Promise<Node>

test('the look comes first: size and brand colour, effect tiles, and the numbers folded', async ({ browser }) => {
  const kit = { ...EMPTY_BRAND_KIT, colors: [{ token: 'berry', name: 'Berry', value: '#FF3D6EFF' }, { token: 'roast', name: 'Roast', value: '#2A140AFF' }] }
  expect((await fetch(`${API_URL}/brands/${DEV_BRAND}/kit`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(kit) })).ok).toBe(true)
  const { page, errors } = await openStage(browser, design())
  await page.evaluate(() => window.razzlr?.select(['headline']))

  // Text: the size slider and the brand's colours, the colour it has now leading them.
  const look = page.getByTestId('text-look')
  await look.getByRole('slider', { name: 'Size' }).fill('64')
  await expect.poll(async () => (await node(page, 'headline')).props.style?.fontSize).toBe(64)
  const colours = look.getByRole('group', { name: 'Brand colours' })
  await expect(colours.getByRole('button')).toHaveCount(3)
  await expect(colours.getByRole('button', { name: 'Now #FFFFFF' })).toHaveAttribute('aria-pressed', 'true')
  await colours.getByRole('button', { name: 'Berry' }).click()
  await expect.poll(async () => (await node(page, 'headline')).bindings).toMatchObject({ textColor: 'brand:berry' })
  await expect(colours.getByRole('button', { name: 'Berry' })).toHaveAttribute('aria-pressed', 'true')

  // Effects as tiles: None to start, Shadow and Outline on together, None takes both off.
  const effects = page.getByTestId('effects-card')
  await expect(effects.locator('[data-tile="none"]')).toHaveAttribute('aria-pressed', 'true')
  await effects.locator('[data-tile="shadow"]').click()
  await effects.locator('[data-tile="outline"]').click()
  await expect.poll(async () => {
    const props = (await node(page, 'headline')).props
    return [(props.effects as { type: string }[]).map((e) => e.type), (props.style?.outline as { width: number } | undefined)?.width]
  }).toEqual([['dropShadow'], 2])
  await expect(effects.locator('[data-tile="none"]')).toHaveAttribute('aria-pressed', 'false')
  await page.evaluate(() => window.razzlr?.drawn())
  writeOutput('look-cards-text.png', await page.screenshot())
  // Fine-tune opens the picked effect's numbers.
  await effects.getByRole('button', { name: 'Fine-tune' }).click()
  await expect(effects.getByRole('textbox', { name: 'Drop shadow 1 Blur' })).toBeVisible()
  await effects.locator('[data-tile="none"]').click()
  await expect.poll(async () => {
    const props = (await node(page, 'headline')).props
    return [(props.effects as unknown[]).length, props.style?.outline]
  }).toEqual([0, undefined])

  // The numbers sit folded in Details, each row saying its values, and open in place.
  const details = page.getByTestId('details-card')
  const position = details.getByTestId('layout-card')
  await expect(position.locator('[data-fold]')).toHaveAttribute('aria-expanded', 'false')
  await expect(position).toContainText('76, 162 · 610×204')
  await expect(position.getByRole('textbox', { name: 'X position' })).toHaveCount(0)
  await position.locator('[data-fold]').click()
  await expect(position.getByRole('textbox', { name: 'X position' })).toHaveValue('76')

  // A shape: its fill from the same colours, and Blur in place of Outline; the open row stays open.
  await page.evaluate(() => window.razzlr?.select(['badge']))
  await expect(page.getByTestId('effects-card').locator('[data-tile="blur"]')).toBeVisible()
  await page.getByTestId('fill-look').getByRole('button', { name: 'Roast' }).click()
  await expect.poll(async () => (await node(page, 'badge')).bindings).toMatchObject({ fill: 'brand:roast' })
  await expect(details.getByTestId('layout-card').locator('[data-fold]')).toHaveAttribute('aria-expanded', 'true')
  writeOutput('look-cards-shape.png', await page.screenshot())
  expect(errors).toEqual([])
})
