// The properties cards (#60) in Chromium, with real input: change each property of one layer and of
// several, see mixed values, write a change to the format shown only, as a canvas drag does (and an
// every-format one as the base, with the override gone), and scrub a number as one undo step.
import { expect, test, type Locator, type Page } from '../support/test.ts'
import type { DesignInput } from '@dazbee/schema'
import { writeOutput } from '../support/editor.ts'
import { openStage, unfoldAll } from '../support/stage.ts'
import { choose } from '../support/select.ts'

test.describe.configure({ timeout: 120_000 })

const rect = (x: number, y: number, width: number, height: number, color: string) =>
  ({ x, y, width, height, shape: { kind: 'rect' as const, cornerRadius: 16 }, fills: [{ type: 'solid' as const, color }] })

const design = (): DesignInput => ({
  meta: { schemaVersion: 3, designId: 'replaced-by-the-api', name: 'Properties', kind: 'single', primaryFormatId: 'sq' },
  formats: {
    sq: { name: 'Square', width: 1080, height: 1080, order: 'a0' },
    story: { name: 'Story', width: 1080, height: 1920, order: 'a1' },
  },
  pages: { p1: { name: 'Page 1', order: 'a0', fills: [{ type: 'solid', color: '#FFFFFFFF' }] } },
  nodes: {
    box: { type: 'graphic', parentId: 'p1', index: 'a0', name: 'Box', props: rect(80, 80, 300, 200, '#E0262BFF') },
    dot: { type: 'graphic', parentId: 'p1', index: 'a1', name: 'Dot', props: { ...rect(700, 120, 240, 240, '#2F6BFFFF'), shape: { kind: 'ellipse' as const } } },
    headline: {
      type: 'text', parentId: 'p1', index: 'a2', name: 'Headline',
      props: { x: 80, y: 480, width: 920, height: 120, text: 'Summer sale', style: { fontFamily: 'Noto Sans', fontSize: 96, fontWeight: 800, color: '#111111FF' } },
    },
    stack: {
      type: 'frame', parentId: 'p1', index: 'a3', name: 'Stack',
      props: { x: 80, y: 700, width: 600, height: 160, fills: [{ type: 'solid', color: '#F4EDE4FF' }], layout: { direction: 'row', gap: 16, padding: { top: 20, right: 20, bottom: 20, left: 20 } } },
    },
    chip1: { type: 'graphic', parentId: 'stack', index: 'a0', name: 'Chip 1', props: rect(100, 720, 120, 120, '#FCA311FF') },
    chip2: { type: 'graphic', parentId: 'stack', index: 'a1', name: 'Chip 2', props: rect(236, 720, 120, 120, '#14213DFF') },
  },
  overrides: {},
})

type Node = { props: Record<string, unknown> }
const nodes = (page: Page) => page.evaluate(() => window.dazbee?.design().nodes) as Promise<Record<string, Node>>
const base = async (page: Page, id: string) => (await nodes(page))[id]?.props ?? {}
const overrides = (page: Page) => page.evaluate(() => JSON.parse(JSON.stringify(window.dazbee?.design().overrides ?? {}))) as Promise<Record<string, Record<string, Record<string, unknown>>>>
/** A layer's props as the Square format shows them: the base with Square's own on top. */
const props = async (page: Page, id: string) => ({ ...await base(page, id), ...(await overrides(page))['format:sq']?.[id] })
const select = async (page: Page, ids: string[]) => {
  await page.evaluate((ids) => window.dazbee?.select(ids), ids)
  await expect(page.getByTestId('layout-card')).toBeVisible()
  await unfoldAll(page)
}
/** Types a value into a field and presses Enter. */
const enter = async (field: Locator, value: string) => {
  await field.fill(value)
  await field.press('Enter')
}

test('one layer: position, size, turn, opacity, blend, fill, stroke and effects', async ({ browser }) => {
  const { page, errors } = await openStage(browser, design())
  await select(page, ['box'])
  const layout = page.getByTestId('layout-card')
  await expect(layout.getByRole('spinbutton', { name: 'X position' })).toHaveValue('80')

  await enter(layout.getByRole('spinbutton', { name: 'X position' }), '140')
  await expect.poll(async () => (await props(page, 'box')).x).toBe(140)
  await layout.getByRole('spinbutton', { name: 'Width' }).press('ArrowUp')
  await expect.poll(async () => (await props(page, 'box')).width).toBe(301)
  await layout.getByRole('spinbutton', { name: 'Width' }).press('Shift+ArrowUp')
  await expect.poll(async () => (await props(page, 'box')).width).toBe(311)
  await enter(layout.getByRole('spinbutton', { name: 'Rotation in degrees' }), '15')
  await expect.poll(async () => (await props(page, 'box')).rotation).toBe(15)

  const look = page.getByTestId('appearance-card')
  await enter(look.getByRole('spinbutton', { name: 'Opacity' }), '50')
  await expect.poll(async () => (await props(page, 'box')).opacity).toBe(0.5)
  await choose(look.getByRole('combobox', { name: 'Blend mode' }), 'multiply')
  await expect.poll(async () => (await props(page, 'box')).blendMode).toBe('multiply')

  const fill = page.getByTestId('fill-card')
  await enter(fill.getByRole('textbox', { name: 'Colour 1 hex' }), '00a889')
  await expect.poll(async () => (await props(page, 'box')).fills).toEqual([{ type: 'solid', color: '#00A889FF' }])
  await enter(fill.getByRole('textbox', { name: 'Colour 1 opacity' }), '80')
  await expect.poll(async () => (await props(page, 'box')).fills).toEqual([{ type: 'solid', color: '#00A889CC' }])
  await fill.getByRole('button', { name: 'Add fill' }).click()
  await expect.poll(async () => ((await props(page, 'box')).fills as unknown[]).length).toBe(2)
  await fill.getByRole('button', { name: 'Remove fill 2' }).click()
  await expect.poll(async () => ((await props(page, 'box')).fills as unknown[]).length).toBe(1)

  const stroke = page.getByTestId('stroke-card')
  await stroke.getByRole('button', { name: 'Add stroke' }).click()
  await expect.poll(async () => (await props(page, 'box')).strokes).toMatchObject([{ width: 2, align: 'center' }])
  await enter(stroke.getByRole('spinbutton', { name: 'Stroke 1 width' }), '6')
  await choose(stroke.getByRole('combobox', { name: 'Stroke 1 position' }), 'inside')
  await expect.poll(async () => (await props(page, 'box')).strokes).toMatchObject([{ width: 6, align: 'inside' }])
  // Dashes typed as lengths, an offset, and the look of the ends and corners (#152); a pattern
  // that isn't one is refused, and clearing it makes the line solid again.
  await enter(stroke.getByRole('textbox', { name: 'Stroke 1 dashes' }), '12, 6')
  await enter(stroke.getByRole('spinbutton', { name: 'Stroke 1 dash offset' }), '3')
  await choose(stroke.getByRole('combobox', { name: 'Stroke 1 ends' }), 'round')
  await choose(stroke.getByRole('combobox', { name: 'Stroke 1 corners' }), 'bevel')
  await expect.poll(async () => (await props(page, 'box')).strokes).toMatchObject([{ width: 6, align: 'inside', dashes: [12, 6], dashOffset: 3, cap: 'round', join: 'bevel' }])
  await page.evaluate(() => window.dazbee?.drawn())
  writeOutput('props-dashed-stroke.png', await page.screenshot())
  await enter(stroke.getByRole('textbox', { name: 'Stroke 1 dashes' }), '0 0')
  await expect(stroke.getByRole('textbox', { name: 'Stroke 1 dashes' })).toHaveValue('12 6')
  await enter(stroke.getByRole('textbox', { name: 'Stroke 1 dashes' }), '')
  await expect.poll(async () => (await props(page, 'box')).strokes).toMatchObject([{ dashes: [] }])

  const effects = page.getByTestId('effects-card')
  await choose(effects.getByRole('combobox', { name: 'Add effect' }), 'dropShadow')
  await expect.poll(async () => (await props(page, 'box')).effects).toMatchObject([{ type: 'dropShadow', blur: 24 }])
  await enter(effects.getByRole('spinbutton', { name: 'Drop shadow 1 Blur' }), '40')
  await expect.poll(async () => (await props(page, 'box')).effects).toMatchObject([{ type: 'dropShadow', blur: 40 }])

  // Like a drag, every change is Square's own: the base and Story are as they were.
  const o = await overrides(page)
  expect(o['format:sq']?.box).toMatchObject({ x: 140, width: 311, rotation: 15, opacity: 0.5, blendMode: 'multiply' })
  expect(await base(page, 'box')).toMatchObject({ ...rect(80, 80, 300, 200, '#E0262BFF'), rotation: 0, opacity: 1, blendMode: 'normal', strokes: [], effects: [] })
  expect(o['format:story']?.box ?? {}).toEqual({})
  await page.evaluate(() => window.dazbee?.drawn())
  writeOutput('props-0-one-layer.png', await page.screenshot())
  expect(errors).toEqual([])
})

test('several layers: mixed values, set together or each from its own; text and auto layout', async ({ browser }) => {
  const { page, errors } = await openStage(browser, design())
  await select(page, ['box', 'dot'])
  const layout = page.getByTestId('layout-card')
  const x = layout.getByRole('spinbutton', { name: 'X position' })
  await expect(x).toHaveValue('')
  await expect(x).toHaveAttribute('placeholder', 'Mixed')
  await expect(page.getByTestId('fill-card')).toContainText('The selected layers differ.')
  writeOutput('props-1-mixed.png', await page.screenshot())

  // The arrow moves each from its own; Enter gives both the same.
  await x.press('ArrowUp')
  await expect.poll(async () => [(await props(page, 'box')).x, (await props(page, 'dot')).x]).toEqual([81, 701])
  await enter(layout.getByRole('spinbutton', { name: 'Y position' }), '300')
  await expect.poll(async () => [(await props(page, 'box')).y, (await props(page, 'dot')).y]).toEqual([300, 300])
  await expect(layout.getByRole('spinbutton', { name: 'Y position' })).toHaveValue('300')
  await page.getByTestId('fill-card').getByRole('button', { name: 'Use one for all' }).click()
  await expect.poll(async () => [(await props(page, 'box')).fills, (await props(page, 'dot')).fills]).toEqual([[{ type: 'solid', color: '#D9D9D9FF' }], [{ type: 'solid', color: '#D9D9D9FF' }]])
  await enter(page.getByTestId('fill-card').getByRole('textbox', { name: 'Colour 1 hex' }), '#FFB020')
  await expect.poll(async () => [(await props(page, 'box')).fills, (await props(page, 'dot')).fills]).toEqual([[{ type: 'solid', color: '#FFB020FF' }], [{ type: 'solid', color: '#FFB020FF' }]])
  await enter(page.getByTestId('appearance-card').getByRole('spinbutton', { name: 'Opacity' }), '75')
  await expect.poll(async () => [(await props(page, 'box')).opacity, (await props(page, 'dot')).opacity]).toEqual([0.75, 0.75])

  // Text.
  await select(page, ['headline'])
  const text = page.getByTestId('text-card')
  await enter(page.getByTestId('text-look').getByRole('spinbutton', { name: 'Size' }), '120')
  await enter(text.getByRole('spinbutton', { name: 'Letter spacing' }), '2')
  await enter(text.getByRole('spinbutton', { name: 'Line height' }), '1.1')
  await enter(text.getByRole('textbox', { name: 'Text colour hex' }), '1f9d55')
  await choose(text.getByRole('combobox', { name: 'Alignment', exact: true }), 'center')
  await choose(text.getByRole('combobox', { name: 'Case' }), 'upper')
  await expect.poll(async () => {
    const p = await props(page, 'headline')
    return { style: p.style, align: p.align }
  }).toMatchObject({ style: { fontSize: 120, letterSpacing: 2, lineHeight: 1.1, color: '#1F9D55FF', textCase: 'upper', fontFamily: 'Noto Sans', fontWeight: 800 }, align: 'center' })
  await page.evaluate(() => window.dazbee?.drawn())
  writeOutput('props-2-text.png', await page.screenshot())

  // Auto layout.
  await select(page, ['stack'])
  const auto = page.getByTestId('auto-layout-card')
  await enter(auto.getByRole('spinbutton', { name: 'Gap', exact: true }), '32')
  await choose(auto.getByRole('combobox', { name: 'Direction' }), 'column')
  await enter(auto.getByRole('spinbutton', { name: 'Padding left' }), '40')
  await expect.poll(async () => (await props(page, 'stack')).layout).toMatchObject({ direction: 'column', gap: 32, padding: { left: 40, top: 20 } })
  await page.evaluate(() => window.dazbee?.drawn())
  writeOutput('props-3-auto-layout.png', await page.screenshot())
  expect(errors).toEqual([])
})

test('a change goes to the format shown, like a drag; all formats writes the base and clears it', async ({ browser }) => {
  const { page, errors } = await openStage(browser, design())
  await select(page, ['box'])
  const scope = page.getByTestId('scope-card')
  await expect(scope.getByRole('radio', { name: 'This format' })).toHaveAttribute('aria-checked', 'true')
  await expect(scope).not.toContainText('Changes go to every format')
  const x = page.getByTestId('layout-card').getByRole('spinbutton', { name: 'X position' })
  await enter(x, '500')
  await enter(page.getByTestId('fill-card').getByRole('textbox', { name: 'Colour 1 hex' }), '00A889')
  await expect.poll(async () => (await overrides(page))['format:sq']?.box).toMatchObject({ x: 500, fills: [{ type: 'solid', color: '#00A889FF' }] })
  // The base and the other format are as they were.
  expect((await base(page, 'box')).x).toBe(80)
  expect((await base(page, 'box')).fills).toEqual([{ type: 'solid', color: '#E0262BFF' }])
  expect((await overrides(page))['format:story']?.box ?? {}).toEqual({})
  await expect(x).toHaveValue('500')
  writeOutput('props-4-this-format.png', await page.screenshot())

  // All formats: the value goes to the base and this format's override of it goes.
  await scope.getByRole('radio', { name: 'All formats' }).click()
  await expect(scope).toContainText('Changes go to every format')
  await enter(x, '200')
  await expect.poll(async () => (await base(page, 'box')).x).toBe(200)
  const after = (await overrides(page))['format:sq']?.box ?? {}
  expect(after).not.toHaveProperty('x')
  // The fill override stays: only the property changed is made the same everywhere.
  expect(after).toHaveProperty('fills')
  expect(errors).toEqual([])
})

test('scrubbing a number is one undo step', async ({ browser }) => {
  const { page, errors } = await openStage(browser, design())
  await select(page, ['box', 'dot'])
  const handle = page.getByTestId('layout-card').locator('[data-scrub="X position"]')
  const box = await handle.boundingBox()
  if (!box) throw new Error('no scrub handle')
  const start = { x: box.x + box.width / 2, y: box.y + box.height / 2 }
  await page.mouse.move(start.x, start.y)
  await page.mouse.down()
  for (let i = 1; i <= 12; i++) await page.mouse.move(start.x + i * 5, start.y)
  await page.mouse.up()
  // 60 px to the end at a step per 2 px: each 30 further on, from its own.
  await expect.poll(async () => [(await props(page, 'box')).x, (await props(page, 'dot')).x]).toEqual([110, 730])
  writeOutput('props-5-scrubbed.png', await page.screenshot())
  await page.evaluate(() => window.dazbee?.perform('undo'))
  await expect.poll(async () => [(await props(page, 'box')).x, (await props(page, 'dot')).x]).toEqual([80, 700])
  // And redo brings the whole scrub back.
  await page.evaluate(() => window.dazbee?.perform('redo'))
  await expect.poll(async () => [(await props(page, 'box')).x, (await props(page, 'dot')).x]).toEqual([110, 730])
  expect(errors).toEqual([])
})
