// Every control in the editor's panels (#235), one test per row of the inventory, in Chromium with
// real input. Each control is used and the design checked: the document holds the change, the
// export draws it, one undo takes it back and redo brings it again, and it is there after a reload.
// The panel redesign runs the same list, so a control that goes missing fails here. Rows known to
// fail have their bug in KNOWN; such a test is expected to fail, and passes once the bug is fixed.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test, type Browser, type Locator, type Page } from '../support/test.ts'
import { EMPTY_BRAND_KIT, type DesignInput } from '@dazbee/schema'
import { photo, upload } from '../support/assets.ts'
import { designOf, placed, synced, writeOutput } from '../support/editor.ts'
import { importGoogleFonts } from '../support/fonts.ts'
import { API_URL, DEV_BRAND } from '../support/seed.ts'
import { choose } from '../support/select.ts'
import { drag, openStage, unfoldAll } from '../support/stage.ts'

// Each row opens its own design, so CI spreads the rows over its shards.
test.describe.configure({ mode: 'parallel', timeout: 180_000 })
// A control that isn't there fails the row soon, not at the end of its time.
test.use({ actionTimeout: 15_000 })

/** Rows that fail today, with the bug filed for each. */
const KNOWN: Record<number, number> = { 12: 243, 16: 244, 25: 246 }

const righteous = new Uint8Array(readFileSync(join(import.meta.dirname, '..', 'assets', 'fonts', 'Righteous-Regular.ttf')))
const tile = new Uint8Array(readFileSync(join(import.meta.dirname, '..', '..', 'pixels', 'assets', 'tile.jpg')))
const KIT = {
  ...EMPTY_BRAND_KIT,
  colors: [{ token: 'berry', name: 'Berry', value: '#FF3D6EFF' }, { token: 'roast', name: 'Roast', value: '#2A140AFF' }],
  fonts: [{ token: 'body', name: 'Body', family: 'Noto Sans' }],
}

let assets: { photo: string; tile: string }
test.beforeAll(async () => {
  assets = { photo: (await upload(photo)).id, tile: (await upload(tile)).id }
  expect((await fetch(`${API_URL}/brands/${DEV_BRAND}/kit`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(KIT) })).ok).toBe(true)
})

const solid = (color: string) => [{ type: 'solid' as const, color }]
const rect = (x: number, y: number, width: number, height: number, color: string) =>
  ({ x, y, width, height, shape: { kind: 'rect' as const, cornerRadius: 16 }, fills: solid(color) })

/** One of each kind of layer the panels have cards for, in a Square format, and a Story with `withStory`. */
const design = (withStory = false): DesignInput => ({
  meta: { schemaVersion: 3, designId: 'replaced-by-the-api', name: 'Panels inventory', kind: 'single', primaryFormatId: 'sq' },
  formats: {
    sq: { name: 'Square', width: 1080, height: 1080, order: 'a0' },
    ...(withStory ? { story: { name: 'Story', width: 1080, height: 1920, order: 'a1' } } : {}),
  },
  pages: { p1: { name: 'Page 1', order: 'a0', fills: solid('#FFFFFFFF') } },
  nodes: {
    box: { type: 'graphic', parentId: 'p1', index: 'a0', name: 'Box', props: rect(80, 80, 300, 200, '#E0262BFF') },
    dot: { type: 'graphic', parentId: 'p1', index: 'a1', name: 'Dot', props: { ...rect(700, 120, 240, 240, '#2F6BFFFF'), shape: { kind: 'ellipse' } } },
    poly: { type: 'graphic', parentId: 'p1', index: 'a2', name: 'Hex', props: { ...rect(420, 80, 160, 160, '#FCA311FF'), shape: { kind: 'polygon', sides: 6, cornerRadius: 0 } } },
    star: { type: 'graphic', parentId: 'p1', index: 'a3', name: 'Star', props: { ...rect(900, 400, 160, 160, '#8E44ADFF'), shape: { kind: 'star', points: 5, innerRadius: 0.4, cornerRadius: 0 } } },
    rule: {
      type: 'graphic', parentId: 'p1', index: 'a4', name: 'Rule',
      props: { x: 80, y: 300, width: 300, height: 120, shape: { kind: 'line', start: 'none', end: 'none' }, fills: [], strokes: [{ paint: { type: 'solid', color: '#1A1420FF' }, width: 8, align: 'center' }] },
    },
    photo: {
      type: 'graphic', parentId: 'p1', index: 'a5', name: 'Photo',
      props: { x: 420, y: 260, width: 240, height: 180, shape: { kind: 'rect', cornerRadius: 0 }, fills: [{ type: 'image', assetId: assets.photo, fit: 'fill' }] },
    },
    headline: {
      type: 'text', parentId: 'p1', index: 'a6', name: 'Headline',
      props: { x: 80, y: 480, width: 760, height: 260, boxMode: 'fixed', text: 'Summer sale\nAll week long', style: { fontFamily: 'Noto Sans', fontSize: 72, fontWeight: 800, color: '#111111FF' } },
    },
    stack: {
      type: 'frame', parentId: 'p1', index: 'a7', name: 'Stack',
      props: { x: 80, y: 760, width: 600, height: 160, fills: solid('#F4EDE4FF'), layout: { direction: 'row', gap: 16, padding: { top: 20, right: 20, bottom: 20, left: 20 } } },
    },
    chip1: { type: 'graphic', parentId: 'stack', index: 'a0', name: 'Chip 1', props: rect(100, 780, 120, 120, '#FCA311FF') },
    chip2: { type: 'graphic', parentId: 'stack', index: 'a1', name: 'Chip 2', props: rect(236, 780, 120, 120, '#14213DFF') },
    plain: { type: 'frame', parentId: 'p1', index: 'a8', name: 'Plain', props: { x: 720, y: 760, width: 300, height: 280, fills: solid('#DDEEFFFF') } },
    tile1: { type: 'graphic', parentId: 'plain', index: 'a0', name: 'Tile 1', props: rect(740, 780, 100, 100, '#11744AFF') },
    tile2: { type: 'graphic', parentId: 'plain', index: 'a1', name: 'Tile 2', props: rect(900, 900, 100, 100, '#C8156AFF') },
  },
  overrides: {},
})

type Props = Record<string, unknown> & { style?: Record<string, unknown>; fills?: Record<string, unknown>[]; strokes?: Record<string, unknown>[]; effects?: Record<string, unknown>[] }
type Doc = {
  meta: { primaryFormatId: string }
  formats: Record<string, { name: string; order: string; width: number; height: number }>
  pages: Record<string, { name: string; order: string; fills: Record<string, unknown>[] }>
  nodes: Record<string, { type: string; parentId: string; index: string; name: string; lock?: Record<string, boolean>; bindings?: Record<string, string>; props: Props }>
  overrides: Record<string, Record<string, Props>>
}
const doc = async (page: Page) => JSON.parse(await designOf(page)) as Doc
/** A layer's props as the Square format shows them. */
const props = async (page: Page, id: string) => placed(await doc(page), id, 'sq') as Props
const byOrder = <T extends { order: string }>(a: T, b: T) => (a.order < b.order ? -1 : 1)
const style = async (page: Page, id: string) => (await props(page, id)).style ?? {}
const fills = async (page: Page, id: string) => (await props(page, id)).fills ?? []
const children = async (page: Page, parentId: string) => Object.entries((await doc(page)).nodes)
  .filter(([, n]) => n.parentId === parentId).sort(([, a], [, b]) => (a.index < b.index ? -1 : 1)).map(([id]) => id)

const perform = (page: Page, action: 'undo' | 'redo') => page.evaluate((action) => window.dazbee?.perform(action), action)
const enter = async (field: Locator, value: string) => {
  await field.fill(value)
  await field.press('Enter')
}

/** SHA-256 of the Square's PNG export, which waits for every image and font it draws. */
const picture = (page: Page) =>
  page.evaluate(async () => {
    const file = await window.dazbee?.exportFiles({ pageIds: ['p1'], formatIds: ['sq'], type: 'png' })
    if (!file) throw new Error('no editor')
    const digest = await crypto.subtle.digest('SHA-256', new Uint8Array(file.bytes))
    return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
  })

/**
 * Does one thing with a control and checks it: `check` sees the change, the design is no longer
 * what it was and draws differently (unless `draws` is false, for a change the picture doesn't
 * show), one undo puts back exactly what was there, and redo brings the change again.
 */
async function step(page: Page, act: () => Promise<unknown>, check: () => Promise<void>, { draws = true } = {}) {
  const before = await designOf(page)
  const drawn = draws ? await picture(page) : ''
  await act()
  await check()
  await expect.poll(() => designOf(page), { message: 'the design changed' }).not.toBe(before)
  const after = await designOf(page)
  if (draws) await expect.poll(() => picture(page), { message: 'the design draws differently', timeout: 20_000 }).not.toBe(drawn)
  await perform(page, 'undo')
  await expect.poll(() => designOf(page), { message: 'one undo puts it back' }).toBe(before)
  await perform(page, 'redo')
  await expect.poll(() => designOf(page), { message: 'redo brings it again' }).toBe(after)
}

/** Waits for the sync server to have every change, reloads, and checks the design came back the same. */
async function reloads(page: Page) {
  const final = await designOf(page)
  await expect.poll(() => synced(page), { timeout: 15_000 }).toBe(true)
  await page.reload()
  await expect(page.getByTestId('status')).toHaveAttribute('data-ready', '', { timeout: 30_000 })
  await expect.poll(() => designOf(page), { message: 'the design is the same after a reload' }).toBe(final)
}

const select = async (page: Page, ids: string[]) => {
  await page.evaluate((ids) => window.dazbee?.select(ids), ids)
  await expect(page.getByTestId('layout-card')).toBeVisible()
  await unfoldAll(page)
}

/**
 * One row of the inventory: a test named by its number, expected to fail while its bug is open. A
 * failing row leaves a screenshot of where it stopped.
 */
function row(n: number, title: string, body: (open: (withStory?: boolean) => Promise<Page>) => Promise<void>) {
  const name = String(n).padStart(2, '0')
  test(`${name} ${title}`, async ({ browser }: { browser: Browser }) => {
    test.fail(n in KNOWN, `#${KNOWN[n]}`)
    let page: Page | undefined
    try {
      await body(async (withStory = false) => {
        page = (await openStage(browser, design(withStory))).page
        return page
      })
    } catch (error) {
      if (page) writeOutput(`inventory-${name}.png`, await page.screenshot())
      throw error
    } finally {
      await page?.context().close()
    }
  })
}

test.describe('every selection', () => {
  row(1, 'apply changes to this format or all formats', async (open) => {
    const page = await open(true)
    await select(page, ['box'])
    const scope = page.getByTestId('scope-card')
    const x = page.getByTestId('layout-card').getByRole('textbox', { name: 'X position' })
    await expect(scope.getByRole('radio', { name: 'This format' })).toHaveAttribute('aria-checked', 'true')
    await step(page, () => enter(x, '500'), async () => {
      await expect.poll(async () => (await doc(page)).overrides['format:sq']?.box?.x).toBe(500)
      expect((await doc(page)).nodes.box?.props.x).toBe(80)
    })
    await scope.getByRole('radio', { name: 'All formats' }).click()
    await step(page, () => enter(x, '200'), async () => {
      await expect.poll(async () => (await doc(page)).nodes.box?.props.x).toBe(200)
      expect((await doc(page)).overrides['format:sq']?.box ?? {}).not.toHaveProperty('x')
    })
    await reloads(page)
  })

  row(2, 'own changes: reset one, reset all', async (open) => {
    const page = await open(true)
    await select(page, ['box'])
    await enter(page.getByTestId('layout-card').getByRole('textbox', { name: 'X position' }), '200')
    await enter(page.getByTestId('fill-card').getByRole('textbox', { name: 'Colour 1 hex' }), '14213d')
    const own = page.getByTestId('own-changes')
    await expect(own.getByRole('listitem')).toHaveText(['Position and size', 'Fill'])
    const sq = async () => Object.keys((await doc(page)).overrides['format:sq']?.box ?? {}).sort()
    await step(page, () => own.getByRole('button', { name: 'Reset Fill to follow the other formats' }).click(), async () => {
      await expect.poll(sq).toEqual(['x'])
    })
    await step(page, () => own.getByRole('button', { name: 'Reset all' }).click(), async () => {
      await expect.poll(sq).toEqual([])
    })
    await reloads(page)
  })

  row(3, 'X, Y, W, H', async (open) => {
    const page = await open()
    await select(page, ['box'])
    const card = page.getByTestId('layout-card')
    for (const [name, key, value] of [['X position', 'x', 140], ['Y position', 'y', 120], ['Width', 'width', 320], ['Height', 'height', 220]] as const) {
      await step(page, () => enter(card.getByRole('textbox', { name }), String(value)), async () => {
        await expect.poll(async () => (await props(page, 'box'))[key]).toBe(value)
      })
    }
    await reloads(page)
  })

  row(4, 'rotation', async (open) => {
    const page = await open()
    await select(page, ['box'])
    await step(page, () => enter(page.getByTestId('layout-card').getByRole('textbox', { name: 'Rotation in degrees' }), '15'), async () => {
      await expect.poll(async () => (await props(page, 'box')).rotation).toBe(15)
    })
    await reloads(page)
  })

  row(5, 'opacity', async (open) => {
    const page = await open()
    await select(page, ['box'])
    await step(page, () => enter(page.getByTestId('appearance-card').getByRole('textbox', { name: 'Opacity' }), '50'), async () => {
      await expect.poll(async () => (await props(page, 'box')).opacity).toBe(0.5)
    })
    await reloads(page)
  })

  row(6, 'blend mode, pass-through for groups and frames', async (open) => {
    const page = await open()
    await select(page, ['box'])
    const blend = page.getByTestId('appearance-card').getByRole('combobox', { name: 'Blend mode' })
    await step(page, () => choose(blend, 'difference'), async () => {
      await expect.poll(async () => (await props(page, 'box')).blendMode).toBe('difference')
    })
    await blend.click()
    await expect(page.locator('[role="listbox"] [role="option"]')).toHaveCount(16)
    await page.keyboard.press('Escape')
    // A frame starts as pass-through, which only groups and frames are offered.
    await select(page, ['stack'])
    await expect(blend).toHaveAttribute('data-value', 'pass-through')
    await blend.click()
    await expect(page.locator('[role="listbox"] [role="option"]')).toHaveCount(17)
    await page.keyboard.press('Escape')
    // Over a white page, the stack draws the same blended as a whole or layer by layer.
    await step(page, () => choose(blend, 'normal'), async () => {
      await expect.poll(async () => (await props(page, 'stack')).blendMode).toBe('normal')
    }, { draws: false })
    await step(page, () => choose(blend, 'pass-through'), async () => {
      await expect.poll(async () => (await props(page, 'stack')).blendMode).toBe('pass-through')
    }, { draws: false })
    await reloads(page)
  })

  row(7, 'mixed values on a multi-selection', async (open) => {
    const page = await open()
    await select(page, ['box', 'dot'])
    const x = page.getByTestId('layout-card').getByRole('textbox', { name: 'X position' })
    await expect(x).toHaveValue('')
    await expect(x).toHaveAttribute('placeholder', 'Mixed')
    await expect(page.getByTestId('fill-card')).toContainText('The selected layers differ.')
    await step(page, () => x.press('ArrowUp'), async () => {
      await expect.poll(async () => [(await props(page, 'box')).x, (await props(page, 'dot')).x]).toEqual([81, 701])
    })
    await step(page, () => page.getByTestId('fill-card').getByRole('button', { name: 'Use one for all' }).click(), async () => {
      await expect.poll(async () => [await fills(page, 'box'), await fills(page, 'dot')]).toEqual([solid('#D9D9D9FF'), solid('#D9D9D9FF')])
    })
    await reloads(page)
  })

  row(8, 'effect tiles: none, shadow, glow, blur, outline', async (open) => {
    const page = await open()
    await select(page, ['box'])
    const tiles = page.getByTestId('effects-card')
    const types = async () => ((await props(page, 'box')).effects ?? []).map((e) => e.type)
    await step(page, () => tiles.locator('[data-tile="shadow"]').click(), async () => { await expect.poll(types).toEqual(['dropShadow']) })
    await step(page, () => tiles.locator('[data-tile="glow"]').click(), async () => { await expect.poll(types).toEqual(['dropShadow', 'glow']) })
    await step(page, () => tiles.locator('[data-tile="blur"]').click(), async () => { await expect.poll(types).toEqual(['dropShadow', 'glow', 'layerBlur']) })
    await step(page, () => tiles.locator('[data-tile="none"]').click(), async () => { await expect.poll(types).toEqual([]) })
    await select(page, ['headline'])
    await step(page, () => tiles.locator('[data-tile="outline"]').click(), async () => {
      await expect.poll(async () => (await style(page, 'headline')).outline).toMatchObject({ width: 2 })
    })
    await reloads(page)
  })

  row(9, 'add effect: drop shadow, inner shadow, glow, layer blur, background blur', async (open) => {
    const page = await open()
    await select(page, ['box'])
    const card = page.getByTestId('effects-card')
    const added: string[] = []
    for (const type of ['dropShadow', 'innerShadow', 'glow', 'layerBlur', 'backgroundBlur']) {
      added.push(type)
      const want = [...added]
      // A background blur blurs what is behind the box: the white page, which looks the same.
      await step(page, () => choose(card.getByRole('combobox', { name: 'Add effect' }), type), async () => {
        await expect.poll(async () => ((await props(page, 'box')).effects ?? []).map((e) => e.type)).toEqual(want)
      }, { draws: type !== 'backgroundBlur' })
    }
    await reloads(page)
  })

  row(10, 'each effect: X, Y, blur, spread, radius, colour, remove, several', async (open) => {
    const page = await open()
    await select(page, ['box'])
    const card = page.getByTestId('effects-card')
    const effects = async () => (await props(page, 'box')).effects ?? []
    await choose(card.getByRole('combobox', { name: 'Add effect' }), 'dropShadow')
    await choose(card.getByRole('combobox', { name: 'Add effect' }), 'dropShadow')
    await choose(card.getByRole('combobox', { name: 'Add effect' }), 'glow')
    await choose(card.getByRole('combobox', { name: 'Add effect' }), 'layerBlur')
    await expect.poll(async () => (await effects()).length).toBe(4)
    for (const [field, key, value] of [['X', 'x', 30], ['Y', 'y', -20], ['Blur', 'blur', 40], ['Spread', 'spread', 12]] as const) {
      await step(page, () => enter(card.getByRole('textbox', { name: `Drop shadow 1 ${field}` }), String(value)), async () => {
        await expect.poll(async () => (await effects())[0]?.[key]).toBe(value)
      })
    }
    // The second shadow has its own numbers and colour.
    const second = card.locator('[data-item="effects-1"]')
    await step(page, () => enter(second.getByRole('textbox', { name: 'Drop shadow 2 Blur' }), '8'), async () => {
      await expect.poll(async () => (await effects())[1]?.blur).toBe(8)
    })
    await step(page, () => enter(second.getByRole('textbox', { name: /hex$/ }), '2f6bff'), async () => {
      await expect.poll(async () => String((await effects())[1]?.color)).toMatch(/^#2F6BFF/)
    })
    await step(page, () => enter(card.getByRole('textbox', { name: 'Glow 3 Spread' }), '10'), async () => {
      await expect.poll(async () => (await effects())[2]?.spread).toBe(10)
    })
    await step(page, () => enter(card.getByRole('textbox', { name: 'Layer blur 4 Radius' }), '6'), async () => {
      await expect.poll(async () => (await effects())[3]?.radius).toBe(6)
    })
    await step(page, () => card.getByRole('button', { name: 'Remove drop shadow 1' }).click(), async () => {
      await expect.poll(async () => (await effects()).map((e) => e.type)).toEqual(['dropShadow', 'glow', 'layerBlur'])
    })
    await reloads(page)
  })

  row(11, 'arrange: duplicate, order, group, ungroup, frame selection, use as mask', async (open) => {
    const page = await open()
    await select(page, ['box'])
    const arrange = page.getByTestId('arrange')
    const layer = arrange.getByRole('group', { name: 'Layer' })
    await step(page, () => layer.getByRole('button', { name: 'Duplicate' }).click(), async () => {
      await expect.poll(async () => (await children(page, 'p1')).length).toBe(10)
    })
    await perform(page, 'undo')
    await select(page, ['box'])
    // The box overlaps nothing, so its place in the order changes only the document.
    const at = async () => (await children(page, 'p1')).indexOf('box')
    await step(page, () => layer.getByRole('button', { name: 'Bring to front' }).click(), async () => { await expect.poll(at).toBe(8) }, { draws: false })
    await step(page, () => layer.getByRole('button', { name: 'Send backward' }).click(), async () => { await expect.poll(at).toBe(7) }, { draws: false })
    await step(page, () => layer.getByRole('button', { name: 'Send to back' }).click(), async () => { await expect.poll(at).toBe(0) }, { draws: false })
    await step(page, () => layer.getByRole('button', { name: 'Bring forward' }).click(), async () => { await expect.poll(at).toBe(1) }, { draws: false })
    await step(page, () => layer.getByRole('button', { name: 'Use as mask' }).click(), async () => {
      await expect.poll(async () => (await props(page, 'box')).mask).toBe('alpha')
    })
    await perform(page, 'undo')
    await select(page, ['box', 'poly'])
    await step(page, () => arrange.getByRole('button', { name: 'Group', exact: true }).click(), async () => {
      await expect.poll(async () => (await doc(page)).nodes.box?.parentId).not.toBe('p1')
    }, { draws: false })
    const group = (await doc(page)).nodes.box?.parentId ?? ''
    await select(page, [group])
    await step(page, () => layer.getByRole('button', { name: 'Ungroup' }).click(), async () => {
      await expect.poll(async () => (await doc(page)).nodes.box?.parentId).toBe('p1')
    }, { draws: false })
    await select(page, ['box', 'poly'])
    await step(page, () => arrange.locator('[data-action="frameSelection"]').click(), async () => {
      await expect.poll(async () => { const d = await doc(page); return d.nodes[d.nodes.box?.parentId ?? '']?.type }).toBe('frame')
    }, { draws: false })
    await reloads(page)
  })
})

test.describe('text', () => {
  row(12, 'font: search, Google Fonts, built in, brand fonts, upload', async (open) => {
    importGoogleFonts(['Playfair Display'])
    const page = await open()
    await select(page, ['headline'])
    const family = async () => (await style(page, 'headline')).fontFamily
    await step(page, async () => {
      await page.getByTestId('font-open').click()
      await page.getByTestId('font-search').fill('playf')
      await page.getByTestId('font-search').press('Enter')
    }, async () => { await expect.poll(family).toBe('Playfair Display') })
    await step(page, async () => {
      await page.getByTestId('font-open').click()
      await page.getByTestId('font-search').fill('')
      await page.getByRole('listbox', { name: 'Font' }).getByRole('group', { name: 'Built in' }).getByRole('option', { name: 'Noto Sans', exact: true }).click()
    }, async () => { await expect.poll(family).toBe('Noto Sans') })
    await step(page, async () => {
      await page.getByTestId('font-open').click()
      await page.getByTestId('font-upload').setInputFiles({ name: 'Righteous-Regular.ttf', mimeType: 'font/ttf', buffer: Buffer.from(righteous) })
    }, async () => { await expect.poll(family).toBe('Righteous') })
    await perform(page, 'undo')
    await step(page, async () => {
      await page.getByTestId('font-open').click()
      await page.getByTestId('font-search').fill('')
      await page.getByRole('listbox', { name: 'Font' }).getByRole('group', { name: 'Brand fonts' }).getByRole('option', { name: 'Righteous' }).click()
    }, async () => { await expect.poll(family).toBe('Righteous') })
    await reloads(page)
  })

  row(13, 'weight', async (open) => {
    const page = await open()
    await select(page, ['headline'])
    // The family's lightest and heaviest weights, and back to regular.
    const field = page.getByTestId('font-weight')
    await field.click()
    const offered = (await page.locator('[role="listbox"] [role="option"]').evaluateAll((options) => options.map((o) => Number(o.getAttribute('data-value')))))
    await page.keyboard.press('Escape')
    expect(offered.length).toBeGreaterThan(2)
    for (const weight of [offered[0] ?? 400, offered.at(-1) ?? 400, 400]) {
      await step(page, () => choose(field, String(weight)), async () => {
        await expect.poll(async () => (await style(page, 'headline')).fontWeight).toBe(weight)
      })
    }
    await reloads(page)
  })

  row(14, 'size', async (open) => {
    const page = await open()
    await select(page, ['headline'])
    await step(page, () => page.getByTestId('text-look').getByRole('slider', { name: 'Size' }).fill('64'), async () => {
      await expect.poll(async () => (await style(page, 'headline')).fontSize).toBe(64)
    })
    await step(page, () => enter(page.getByTestId('text-card').getByRole('textbox', { name: 'Size' }), '90'), async () => {
      await expect.poll(async () => (await style(page, 'headline')).fontSize).toBe(90)
    })
    await reloads(page)
  })

  row(15, 'text colour: brand colours and hex', async (open) => {
    const page = await open()
    await select(page, ['headline'])
    await step(page, () => page.getByTestId('text-look').getByRole('group', { name: 'Brand colours' }).getByRole('button', { name: 'Berry' }).click(), async () => {
      await expect.poll(async () => (await doc(page)).nodes.headline?.bindings).toMatchObject({ textColor: 'brand:berry' })
    })
    await step(page, () => enter(page.getByTestId('text-card').getByRole('textbox', { name: 'Text colour hex' }), '1f9d55'), async () => {
      await expect.poll(async () => (await style(page, 'headline')).color).toBe('#1F9D55FF')
    })
    await reloads(page)
  })

  row(16, 'line height, and back to Auto', async (open) => {
    const page = await open()
    await select(page, ['headline'])
    const field = page.getByTestId('text-card').getByRole('textbox', { name: 'Line height' })
    await step(page, () => enter(field, '1.6'), async () => {
      await expect.poll(async () => (await style(page, 'headline')).lineHeight).toBe(1.6)
    })
    await step(page, () => enter(field, ''), async () => {
      await expect.poll(async () => (await style(page, 'headline')).lineHeight).toBeUndefined()
    })
    await reloads(page)
  })

  row(17, 'letter spacing', async (open) => {
    const page = await open()
    await select(page, ['headline'])
    await step(page, () => enter(page.getByTestId('text-card').getByRole('textbox', { name: 'Letter spacing' }), '4'), async () => {
      await expect.poll(async () => (await style(page, 'headline')).letterSpacing).toBe(4)
    })
    await reloads(page)
  })

  row(18, 'paragraph spacing', async (open) => {
    const page = await open()
    await select(page, ['headline'])
    await step(page, () => enter(page.getByTestId('paragraph-card').getByRole('textbox', { name: 'Paragraph spacing' }), '24'), async () => {
      await expect.poll(async () => (await props(page, 'headline')).paragraphSpacing).toBe(24)
    })
    await reloads(page)
  })

  row(19, 'alignment: start, centre, end, justify', async (open) => {
    const page = await open()
    await select(page, ['headline'])
    const field = page.getByTestId('text-card').getByRole('combobox', { name: 'Alignment', exact: true })
    // Each line is a paragraph's last, which justify leaves at the start: those two draw alike.
    for (const align of ['center', 'end', 'justify', 'start']) {
      await step(page, () => choose(field, align), async () => {
        await expect.poll(async () => (await props(page, 'headline')).align).toBe(align)
      }, { draws: align === 'center' || align === 'end' })
    }
    await reloads(page)
  })

  row(20, 'vertical alignment: top, middle, bottom', async (open) => {
    const page = await open()
    await select(page, ['headline'])
    const field = page.getByTestId('text-card').getByRole('combobox', { name: 'Vertical alignment' })
    for (const align of ['bottom', 'middle', 'top']) {
      await step(page, () => choose(field, align), async () => {
        await expect.poll(async () => (await props(page, 'headline')).verticalAlign).toBe(align)
      })
    }
    await reloads(page)
  })

  row(21, 'case: as typed, upper, lower, title', async (open) => {
    const page = await open()
    await select(page, ['headline'])
    const field = page.getByTestId('text-card').getByRole('combobox', { name: 'Case' })
    for (const textCase of ['upper', 'lower', 'title', 'none']) {
      await step(page, () => choose(field, textCase), async () => {
        await expect.poll(async () => (await style(page, 'headline')).textCase ?? 'none').toBe(textCase)
      })
    }
    await reloads(page)
  })

  row(22, 'underline, strikethrough', async (open) => {
    const page = await open()
    await select(page, ['headline'])
    const card = page.getByTestId('paragraph-card')
    await step(page, () => card.getByRole('button', { name: 'Underline' }).click(), async () => {
      await expect.poll(async () => (await style(page, 'headline')).underline).toBe(true)
    })
    await step(page, () => card.getByRole('button', { name: 'Strikethrough' }).click(), async () => {
      await expect.poll(async () => (await style(page, 'headline')).strikethrough).toBe(true)
    })
    await reloads(page)
  })

  row(23, 'list: none, bullets, numbers', async (open) => {
    const page = await open()
    await select(page, ['headline'])
    const field = page.getByTestId('paragraph-card').getByRole('combobox', { name: 'List' })
    for (const list of ['bullet', 'number', 'none']) {
      await step(page, () => choose(field, list), async () => {
        await expect.poll(async () => (await props(page, 'headline')).list ?? 'none').toBe(list)
      })
    }
    await reloads(page)
  })

  row(24, 'outline on and off, width', async (open) => {
    const page = await open()
    await select(page, ['headline'])
    const card = page.getByTestId('paragraph-card')
    await step(page, () => card.getByRole('button', { name: 'Outline', exact: true }).click(), async () => {
      await expect.poll(async () => (await style(page, 'headline')).outline).toBeTruthy()
    })
    await step(page, () => enter(card.getByRole('textbox', { name: 'Outline width' }), '6'), async () => {
      await expect.poll(async () => (await style(page, 'headline')).outline).toMatchObject({ width: 6 })
    })
    await step(page, () => card.getByRole('button', { name: 'Outline', exact: true }).click(), async () => {
      await expect.poll(async () => (await style(page, 'headline')).outline).toBeFalsy()
    })
    await reloads(page)
  })

  row(25, 'box mode: auto width, auto height, fixed', async (open) => {
    const page = await open()
    await select(page, ['headline'])
    const field = page.getByTestId('paragraph-card').getByRole('combobox', { name: 'Box' })
    const size = async () => { const p = await props(page, 'headline'); return [p.width, p.height] }
    // The lines start at the box's start and top in every mode, so the picture stays the same.
    await step(page, () => choose(field, 'autoWidth'), async () => {
      await expect.poll(async () => (await props(page, 'headline')).boxMode).toBe('autoWidth')
      await expect.poll(async () => (await size())[0]).toBeLessThan(760)
    }, { draws: false })
    await step(page, () => choose(field, 'autoHeight'), async () => {
      await expect.poll(async () => (await props(page, 'headline')).boxMode).toBe('autoHeight')
      await expect.poll(async () => (await size())[1]).toBeLessThan(260)
    }, { draws: false })
    await step(page, () => choose(field, 'fixed'), async () => {
      await expect.poll(async () => (await props(page, 'headline')).boxMode).toBe('fixed')
    }, { draws: false })
    await reloads(page)
  })

  row(26, 'shrink to fit, smallest and largest size', async (open) => {
    const page = await open()
    await select(page, ['headline'])
    const card = page.getByTestId('paragraph-card')
    // The text fits its box at 72 already, so turning it on changes nothing drawn.
    await step(page, () => card.getByRole('button', { name: 'Shrink to fit' }).click(), async () => {
      await expect.poll(async () => (await props(page, 'headline')).shrinkToFit).toBeTruthy()
    }, { draws: false })
    await step(page, () => enter(card.getByRole('textbox', { name: 'Largest size' }), '200'), async () => {
      await expect.poll(async () => (await props(page, 'headline')).shrinkToFit).toMatchObject({ max: 200 })
    })
    await step(page, () => enter(card.getByRole('textbox', { name: 'Smallest size' }), '120'), async () => {
      await expect.poll(async () => (await props(page, 'headline')).shrinkToFit).toMatchObject({ min: 120, max: 200 })
    })
    await reloads(page)
  })

  row(27, 'lines at most', async (open) => {
    const page = await open()
    await select(page, ['headline'])
    await step(page, () => enter(page.getByTestId('paragraph-card').getByRole('textbox', { name: 'Lines at most' }), '1'), async () => {
      await expect.poll(async () => (await props(page, 'headline')).maxLines).toBe(1)
    })
    await reloads(page)
  })
})

test.describe('shapes and frames', () => {
  row(29, 'fill swatches and brand colours', async (open) => {
    const page = await open()
    await select(page, ['dot'])
    await step(page, () => page.getByTestId('fill-look').getByRole('group', { name: 'Brand colours' }).getByRole('button', { name: 'Roast' }).click(), async () => {
      await expect.poll(async () => (await doc(page)).nodes.dot?.bindings).toMatchObject({ fill: 'brand:roast' })
    })
    await select(page, ['box'])
    await step(page, () => page.getByTestId('shape-card').getByRole('group', { name: 'Brand colours' }).getByRole('button', { name: 'Berry' }).click(), async () => {
      await expect.poll(async () => (await doc(page)).nodes.box?.bindings).toMatchObject({ fill: 'brand:berry' })
    })
    await reloads(page)
  })

  row(30, 'fill list: add, remove, reorder, hide and show', async (open) => {
    const page = await open()
    await select(page, ['box'])
    const card = page.getByTestId('fill-card')
    await step(page, () => card.getByRole('button', { name: 'Add fill' }).click(), async () => {
      await expect.poll(async () => (await fills(page, 'box')).length).toBe(2)
    })
    // Top first: the new fill is the first row; moving it down puts it under the red.
    await enter(card.getByRole('textbox', { name: 'Colour 1 hex' }), '2f6bff')
    await expect.poll(async () => (await fills(page, 'box'))[1]?.color).toBe('#2F6BFF33')
    await step(page, () => card.locator('[data-row="1"]').getByTestId('row-grip').press('ArrowDown'), async () => {
      await expect.poll(async () => (await fills(page, 'box')).map((f) => f.color)).toEqual(['#2F6BFF33', '#E0262BFF'])
    })
    await step(page, () => card.locator('[data-row="1"]').getByTestId('paint-visible').click(), async () => {
      await expect.poll(async () => (await fills(page, 'box'))[1]?.visible).toBe(false)
    })
    await step(page, () => card.locator('[data-row="1"]').getByTestId('paint-visible').click(), async () => {
      await expect.poll(async () => (await fills(page, 'box'))[1]?.visible ?? true).toBe(true)
    })
    await step(page, () => card.getByRole('button', { name: 'Remove fill 1' }).click(), async () => {
      await expect.poll(async () => (await fills(page, 'box')).map((f) => f.color)).toEqual(['#2F6BFF33'])
    })
    await reloads(page)
  })

  row(31, 'paint kind: solid, linear, radial, angular, image', async (open) => {
    const page = await open()
    await select(page, ['box'])
    await page.getByTestId('fill-card').locator('[data-row="1"]').getByTestId('paint-swatch').click()
    const editor = page.getByTestId('paint-editor')
    for (const [name, type] of [['Linear gradient', 'linear'], ['Radial gradient', 'radial'], ['Angular gradient', 'angular'], ['Solid', 'solid']] as const) {
      await step(page, () => editor.getByRole('radio', { name }).click(), async () => {
        await expect.poll(async () => (await fills(page, 'box'))[0]?.type).toBe(type)
      })
    }
    await step(page, async () => {
      await editor.getByTestId('paint-image').click()
      await page.getByTestId('paint-image-picker').locator(`li[data-asset="${assets.tile}"] button`).click()
    }, async () => {
      await expect.poll(async () => (await fills(page, 'box'))[0]).toMatchObject({ type: 'image', assetId: assets.tile })
    })
    await reloads(page)
  })

  row(32, 'gradient stops, angle, centre and size', async (open) => {
    const page = await open()
    await select(page, ['box'])
    await page.getByTestId('fill-card').locator('[data-row="1"]').getByTestId('paint-swatch').click()
    const editor = page.getByTestId('paint-editor')
    await editor.getByRole('radio', { name: 'Linear gradient' }).click()
    const stops = async () => ((await fills(page, 'box'))[0]?.stops ?? []) as { offset: number; color: string }[]
    await expect.poll(async () => (await stops()).length).toBe(2)
    const bar = editor.getByTestId('gradient-bar')
    const box = await bar.boundingBox()
    await step(page, () => page.mouse.click((box?.x ?? 0) + (box?.width ?? 0) * 0.5, (box?.y ?? 0) + (box?.height ?? 0) / 2), async () => {
      await expect.poll(async () => (await stops()).length).toBe(3)
    })
    const offset = async () => (await stops()).map((s) => s.offset).sort()[1]
    const was = await offset()
    await step(page, () => editor.locator('[data-stop="1"]').press('ArrowRight'), async () => {
      await expect.poll(offset).not.toBe(was)
    })
    await step(page, () => enter(editor.getByRole('textbox', { name: 'Stop 2 hex' }), '00a889'), async () => {
      await expect.poll(async () => (await stops()).some((s) => s.color.startsWith('#00A889'))).toBe(true)
    })
    await step(page, () => editor.getByRole('button', { name: 'Remove this stop' }).click(), async () => {
      await expect.poll(async () => (await stops()).length).toBe(2)
    })
    const ends = async () => { const paint = (await fills(page, 'box'))[0]; return JSON.stringify([paint?.from, paint?.to]) }
    const along = await ends()
    await step(page, () => enter(editor.getByRole('textbox', { name: 'Gradient angle' }), '45'), async () => {
      await expect.poll(ends).not.toBe(along)
    })
    await editor.getByRole('radio', { name: 'Radial gradient' }).click()
    await step(page, () => enter(editor.getByRole('textbox', { name: 'Gradient centre across' }), '20'), async () => {
      await expect.poll(async () => (await fills(page, 'box'))[0]?.center).toMatchObject({ x: 0.2 })
    })
    await step(page, () => enter(editor.getByRole('textbox', { name: 'Gradient centre down' }), '70'), async () => {
      await expect.poll(async () => (await fills(page, 'box'))[0]?.center).toMatchObject({ x: 0.2, y: 0.7 })
    })
    await step(page, () => enter(editor.getByRole('textbox', { name: 'Gradient size' }), '30'), async () => {
      await expect.poll(async () => (await fills(page, 'box'))[0]?.radius).toBe(0.3)
    })
    await reloads(page)
  })

  row(33, 'colour hex and opacity of each paint', async (open) => {
    const page = await open()
    await select(page, ['box'])
    const card = page.getByTestId('fill-card')
    await step(page, () => enter(card.getByRole('textbox', { name: 'Colour 1 hex' }), '00a889'), async () => {
      await expect.poll(async () => (await fills(page, 'box'))[0]?.color).toBe('#00A889FF')
    })
    await step(page, () => enter(card.getByRole('textbox', { name: 'Colour 1 opacity' }), '80'), async () => {
      await expect.poll(async () => (await fills(page, 'box'))[0]?.color).toBe('#00A889CC')
    })
    await card.locator('[data-row="1"]').getByTestId('paint-swatch').click()
    await page.getByTestId('paint-editor').getByRole('radio', { name: 'Linear gradient' }).click()
    await page.keyboard.press('Escape')
    await step(page, () => enter(card.getByRole('textbox', { name: 'Colour 1 opacity' }), '50'), async () => {
      await expect.poll(async () => (await fills(page, 'box'))[0]?.opacity).toBe(0.5)
    })
    await reloads(page)
  })

  row(34, 'add an image into a shape', async (open) => {
    const page = await open()
    await select(page, ['dot'])
    await step(page, async () => {
      await page.getByTestId('add-image').click()
      await page.getByTestId('add-image-picker').locator(`li[data-asset="${assets.tile}"] button`).click()
    }, async () => {
      await expect.poll(async () => (await fills(page, 'dot')).at(-1)).toMatchObject({ type: 'image', assetId: assets.tile, fit: 'fill' })
    })
    await reloads(page)
  })

  row(35, 'stroke list: add, remove, reorder, several', async (open) => {
    const page = await open()
    await select(page, ['box'])
    const card = page.getByTestId('stroke-card')
    const strokes = async () => (await props(page, 'box')).strokes ?? []
    await step(page, () => card.getByRole('button', { name: 'Add stroke' }).click(), async () => { await expect.poll(async () => (await strokes()).length).toBe(1) })
    await step(page, () => card.getByRole('button', { name: 'Add stroke' }).click(), async () => { await expect.poll(async () => (await strokes()).length).toBe(2) })
    // Top first: Stroke 1 is the newest, drawn on top; a colour of its own shows which is on top.
    await enter(card.getByRole('textbox', { name: 'Stroke 1 width' }), '12')
    await enter(card.getByRole('textbox', { name: 'Stroke 1 colour hex' }), 'ff48b0')
    await expect.poll(async () => (await strokes()).map((s) => s.width)).toEqual([2, 12])
    await step(page, () => card.locator('[data-row="1"]').getByTestId('row-grip').press('ArrowDown'), async () => {
      await expect.poll(async () => (await strokes()).map((s) => s.width)).toEqual([12, 2])
    })
    await step(page, () => card.locator('[data-row="2"]').getByTestId('row-grip').dragTo(card.locator('[data-row="1"]')), async () => {
      await expect.poll(async () => (await strokes()).map((s) => s.width)).toEqual([2, 12])
    })
    await step(page, () => card.locator('[data-row="2"]').getByTestId('row-grip').press('ArrowUp'), async () => {
      await expect.poll(async () => (await strokes()).map((s) => s.width)).toEqual([12, 2])
    })
    await step(page, () => card.getByRole('button', { name: 'Remove stroke 1' }).click(), async () => { await expect.poll(async () => (await strokes()).length).toBe(1) })
    await reloads(page)
  })

  row(36, 'stroke paint, width, position', async (open) => {
    const page = await open()
    await select(page, ['box'])
    const card = page.getByTestId('stroke-card')
    await card.getByRole('button', { name: 'Add stroke' }).click()
    const stroke = async () => (await props(page, 'box')).strokes?.[0] ?? {}
    await step(page, () => enter(card.getByRole('textbox', { name: 'Stroke 1 colour hex' }), '2f6bff'), async () => {
      await expect.poll(stroke).toMatchObject({ paint: { type: 'solid', color: '#2F6BFFFF' } })
    })
    await step(page, () => enter(card.getByRole('textbox', { name: 'Stroke 1 width' }), '10'), async () => { await expect.poll(stroke).toMatchObject({ width: 10 }) })
    for (const align of ['inside', 'outside', 'center']) {
      await step(page, () => choose(card.getByRole('combobox', { name: 'Stroke 1 position' }), align), async () => { await expect.poll(stroke).toMatchObject({ align }) })
    }
    await reloads(page)
  })

  row(37, 'dashes, dash offset, ends, corners', async (open) => {
    const page = await open()
    await select(page, ['poly'])
    const card = page.getByTestId('stroke-card')
    await card.getByRole('button', { name: 'Add stroke' }).click()
    await enter(card.getByRole('textbox', { name: 'Stroke 1 width' }), '16')
    const stroke = async () => (await props(page, 'poly')).strokes?.[0] ?? {}
    for (const join of ['round', 'bevel', 'miter']) {
      await step(page, () => choose(card.getByRole('combobox', { name: 'Stroke 1 corners' }), join), async () => { await expect.poll(stroke).toMatchObject({ join }) })
    }
    await step(page, () => enter(card.getByRole('textbox', { name: 'Stroke 1 dashes' }), '30, 12'), async () => { await expect.poll(stroke).toMatchObject({ dashes: [30, 12] }) })
    await step(page, () => enter(card.getByRole('textbox', { name: 'Stroke 1 dash offset' }), '9'), async () => { await expect.poll(stroke).toMatchObject({ dashOffset: 9 }) })
    for (const cap of ['round', 'square', 'butt']) {
      await step(page, () => choose(card.getByRole('combobox', { name: 'Stroke 1 ends' }), cap), async () => { await expect.poll(stroke).toMatchObject({ cap }) })
    }
    await reloads(page)
  })

  row(38, 'rectangle corners, each corner its own', async (open) => {
    const page = await open()
    await select(page, ['box'])
    const card = page.getByTestId('shape-card')
    const shape = async () => (await props(page, 'box')).shape as Record<string, unknown>
    await step(page, () => card.getByRole('slider', { name: 'Corners' }).fill('60'), async () => { await expect.poll(shape).toMatchObject({ cornerRadius: 60 }) })
    // Each corner starts at the radius all four had.
    await step(page, () => card.getByRole('checkbox', { name: 'Each corner its own radius' }).click(), async () => {
      await expect.poll(async () => (await shape()).corners).toEqual([60, 60, 60, 60])
    }, { draws: false })
    for (const [i, corner, radius] of [[0, 'Top left', 0], [1, 'Top right', 20], [2, 'Bottom right', 90], [3, 'Bottom left', 40]] as const) {
      await step(page, () => enter(card.getByRole('textbox', { name: `${corner} radius` }), String(radius)), async () => {
        await expect.poll(async () => ((await shape()).corners as number[])[i]).toBe(radius)
      })
    }
    await reloads(page)
  })

  row(39, 'polygon sides and corners', async (open) => {
    const page = await open()
    await select(page, ['poly'])
    const card = page.getByTestId('shape-card')
    const shape = async () => (await props(page, 'poly')).shape
    await step(page, () => card.getByRole('slider', { name: 'Sides' }).fill('8'), async () => { await expect.poll(shape).toMatchObject({ sides: 8 }) })
    await step(page, () => card.getByRole('slider', { name: 'Corners' }).fill('20'), async () => { await expect.poll(shape).toMatchObject({ cornerRadius: 20 }) })
    await reloads(page)
  })

  row(40, 'star points, inner, corners', async (open) => {
    const page = await open()
    await select(page, ['star'])
    const card = page.getByTestId('shape-card')
    const shape = async () => (await props(page, 'star')).shape
    await step(page, () => card.getByRole('slider', { name: 'Points' }).fill('8'), async () => { await expect.poll(shape).toMatchObject({ points: 8 }) })
    await step(page, () => card.getByRole('slider', { name: 'Inner' }).fill('0.7'), async () => { await expect.poll(shape).toMatchObject({ innerRadius: 0.7 }) })
    await step(page, () => card.getByRole('slider', { name: 'Corners' }).fill('10'), async () => { await expect.poll(shape).toMatchObject({ cornerRadius: 10 }) })
    await reloads(page)
  })

  row(41, 'line start and end', async (open) => {
    const page = await open()
    await select(page, ['rule'])
    const card = page.getByTestId('shape-card')
    const shape = async () => (await props(page, 'rule')).shape
    for (const end of ['arrow', 'triangle', 'circle']) {
      await step(page, () => choose(card.getByRole('combobox', { name: 'Line start' }), end), async () => { await expect.poll(shape).toMatchObject({ start: end }) })
    }
    await step(page, () => choose(card.getByRole('combobox', { name: 'Line end' }), 'arrow'), async () => { await expect.poll(shape).toMatchObject({ end: 'arrow' }) })
    await step(page, () => choose(card.getByRole('combobox', { name: 'Line start' }), 'none'), async () => { await expect.poll(shape).toMatchObject({ start: 'none' }) })
    await reloads(page)
  })

  row(42, 'combine: union, subtract, intersect, exclude', async (open) => {
    const page = await open()
    for (const op of ['union', 'subtract', 'intersect', 'exclude']) {
      await select(page, ['box', 'poly'])
      // A union of two shapes that don't overlap draws the same two shapes.
      await step(page, () => page.getByTestId('arrange').getByRole('button', { name: op[0]?.toUpperCase() + op.slice(1) }).click(), async () => {
        await expect.poll(async () => { const d = await doc(page); const parent = d.nodes[d.nodes.box?.parentId ?? '']; return [parent?.type, parent?.props.op] }).toEqual(['boolean', op])
      }, { draws: op !== 'union' })
      if (op !== 'exclude') await perform(page, 'undo')
    }
    await reloads(page)
  })
})

test.describe('photos', () => {
  const image = async (page: Page) => (await fills(page, 'photo')).at(-1) ?? {}

  row(43, 'replace the image', async (open) => {
    const page = await open()
    await select(page, ['photo'])
    await step(page, async () => {
      await page.getByTestId('replace-image').click()
      await page.getByTestId('replace-image-picker').locator(`li[data-asset="${assets.tile}"] button`).click()
    }, async () => { await expect.poll(() => image(page)).toMatchObject({ assetId: assets.tile }) })
    await reloads(page)
  })

  row(44, 'crop on the canvas', async (open) => {
    const page = await open()
    await select(page, ['photo'])
    await page.keyboard.press('Enter')
    await expect(page.locator('.crop-image')).toBeVisible()
    await step(page, () => drag(page, { x: 540, y: 350 }, { x: 600, y: 350 }), async () => {
      await expect.poll(() => image(page)).toMatchObject({ fit: 'crop' })
      expect((await image(page)).crop).toBeTruthy()
    })
    await page.keyboard.press('Escape')
    await reloads(page)
  })

  row(45, 'fit: fill, fit inside, crop, tile', async (open) => {
    const page = await open()
    await select(page, ['photo'])
    const field = page.getByTestId('image-card').getByRole('combobox', { name: 'Fit' })
    for (const fit of ['fit', 'tile', 'crop', 'fill']) {
      // Crop with no crop box shows what fill shows.
      await step(page, () => choose(field, fit), async () => { await expect.poll(() => image(page)).toMatchObject({ fit }) }, { draws: fit !== 'crop' && fit !== 'fill' })
    }
    await reloads(page)
  })

  row(46, 'filter', async (open) => {
    const page = await open()
    await select(page, ['photo'])
    const filters = page.getByTestId('image-card').getByRole('radiogroup', { name: 'Filter' })
    for (const [name, filter] of [['Mono', 'mono'], ['Sepia', 'sepia'], ['Vivid', 'vivid'], ['Fade', 'fade'], ['Warm', 'warm'], ['Cool', 'cool'], ['Original', undefined]] as const) {
      await step(page, () => filters.getByRole('radio', { name }).click(), async () => { await expect.poll(async () => (await image(page)).filter).toBe(filter) })
    }
    await reloads(page)
  })

  row(47, 'adjust: exposure, contrast, saturation, temperature, tint', async (open) => {
    const page = await open()
    await select(page, ['photo'])
    const card = page.getByTestId('image-card')
    await card.getByRole('button', { name: 'Fine-tune' }).click()
    for (const [name, key] of [['Exposure', 'exposure'], ['Contrast', 'contrast'], ['Saturation', 'saturation'], ['Temperature', 'temperature'], ['Tint', 'tint']] as const) {
      await step(page, () => enter(card.getByRole('textbox', { name }), '40'), async () => {
        await expect.poll(async () => ((await image(page)).adjust as Record<string, number> | undefined)?.[key]).toBe(40)
      })
    }
    await reloads(page)
  })

  row(48, 'image opacity', async (open) => {
    const page = await open()
    await select(page, ['photo'])
    const card = page.getByTestId('image-card')
    await card.getByRole('button', { name: 'Fine-tune' }).click()
    await step(page, () => enter(card.getByRole('textbox', { name: 'Image opacity' }), '50'), async () => {
      await expect.poll(async () => (await image(page)).opacity).toBe(0.5)
    })
    await reloads(page)
  })

  row(49, 'use as mask', async (open) => {
    const page = await open()
    await select(page, ['photo'])
    const button = page.getByTestId('arrange').getByRole('group', { name: 'Layer' }).getByRole('button', { name: 'Use as mask' })
    await step(page, () => button.click(), async () => { await expect.poll(async () => (await props(page, 'photo')).mask).toBe('alpha') })
    await step(page, () => button.click(), async () => { await expect.poll(async () => (await props(page, 'photo')).mask).toBeFalsy() })
    await reloads(page)
  })
})

test.describe('frames and auto layout', () => {
  const layout = async (page: Page, id = 'stack') => (await props(page, id)).layout as Record<string, unknown> | undefined

  row(50, 'add auto layout', async (open) => {
    const page = await open()
    await select(page, ['plain'])
    await step(page, () => page.getByTestId('auto-layout-card').getByRole('button', { name: 'Add auto layout' }).click(), async () => {
      await expect.poll(() => layout(page, 'plain')).toBeTruthy()
    })
    await reloads(page)
  })

  row(51, 'direction and wrap', async (open) => {
    const page = await open()
    await select(page, ['stack'])
    const card = page.getByTestId('auto-layout-card')
    await step(page, () => choose(card.getByRole('combobox', { name: 'Direction' }), 'column'), async () => { await expect.poll(() => layout(page)).toMatchObject({ direction: 'column' }) })
    await choose(card.getByRole('combobox', { name: 'Direction' }), 'row')
    await enter(card.getByRole('textbox', { name: 'Gap', exact: true }), '400')
    await step(page, () => card.getByRole('checkbox', { name: 'Wrap' }).click(), async () => { await expect.poll(() => layout(page)).toMatchObject({ wrap: true }) })
    await reloads(page)
  })

  row(52, 'gap', async (open) => {
    const page = await open()
    await select(page, ['stack'])
    await step(page, () => enter(page.getByTestId('auto-layout-card').getByRole('textbox', { name: 'Gap', exact: true }), '48'), async () => {
      await expect.poll(() => layout(page)).toMatchObject({ gap: 48 })
    })
    await reloads(page)
  })

  row(53, 'padding, four sides', async (open) => {
    const page = await open()
    await select(page, ['stack'])
    const card = page.getByTestId('auto-layout-card')
    for (const side of ['top', 'right', 'bottom', 'left']) {
      // The stack is wider than its row: padding on the end side moves nothing.
      await step(page, () => enter(card.getByRole('textbox', { name: `Padding ${side}` }), '8'), async () => {
        await expect.poll(async () => ((await layout(page))?.padding as Record<string, number>)[side]).toBe(8)
      }, { draws: side === 'top' || side === 'left' })
    }
    await reloads(page)
  })

  row(54, 'distribute: start, centre, end, space between', async (open) => {
    const page = await open()
    await select(page, ['stack'])
    const field = page.getByTestId('auto-layout-card').getByRole('combobox', { name: 'Distribute' })
    for (const justify of ['center', 'end', 'space-between', 'start']) {
      await step(page, () => choose(field, justify), async () => { await expect.poll(() => layout(page)).toMatchObject({ justify }) })
    }
    await reloads(page)
  })

  row(55, 'align: start, centre, end', async (open) => {
    const page = await open()
    await select(page, ['stack'])
    const card = page.getByTestId('auto-layout-card')
    await enter(card.getByRole('textbox', { name: 'Padding top' }), '0')
    await enter(card.getByRole('textbox', { name: 'Padding bottom' }), '0')
    const field = card.getByRole('combobox', { name: 'Align', exact: true })
    for (const align of ['center', 'end', 'start']) {
      await step(page, () => choose(field, align), async () => { await expect.poll(() => layout(page)).toMatchObject({ align }) })
    }
    await reloads(page)
  })

  row(56, "the frame's own sizing", async (open) => {
    const page = await open()
    await select(page, ['stack'])
    const card = page.getByTestId('flow-card')
    await step(page, () => choose(card.getByRole('combobox', { name: 'Width sizing' }), 'hug'), async () => {
      await expect.poll(async () => (await props(page, 'stack')).sizing).toMatchObject({ width: 'hug' })
    })
    await step(page, () => choose(card.getByRole('combobox', { name: 'Width sizing' }), 'fixed'), async () => {
      await expect.poll(async () => (await props(page, 'stack')).sizing).toMatchObject({ width: 'fixed' })
    }, { draws: false })
    // Its height is already what its chips need, so hug draws it the same.
    await step(page, () => choose(card.getByRole('combobox', { name: 'Height sizing' }), 'hug'), async () => {
      await expect.poll(async () => (await props(page, 'stack')).sizing).toMatchObject({ height: 'hug' })
    }, { draws: false })
    await reloads(page)
  })

  row(57, "a child's sizing", async (open) => {
    const page = await open()
    await select(page, ['chip1'])
    const card = page.getByTestId('flow-card')
    await step(page, () => choose(card.getByRole('combobox', { name: 'Width sizing' }), 'fill'), async () => {
      await expect.poll(async () => (await props(page, 'chip1')).sizing).toMatchObject({ width: 'fill' })
    })
    // Fixed keeps the width fill gave it; hug, with nothing inside, keeps it too.
    for (const sizing of ['fixed', 'hug']) {
      await step(page, () => choose(card.getByRole('combobox', { name: 'Width sizing' }), sizing), async () => {
        await expect.poll(async () => (await props(page, 'chip1')).sizing).toMatchObject({ width: sizing })
      }, { draws: false })
    }
    // The chip is already as tall as the stack's inside.
    await step(page, () => choose(card.getByRole('combobox', { name: 'Height sizing' }), 'fill'), async () => {
      await expect.poll(async () => (await props(page, 'chip1')).sizing).toMatchObject({ height: 'fill' })
    }, { draws: false })
    await reloads(page)
  })

  row(58, 'a child kept where it is, out of the flow', async (open) => {
    const page = await open()
    await select(page, ['chip1'])
    const box = page.getByTestId('flow-card').getByRole('checkbox', { name: 'Keep where it is, out of the flow' })
    // Out of the flow, Chip 2 moves up to where Chip 1 was.
    await step(page, () => box.click(), async () => { await expect.poll(async () => (await props(page, 'chip1')).absolute).toBe(true) })
    await step(page, () => box.click(), async () => { await expect.poll(async () => (await props(page, 'chip1')).absolute).toBeFalsy() })
    await reloads(page)
  })
})

test.describe('nothing selected', () => {
  const background = async (page: Page) => (await doc(page)).pages.p1?.fills ?? []

  row(59, 'page background: colours, brand colours, hex', async (open) => {
    const page = await open()
    const card = page.getByTestId('page-card')
    await step(page, () => card.getByRole('group', { name: 'Background' }).getByRole('button').nth(1).click(), async () => {
      await expect.poll(async () => (await background(page))[0]?.color).not.toBe('#FFFFFFFF')
    })
    await step(page, () => page.getByTestId('page-brand-colors').getByRole('button', { name: 'Berry #FF3D6E' }).click(), async () => {
      await expect.poll(() => background(page)).toEqual(solid('#FF3D6EFF'))
    })
    await card.getByRole('button', { name: 'Fine-tune' }).click()
    await step(page, () => enter(card.getByRole('textbox', { name: 'Hex', exact: true }), '14213d'), async () => {
      await expect.poll(() => background(page)).toEqual(solid('#14213DFF'))
    })
    await reloads(page)
  })

  row(60, 'background layers: add, remove, each paint', async (open) => {
    const page = await open()
    const card = page.getByTestId('page-card')
    await card.getByRole('button', { name: 'Fine-tune' }).click()
    const layers = page.getByTestId('page-fills')
    await step(page, () => layers.getByRole('button', { name: 'Add a background layer' }).click(), async () => {
      await expect.poll(async () => (await background(page)).length).toBe(2)
    })
    await step(page, () => enter(layers.getByRole('textbox', { name: 'Background 1 hex' }), '2f6bff'), async () => {
      await expect.poll(async () => (await background(page))[1]?.color).toMatch(/^#2F6BFF/)
    })
    await layers.locator('[data-row="1"]').getByTestId('paint-swatch').click()
    await step(page, () => page.getByTestId('paint-editor').getByRole('radio', { name: 'Linear gradient' }).click(), async () => {
      await expect.poll(async () => (await background(page))[1]?.type).toBe('linear')
    })
    await page.keyboard.press('Escape')
    await step(page, () => layers.getByRole('button', { name: 'Remove background layer 1' }).click(), async () => {
      await expect.poll(async () => (await background(page)).length).toBe(1)
    })
    await reloads(page)
  })

  row(61, 'formats: add a preset, a custom size, with checks', async (open) => {
    const page = await open()
    const count = async () => Object.keys((await doc(page)).formats).length
    // A new format adds a frame; the Square, the picture checked, stays the same.
    await step(page, async () => {
      await page.getByRole('button', { name: 'Add format' }).click()
      await page.getByRole('dialog', { name: 'Add format' }).locator('[data-preset=story]').click()
    }, async () => { await expect.poll(count).toBe(2) }, { draws: false })
    await page.getByRole('button', { name: 'Add format' }).click()
    const dialog = page.getByRole('dialog', { name: 'Add format' })
    await dialog.getByLabel('Width').fill('1600')
    await dialog.getByLabel('Height').fill('500')
    await expect(dialog.getByRole('alert')).toHaveText('Sizes run from 1:3 to 3:1.')
    await expect(dialog.getByRole('button', { name: 'Add', exact: true })).toBeDisabled()
    await dialog.getByLabel('Width').fill('1200')
    await step(page, () => dialog.getByRole('button', { name: 'Add', exact: true }).click(), async () => {
      await expect.poll(async () => Object.values((await doc(page)).formats).some((f) => f.width === 1200 && f.height === 500)).toBe(true)
    }, { draws: false })
    await reloads(page)
  })

  row(62, 'formats: rename, make primary, move, remove with undo, show alone', async (open) => {
    const page = await open(true)
    const formats = page.getByTestId('formats')
    const row = formats.locator('[data-format="story"]')
    // A format's name isn't drawn.
    await step(page, async () => {
      await row.getByRole('button', { name: 'Rename: Story' }).dblclick()
      await row.getByRole('textbox', { name: 'Rename' }).fill('Reel')
      await row.getByRole('textbox', { name: 'Rename' }).press('Enter')
    }, async () => { await expect.poll(async () => (await doc(page)).formats.story?.name).toBe('Reel') }, { draws: false })
    // Which format is primary changes no format's picture.
    await step(page, async () => {
      await row.hover()
      await row.getByRole('button', { name: 'Make primary' }).click()
    }, async () => { await expect.poll(async () => (await doc(page)).meta.primaryFormatId).toBe('story') }, { draws: false })
    // The order of formats is the order of the list, not of the picture.
    const order = async () => Object.entries((await doc(page)).formats).sort(([, a], [, b]) => byOrder(a, b)).map(([id]) => id)
    await step(page, async () => {
      await row.hover()
      await row.getByRole('button', { name: 'Move up' }).click()
    }, async () => { await expect.poll(order).toEqual(['story', 'sq']) }, { draws: false })
    await step(page, async () => {
      await row.hover()
      await row.getByRole('button', { name: 'Move down' }).click()
    }, async () => { await expect.poll(order).toEqual(['sq', 'story']) }, { draws: false })
    const square = formats.locator('[data-format="sq"]')
    const kept = await designOf(page)
    await square.hover()
    await square.getByRole('button', { name: 'Remove format' }).click()
    await expect.poll(async () => (await doc(page)).formats.sq).toBeUndefined()
    await page.getByTestId('removed-toast').getByRole('button', { name: 'Undo' }).click()
    await expect.poll(() => designOf(page), { message: 'the toast\'s Undo brings the format back whole' }).toBe(kept)
    await square.hover()
    await square.getByRole('button', { name: 'Show alone' }).click()
    await expect(page.getByTestId('focus-chip')).toBeVisible()
    expect(await page.evaluate(() => window.dazbee?.frames().map((f) => f.formatId))).toEqual(['sq'])
    await page.getByTestId('focus-chip').getByRole('button', { name: 'Show all formats' }).click()
    await reloads(page)
  })

  row(63, 'pages: add, duplicate, rename, move, delete with undo, show', async (open) => {
    const page = await open()
    const pages = page.getByTestId('pages')
    const names = async () => Object.values((await doc(page)).pages).sort(byOrder).map((p) => p.name)
    // The picture checked is the first page's; these steps change the other pages or their names.
    await step(page, () => page.getByRole('button', { name: 'Add page' }).click(), async () => { await expect.poll(names).toEqual(['Page 1', 'Page 2']) }, { draws: false })
    const p1 = pages.locator('[data-page="p1"]')
    await step(page, async () => {
      await p1.hover()
      await p1.getByRole('button', { name: 'Duplicate page' }).click()
    }, async () => { await expect.poll(async () => (await names()).length).toBe(3) }, { draws: false })
    const second = pages.getByRole('listitem').nth(1)
    await step(page, async () => {
      await second.getByRole('button', { name: /^Show / }).dblclick()
      await second.getByRole('textbox', { name: 'Rename' }).fill('Offer')
      await second.getByRole('textbox', { name: 'Rename' }).press('Enter')
    }, async () => { await expect.poll(async () => (await names())[1]).toBe('Offer') }, { draws: false })
    const offer = pages.getByRole('listitem').filter({ hasText: 'Offer' })
    await step(page, async () => {
      await offer.hover()
      await offer.getByRole('button', { name: 'Move up' }).click()
    }, async () => { await expect.poll(async () => (await names())[0]).toBe('Offer') }, { draws: false })
    await step(page, async () => {
      await offer.hover()
      await offer.getByRole('button', { name: 'Move down' }).click()
    }, async () => { await expect.poll(async () => (await names())[1]).toBe('Offer') }, { draws: false })
    const kept = await designOf(page)
    await offer.hover()
    await offer.getByRole('button', { name: 'Delete page' }).click()
    await expect.poll(async () => (await names()).length).toBe(2)
    await page.getByTestId('removed-toast').getByRole('button', { name: 'Undo' }).click()
    await expect.poll(() => designOf(page), { message: 'the toast\'s Undo brings the page back whole' }).toBe(kept)
    await expect(p1).not.toHaveAttribute('aria-current', 'page')
    await p1.getByRole('button', { name: 'Show Page 1' }).click()
    await expect(p1).toHaveAttribute('aria-current', 'page')
    await reloads(page)
  })

  row(64, 'snap and rulers', async (open) => {
    // Snap and rulers are how this tab shows the design, not part of it: no undo, nothing to reload.
    const page = await open()
    const view = page.getByTestId('view-card')
    for (const name of ['Snap', 'Rulers']) {
      const button = view.getByRole('button', { name })
      const was = await button.getAttribute('aria-pressed')
      await button.click()
      await expect(button).not.toHaveAttribute('aria-pressed', was ?? '')
    }
    await expect(page.locator('.stage-overlay .ruler[data-axis="x"]')).toHaveCount(await view.getByRole('button', { name: 'Rulers' }).getAttribute('aria-pressed') === 'true' ? 1 : 0)
    expect(await page.evaluate(() => [window.dazbee?.snapping(), window.dazbee?.rulers()])).toEqual(
      [await view.getByRole('button', { name: 'Snap' }).getAttribute('aria-pressed') === 'true', await view.getByRole('button', { name: 'Rulers' }).getAttribute('aria-pressed') === 'true'],
    )
  })
})

test.describe('left panels and export', () => {
  row(65, 'layers: rename, lock, hide, expand, drag to reorder and into a group', async (open) => {
    const page = await open()
    await page.locator('[data-panel="layers"]').click()
    const tree = page.getByRole('tree')
    const item = (name: string) => tree.getByRole('treeitem').filter({ has: page.locator(`text="${name}"`) })
    await step(page, async () => {
      await item('Box').dblclick()
      await tree.getByRole('textbox', { name: 'Name of Box' }).fill('Hero')
      await tree.getByRole('textbox', { name: 'Name of Box' }).press('Enter')
    }, async () => { await expect.poll(async () => (await doc(page)).nodes.box?.name).toBe('Hero') }, { draws: false })
    await item('Hero').hover()
    await step(page, () => item('Hero').getByRole('button', { name: 'Lock Hero' }).click(), async () => {
      await expect.poll(async () => (await doc(page)).nodes.box?.lock).toMatchObject({ move: true })
    }, { draws: false })
    await step(page, () => item('Hero').getByRole('button', { name: 'Hide Hero' }).click(), async () => {
      await expect.poll(async () => (await props(page, 'box')).visible).toBe(false)
    })
    await item('Stack').getByRole('button', { name: 'Expand Stack' }).click()
    await expect(item('Chip 1')).toBeVisible()
    // The dot overlaps nothing, so its new place shows only in the order.
    await step(page, () => item('Dot').dragTo(item('Hex'), { targetPosition: { x: 60, y: 3 } }), async () => {
      await expect.poll(async () => (await children(page, 'p1')).indexOf('dot')).toBe(2)
    }, { draws: false })
    const stack = await item('Stack').boundingBox()
    await step(page, () => item('Star').dragTo(item('Stack'), { targetPosition: { x: 60, y: (stack?.height ?? 28) / 2 } }), async () => {
      await expect.poll(async () => (await doc(page)).nodes.star?.parentId).toBe('stack')
    })
    // Into a group: the group grows to hold it, and it is drawn where it was.
    await select(page, ['dot', 'poly'])
    await page.getByTestId('arrange').getByRole('button', { name: 'Group', exact: true }).click()
    const group = (await doc(page)).nodes.dot?.parentId ?? ''
    const groupRow = tree.getByRole('treeitem').filter({ has: page.locator(`text="${(await doc(page)).nodes[group]?.name ?? ''}"`) })
    const groupBox = await groupRow.boundingBox()
    await step(page, () => item('Rule').dragTo(groupRow, { targetPosition: { x: 60, y: (groupBox?.height ?? 28) / 2 } }), async () => {
      await expect.poll(async () => (await doc(page)).nodes.rule?.parentId).toBe(group)
    }, { draws: false })
    await reloads(page)
  })

  row(66, 'assets: search, upload, drag onto the page or a shape', async (open) => {
    const page = await open()
    await page.locator('[data-panel="assets"]').click()
    const library = page.getByTestId('asset-library')
    const images = async () => Object.values((await doc(page)).nodes).filter((n) => n.props.fills?.some((f) => f.type === 'image')).length
    const name = `Inventory ${Date.now()}`
    await library.locator('input[type="file"]').setInputFiles({ name: `${name}.jpg`, mimeType: 'image/jpeg', buffer: Buffer.concat([tile, Buffer.from(name)]) })
    const item = library.locator('li[data-asset]').filter({ hasText: name })
    await expect(item).toBeVisible({ timeout: 30_000 })
    await library.getByRole('searchbox', { name: 'Search by name or tag' }).fill(name)
    await expect(library.locator('li[data-asset]')).toHaveCount(1)
    const place = item.getByRole('button', { name: /^Place .* on the design$/ })
    const stage = page.getByTestId('stage')
    /** Where a design pixel is, inside the stage. */
    const onStage = async (x: number, y: number) => {
      const [box, at] = await Promise.all([stage.boundingBox(), page.evaluate(({ x, y }) => window.dazbee?.screenPoint(x, y), { x, y })])
      return { x: (at?.x ?? 0) - (box?.x ?? 0), y: (at?.y ?? 0) - (box?.y ?? 0) }
    }
    await step(page, async () => place.dragTo(stage, { targetPosition: await onStage(900, 900) }), async () => {
      await expect.poll(images).toBe(2)
    })
    await step(page, async () => place.dragTo(stage, { targetPosition: await onStage(820, 240) }), async () => {
      await expect.poll(async () => (await fills(page, 'dot')).at(-1)?.type).toBe('image')
    })
    await reloads(page)
  })

  row(67, 'brand: colours and fonts on the selection', async (open) => {
    const page = await open()
    await page.locator('[data-panel="brand"]').click()
    const picker = page.getByTestId('brand-kit')
    await page.evaluate(() => window.dazbee?.select(['box']))
    await step(page, () => picker.getByRole('button', { name: 'Apply Berry to the selection' }).click(), async () => {
      await expect.poll(async () => (await doc(page)).nodes.box?.bindings).toMatchObject({ fill: 'brand:berry' })
    })
    await page.evaluate(() => window.dazbee?.select(['headline']))
    // Body is Noto Sans, the family the headline has already.
    await step(page, () => picker.getByRole('button', { name: 'Apply Body to the selection' }).click(), async () => {
      await expect.poll(async () => (await doc(page)).nodes.headline?.bindings).toMatchObject({ fontFamily: 'brand:body' })
    }, { draws: false })
    await reloads(page)
  })

  row(68, 'export: pages, formats, file type, JPG quality', async (open) => {
    const page = await open(true)
    await page.getByRole('button', { name: 'Add page' }).click()
    const dialog = page.getByTestId('export')
    const opened = async () => {
      if (await dialog.isVisible()) return
      await page.getByTestId('share-open').click()
      await page.getByTestId('export-open').click()
    }
    await opened()
    await choose(page.getByTestId('export-page'), 'all')
    await expect(page.getByTestId('export-run')).toHaveText('Export 4 files')
    await choose(page.getByTestId('export-page'), 'p1')
    await expect(page.getByTestId('export-run')).toHaveText('Export 2 files')
    await dialog.locator('[data-format="story"]').uncheck()
    await dialog.locator('[data-type="jpg"]').click()
    await expect(page.getByTestId('export-run')).toHaveText('Export 1 file')
    const jpgAt = async (quality: string) => {
      await opened()
      await page.getByTestId('export-quality').fill(quality)
      const [jpg] = await Promise.all([page.waitForEvent('download'), page.getByTestId('export-run').click()])
      expect(jpg.suggestedFilename()).toMatch(/Square\.jpg$/)
      return readFileSync(await jpg.path()).length
    }
    expect(await jpgAt('30')).toBeLessThan(await jpgAt('95'))
    await opened()
    await dialog.locator('[data-type="png"]').click()
    await dialog.locator('[data-format="story"]').check()
    const [zip] = await Promise.all([page.waitForEvent('download'), page.getByTestId('export-run').click()])
    expect(zip.suggestedFilename()).toMatch(/\.zip$/)
  })
})
