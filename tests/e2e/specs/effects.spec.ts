// Strokes, gradients, effects and blend modes in the editor (#43): the strokes-and-effects pixel
// fixture opens on the stage and exports from the browser with the same pixels as Node; changing
// a stroke's dashes, a glow and a group's blending changes the export and undo puts it back; and a
// design sent at schema version 1 comes back at version 2, drawn as before.
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { FALLBACK_FAMILIES } from '@razzlr/fonts'
import { loadFontFiles } from '@razzlr/fonts/node'
import { renderDesign } from '@razzlr/renderer'
import { loadCanvasKit } from '@razzlr/renderer/node'
import type { DesignInput } from '@razzlr/schema'
import { expect, test, type Page } from '../support/test.ts'
import { editorPath, exportHashOf, writeOutput } from '../support/editor.ts'
import { seed } from '../support/seed.ts'

test.describe.configure({ timeout: 120_000 })

const fixture = (name: string) => JSON.parse(readFileSync(join(import.meta.dirname, '..', '..', 'pixels', 'fixtures', `${name}.json`), 'utf8')) as DesignInput

async function open(page: Page, content: DesignInput) {
  const designId = await seed(content)
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.setViewportSize({ width: 1280, height: 900 })
  await page.goto(editorPath(designId))
  await expect(page.getByTestId('status')).toHaveAttribute('data-ready', '', { timeout: 60_000 })
  await page.keyboard.press('Escape')
  await page.evaluate(() => window.razzlr?.drawn())
  return { designId, errors }
}

/** The export's pixels rendered in Node from the same design, as a SHA-256. */
async function nodeHash(content: DesignInput) {
  const ck = await loadCanvasKit()
  const node = renderDesign(ck, content, 'p1', 'sq', {
    fonts: loadFontFiles().map((f) => ({ family: f.family, bytes: f.bytes })),
    fallbackFamilies: [...FALLBACK_FAMILIES],
    images: {},
  })
  return createHash('sha256').update(node.pixels).digest('hex')
}

const run = (page: Page, name: string, input: unknown) =>
  page.evaluate(([name, input]) => (window.razzlr?.session.run as (n: string, i: unknown) => unknown)(name, input), [name, input] as const)

test('every new paint, stroke and effect draws on the stage and exports as Node renders it', async ({ page }) => {
  const content = fixture('strokes-and-effects')
  const { errors } = await open(page, content)
  writeOutput('effects-0-stage.png', await page.screenshot())
  const browser = await exportHashOf(page)
  expect(browser).toBe(await nodeHash(content))

  // A dash pattern, a glow and a group's blending, each one undo step that changes the export.
  const hashes = [browser]
  await run(page, 'node.update', { ids: ['dashed'], patch: { strokes: [{ paint: { type: 'solid', color: '#263238FF' }, width: 8, dashes: [2, 14], cap: 'round' }] } })
  await run(page, 'node.update', { ids: ['orb'], patch: { effects: [{ type: 'glow', blur: 80, spread: 20, color: '#00E5FFFF' }] } })
  await run(page, 'node.update', { ids: ['through'], patch: { blendMode: 'normal' } })
  await page.evaluate(() => window.razzlr?.drawn())
  writeOutput('effects-1-edited.png', await page.screenshot())
  hashes.push(await exportHashOf(page))
  expect(hashes[1]).not.toBe(hashes[0])
  for (let i = 0; i < 3; i++) await page.evaluate(() => window.razzlr?.session.undo())
  await page.evaluate(() => window.razzlr?.drawn())
  expect(await exportHashOf(page)).toBe(browser)
  expect(errors).toEqual([])
})

test('a design sent at version 1 is stored at version 2 and draws as it did', async ({ page }) => {
  const content = fixture('groups-and-frames')
  expect(content.meta.schemaVersion as number).toBe(1)
  const { errors } = await open(page, content)
  const design = await page.evaluate(() => window.razzlr?.design()) as { meta: { schemaVersion: number }; nodes: Record<string, { type: string; props: { blendMode: string } }> }
  expect(design.meta.schemaVersion).toBe(2)
  const containers = Object.values(design.nodes).filter((n) => n.type === 'group' || n.type === 'frame')
  expect(containers.length).toBeGreaterThan(0)
  expect(new Set(containers.map((n) => n.props.blendMode))).toEqual(new Set(['pass-through']))
  // The pixels are the version 1 reference's: Node renders the version 1 JSON through the same migration.
  expect(await exportHashOf(page)).toBe(await nodeHash(content))
  writeOutput('effects-2-version-1.png', await page.screenshot())
  expect(errors).toEqual([])
})
