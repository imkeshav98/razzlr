// Copy and paste across designs (#49), with real keys: a group with a photo, text and a shape
// copied in one design and pasted into another draws the same pixels there; pasting twice gives
// two copies; each paste is one undo step; Mod+Shift+V puts it where the pointer is.
import { expect, test, type Page } from '../support/test.ts'
import type { DesignInput } from '@dazbee/schema'
import { photo, upload } from '../support/assets.ts'
import { editorPath, exportHashOf, screenPoint, writeOutput } from '../support/editor.ts'
import { seed } from '../support/seed.ts'
import { click, openStage, press, read, selection } from '../support/stage.ts'

test.describe.configure({ timeout: 120_000 })

type Node = DesignInput['nodes'][string]
const BACKGROUND = [{ type: 'solid', color: '#FFF6E8FF' }] as const
const shell = (name: string, nodes: Record<string, Node>): DesignInput => ({
  meta: { schemaVersion: 3, designId: 'replaced-by-the-api', name, kind: 'single', primaryFormatId: 'sq' },
  formats: { sq: { name: 'Square', width: 1080, height: 1080, order: 'a0' } },
  pages: { p1: { name: 'Page 1', order: 'a0', fills: [...BACKGROUND] } },
  nodes,
  overrides: {},
})
const source = (assetId: string) => shell('Source', {
  card: { type: 'group', parentId: 'p1', index: 'a0', name: 'Card', props: { x: 100, y: 100, width: 500, height: 400 } },
  tile: {
    type: 'graphic', parentId: 'card', index: 'a0', name: 'Photo',
    props: { x: 100, y: 100, width: 500, height: 400, rotation: -4, shape: { kind: 'rect', cornerRadius: 32 }, fills: [{ type: 'image', assetId, fit: 'fill', filter: 'warm' }] },
  },
  label: {
    type: 'text', parentId: 'card', index: 'a1', name: 'Label',
    props: { x: 140, y: 380, width: 420, height: 90, text: 'Fresh drop', style: { fontFamily: 'Noto Sans', fontSize: 64, fontWeight: 800, color: '#FFFFFFFF', outline: { width: 3, color: '#15121AFF' } } },
  },
  badge: {
    type: 'graphic', parentId: 'card', index: 'a2', name: 'Badge',
    props: { x: 480, y: 120, width: 100, height: 100, shape: { kind: 'star', points: 8, innerRadius: 0.7 }, fills: [{ type: 'solid', color: '#FF48B0FF' }] },
  },
  other: {
    type: 'graphic', parentId: 'p1', index: 'a1', name: 'Other', props: { x: 700, y: 700, width: 200, height: 200, shape: { kind: 'ellipse' }, fills: [{ type: 'solid', color: '#3D6BFFFF' }] },
  },
})
const target = () => shell('Target', {
  stripe: { type: 'graphic', parentId: 'p1', index: 'a0', name: 'Stripe', props: { x: 0, y: 900, width: 1080, height: 120, shape: { kind: 'rect' }, fills: [{ type: 'solid', color: '#15121AFF' }] } },
})

/** SHA-256 of the export's pixels inside a rect of the 1080 wide square. */
const regionHash = (page: Page, r: { x: number; y: number; width: number; height: number }) =>
  page.evaluate(async (r) => {
    const pixels = window.dazbee?.exportPixels()
    if (!pixels) throw new Error('no editor')
    const rows: Uint8Array[] = []
    for (let y = r.y; y < r.y + r.height; y++) rows.push(pixels.slice((y * 1080 + r.x) * 4, (y * 1080 + r.x + r.width) * 4))
    const all = new Uint8Array(rows.reduce((n, row) => n + row.length, 0))
    let at = 0
    for (const row of rows) {
      all.set(row, at)
      at += row.length
    }
    const digest = await crypto.subtle.digest('SHA-256', all)
    return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
  }, r)
// Wide enough for the turned photo and the outlined text.
const CARD = { x: 60, y: 60, width: 580, height: 480 }

async function goTo(page: Page, designId: string) {
  await page.goto(editorPath(designId))
  await expect(page.getByTestId('status')).toHaveAttribute('data-ready', '', { timeout: 30_000 })
  await page.evaluate(() => window.dazbee?.setCamera({ x: 100, y: 60, zoom: 0.8 }))
  await page.evaluate(() => window.dazbee?.drawn())
}
const keys = async (page: Page, key: string) => {
  await page.keyboard.press(key)
  await page.evaluate(() => window.dazbee?.drawn())
}
const layersUnder = async (page: Page, parentId: string) => Object.entries((await read(page)).nodes).filter(([, n]) => n.parentId === parentId).map(([id]) => id)

test('a group copied in one design pastes into another with the same pixels, twice for two copies, each one undo', async ({ browser }) => {
  const asset = await upload(photo)
  const { page, errors } = await openStage(browser, source(asset.id))
  const targetId = await seed(target())
  await click(page, 300, 300)
  expect(await selection(page)).toEqual(['card'])
  const card = (await read(page)).nodes.card?.props
  const copied = await regionHash(page, CARD)
  await keys(page, 'ControlOrMeta+C')
  writeOutput('clipboard-0-copied.png', await page.screenshot({ animations: 'disabled' }))

  await goTo(page, targetId)
  const before = await exportHashOf(page)
  expect(await regionHash(page, CARD)).not.toBe(copied)
  await keys(page, 'ControlOrMeta+V')
  const [first = ''] = await selection(page)
  const d = await read(page)
  expect(d.nodes[first]?.parentId).toBe('p1')
  // Where it was, the size it was.
  expect(d.nodes[first]?.props).toMatchObject({ x: card?.x, y: card?.y, width: card?.width, height: card?.height })
  // Fresh ids, the children in their order, the photo's asset the same.
  const inside = (await layersUnder(page, first)).sort((a, b) => ((d.nodes[a]?.index ?? '') < (d.nodes[b]?.index ?? '') ? -1 : 1))
  expect(inside).toHaveLength(3)
  expect(inside.some((id) => ['tile', 'label', 'badge'].includes(id))).toBe(false)
  expect(inside.map((id) => (d.nodes[id] as unknown as { name: string }).name)).toEqual(['Photo', 'Label', 'Badge'])
  expect(d.nodes[inside[0] ?? '']?.props.fills).toEqual([{ type: 'image', assetId: asset.id, fit: 'fill', filter: 'warm', opacity: 1 }])
  // The photo's bytes load for this design too: the pasted card draws exactly as it did.
  await expect.poll(() => regionHash(page, CARD), { timeout: 15_000 }).toBe(copied)
  writeOutput('clipboard-1-pasted.png', await page.screenshot({ animations: 'disabled' }))

  // The same clipboard again: a second copy, on top, with its own ids.
  await keys(page, 'ControlOrMeta+V')
  const [second = ''] = await selection(page)
  expect(second).not.toBe(first)
  expect(await layersUnder(page, 'p1')).toEqual(expect.arrayContaining(['stripe', first, second]))
  expect(Object.keys((await read(page)).nodes)).toHaveLength(1 + 2 * 4)

  // One undo per paste.
  await press(page, 'undo')
  expect((await read(page)).nodes[second]).toBeUndefined()
  expect((await read(page)).nodes[first]).toBeDefined()
  await press(page, 'undo')
  expect(Object.keys((await read(page)).nodes)).toEqual(['stripe'])
  expect(await exportHashOf(page)).toBe(before)
  expect(errors).toEqual([])
})

test('Mod+Shift+V pastes centred on the pointer, and cut takes the layers away in one undo step', async ({ browser }) => {
  const asset = await upload(photo)
  const { page, errors } = await openStage(browser, source(asset.id))
  await click(page, 800, 800)
  expect(await selection(page)).toEqual(['other'])
  await keys(page, 'ControlOrMeta+X')
  expect((await read(page)).nodes.other).toBeUndefined()
  // Paste with the pointer over (300, 800): the 200 circle is centred there.
  const p = await screenPoint(page, 300, 800)
  await page.mouse.move(p.x, p.y)
  await keys(page, 'ControlOrMeta+Shift+V')
  const [pasted = ''] = await selection(page)
  expect((await read(page)).nodes[pasted]?.props).toMatchObject({ x: 200, y: 700, width: 200, height: 200 })
  writeOutput('clipboard-2-at-pointer.png', await page.screenshot({ animations: 'disabled' }))
  // Cut was one step: undoing the paste, then the cut, brings the circle back where it was.
  await press(page, 'undo')
  await press(page, 'undo')
  expect((await read(page)).nodes.other?.props).toMatchObject({ x: 700, y: 700 })
  expect(errors).toEqual([])
})
