// Image uploads (#35): an image uploaded through a signed URL renders the same in the editor's
// export and in Node, both from the bytes stored for its asset id.
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { FALLBACK_FAMILIES } from '@razzlr/fonts'
import { loadFontFiles } from '@razzlr/fonts/node'
import { renderDesign } from '@razzlr/renderer'
import { loadCanvasKit } from '@razzlr/renderer/node'
import { AssetLink, AssetSummary, UploadTicket, type DesignInput } from '@razzlr/schema'
import { editorPath, exportHashOf, writeOutput } from '../support/editor.ts'
import { API_URL, DEV_CLIENT, seed } from '../support/seed.ts'

const photo = new Uint8Array(readFileSync(join(import.meta.dirname, '..', '..', 'pixels', 'assets', 'sneaker.jpg')))

async function api(path: string, body?: unknown) {
  const response = await fetch(`${API_URL}/clients/${DEV_CLIENT}${path}`, body === undefined ? {} : {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  })
  if (!response.ok) throw new Error(`${path}: ${response.status} ${await response.text()}`)
  return response.json() as Promise<unknown>
}

/** Uploads the way the browser will: ask, PUT to the signed URL, record. */
async function upload(bytes: Uint8Array<ArrayBuffer>) {
  const sha256 = createHash('sha256').update(bytes).digest('hex')
  const ticket = UploadTicket.parse(await api('/assets/uploads', { sha256, byteSize: bytes.length, contentType: 'image/jpeg' }))
  if (ticket.asset) return ticket.asset
  const put = await fetch(ticket.upload.url, { method: 'PUT', body: bytes, headers: ticket.upload.headers })
  expect(put.status).toBe(200)
  return AssetSummary.parse(await api('/assets', { sha256 }))
}

const adWith = (assetId: string): DesignInput => ({
  meta: { schemaVersion: 1, designId: 'replaced-by-the-api', name: 'Sneaker ad', kind: 'single', primaryFormatId: 'sq' },
  formats: { sq: { name: 'Square', width: 1080, height: 1080, order: 'a0' } },
  pages: { p1: { name: 'Page 1', order: 'a0', fills: [{ type: 'solid', color: '#F4EFE6FF' }] } },
  nodes: {
    photo: {
      type: 'graphic', parentId: 'p1', index: 'a0', name: 'Photo', role: 'product',
      props: { x: 90, y: 90, width: 900, height: 640, rotation: -3, shape: { kind: 'rect', cornerRadius: 40 }, fills: [{ type: 'image', assetId, fit: 'fill' }] },
    },
    headline: {
      type: 'text', parentId: 'p1', index: 'a1', name: 'Headline', role: 'headline',
      props: { x: 90, y: 800, width: 900, height: 140, text: 'Run lighter', style: { fontFamily: 'Noto Sans', fontSize: 110, fontWeight: 800, color: '#1A1A1AFF' } },
    },
  },
  overrides: {},
})

test('an uploaded image exports with the same pixels in the browser and in Node', async ({ page }) => {
  const asset = await upload(photo)
  expect(asset).toMatchObject({ contentType: 'image/jpeg', byteSize: photo.length })
  const again = await upload(photo)
  expect(again.id).toBe(asset.id)

  const content = adWith(asset.id)
  const designId = await seed(content)
  await page.setViewportSize({ width: 1280, height: 900 })
  await page.goto(editorPath(designId))
  await expect(page.getByTestId('status')).toHaveAttribute('data-ready', '', { timeout: 30_000 })
  writeOutput('images-editor.png', await page.screenshot())
  const browserHash = await exportHashOf(page)

  // Node: the same design and fonts, and the image's bytes from storage by asset id.
  const link = AssetLink.parse(await api(`/assets/${asset.id}`))
  const stored = new Uint8Array(await (await fetch(link.url)).arrayBuffer())
  expect(stored).toEqual(photo)
  const ck = await loadCanvasKit()
  const node = renderDesign(ck, { ...content, meta: { ...content.meta, designId } }, 'p1', 'sq', {
    fonts: loadFontFiles().map((f) => ({ family: f.family, bytes: f.bytes })),
    fallbackFamilies: [...FALLBACK_FAMILIES],
    images: { [asset.id]: stored },
  })
  writeOutput('images-node.png', Buffer.from(node.png))
  const nodeHash = createHash('sha256').update(node.pixels).digest('hex')
  expect(browserHash).toBe(nodeHash)
})

test('the editor cannot read another client’s image', async ({ page }) => {
  const asset = await upload(photo)
  const response = await page.request.get(`/clients/dev-client-cycles/assets/${asset.id}`)
  expect(response.status()).toBe(404)
  const own = await page.request.get(`/clients/${DEV_CLIENT}/assets/${asset.id}`)
  expect(own.status()).toBe(200)
  expect(new Uint8Array(await own.body())).toEqual(photo)
})
