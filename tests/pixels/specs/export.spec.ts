// The export seam (#55): every fixture page in every format, exported as PNG and as JPG in
// Chromium and in Node, gives the same file byte for byte.
import { createHash } from 'node:crypto'
import { expect } from '@playwright/test'
import { exportDesign } from '@razzlr/export'
import { loadCanvasKit } from '@razzlr/renderer/node'
import { parseDesign } from '@razzlr/schema'
import { loadFixtures } from '../src/fixtures.ts'
import { fixtureResources } from '../src/pixels.ts'
import { test } from './support/harness.ts'

const cases = loadFixtures().flatMap(({ name, json }) => {
  const parsed = parseDesign(json)
  if (!parsed.success) throw new Error(parsed.errors.join('\n'))
  const assetIds = [...new Set(JSON.stringify(json).match(/"assetId":"[^"]+"/g)?.map((m) => m.slice(11, -1)) ?? [])]
  return Object.keys(parsed.design.pages).flatMap((pageId) =>
    Object.keys(parsed.design.formats).map((formatId) => ({ name, json, pageId, formatId, assetIds })))
})
const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')

for (const c of cases) {
  test(`${c.name} ${c.pageId}.${c.formatId}: the browser's PNG and JPG are Node's, byte for byte`, async ({ harness }) => {
    const ck = await loadCanvasKit()
    for (const type of ['png', 'jpg'] as const) {
      const node = exportDesign(ck, c.json, { pageIds: [c.pageId], formatIds: [c.formatId], type, quality: 85 }, fixtureResources()).bytes
      const browser = await harness.exportFile(c.json, c.pageId, c.formatId, type, c.assetIds)
      expect(browser.length, type).toBeGreaterThan(0)
      expect(sha(browser), type).toBe(sha(node))
    }
  })
}
