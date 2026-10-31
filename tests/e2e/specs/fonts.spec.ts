// Fonts (#50) in Chromium. A design using a Google font and an uploaded one opens with those two
// families' files and no others, all from our own origin, and its export is byte for byte what Node
// draws from the same files fetched through the API. The font picker lists families as pictures of
// their names, searches, picks, sets the weight and uploads, each pick one undo step.
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test, type Page, type Request } from '@playwright/test'
import { exportDesign } from '@razzlr/export'
import { FALLBACK_FAMILIES } from '@razzlr/fonts'
import { loadFontFiles } from '@razzlr/fonts/node'
import { loadCanvasKit } from '@razzlr/renderer/node'
import { FontFace, FontFamily, FontLink, FontUploadTicket, type DesignInput } from '@razzlr/schema'
import { createHash } from 'node:crypto'
import { api } from '../support/assets.ts'
import { designOf, editorPath, writeOutput } from '../support/editor.ts'
import { API_URL, DEV_BRAND, seed } from '../support/seed.ts'
import { openStage } from '../support/stage.ts'

test.describe.configure({ timeout: 180_000 })

const GOOGLE = ['Inter', 'Playfair Display', 'Lobster']
const righteous = new Uint8Array(readFileSync(join(import.meta.dirname, '..', 'assets', 'fonts', 'Righteous-Regular.ttf')))

/** Copies the Google families these checks use into the stack's storage, as `fonts:google` does for a deployment. */
function importGoogleFonts() {
  const root = join(import.meta.dirname, '..', '..', '..')
  execFileSync('node', ['apps/api/src/import-google-fonts.ts', ...GOOGLE], {
    cwd: root,
    stdio: 'pipe',
    env: {
      DATABASE_URL: 'postgres://razzlr:razzlr-local@127.0.0.1:55432/razzlr',
      STORAGE_ENDPOINT: 'http://127.0.0.1:59000', STORAGE_BUCKET: 'razzlr', STORAGE_ACCESS_KEY_ID: 'razzlr',
      STORAGE_SECRET_ACCESS_KEY: 'razzlr-local-secret', STORAGE_REGION: 'us-east-1',
      ...process.env,
    },
  })
}

/** Uploads a font for the development brand the way the web app does: ask, PUT to the signed URL, record. */
async function uploadFont(bytes: Uint8Array<ArrayBuffer>) {
  const sha256 = createHash('sha256').update(bytes).digest('hex')
  const ticket = FontUploadTicket.parse(await api('/fonts/uploads', { sha256, byteSize: bytes.length, contentType: 'font/ttf' }))
  if (ticket.face) return ticket.face
  expect((await fetch(ticket.upload.url, { method: 'PUT', body: bytes, headers: ticket.upload.headers })).status).toBe(200)
  return FontFace.parse(await api('/fonts', { sha256 }))
}

test.beforeAll(async () => {
  importGoogleFonts()
  await uploadFont(righteous)
})

const text = (y: number, fontFamily: string, fontWeight: number, words: string) => ({
  x: 80, y, width: 920, height: 160, text: words, style: { fontFamily, fontSize: 96, fontWeight, color: '#15121AFF' },
})
const design = (): DesignInput => ({
  meta: { schemaVersion: 2, designId: 'replaced-by-the-api', name: 'Font check', kind: 'single', primaryFormatId: 'sq' },
  formats: { sq: { name: 'Square', width: 1080, height: 1080, order: 'a0' } },
  pages: { p1: { name: 'Page 1', order: 'a0', fills: [{ type: 'solid', color: '#FFF6E8FF' }] } },
  nodes: {
    headline: { type: 'text', parentId: 'p1', index: 'a0', name: 'Headline', role: 'headline', props: text(100, 'Inter', 800, 'Fresh roast') },
    badge: { type: 'text', parentId: 'p1', index: 'a1', name: 'Badge', props: text(400, 'Righteous', 400, 'Only today') },
    body: { type: 'text', parentId: 'p1', index: 'a2', name: 'Body', props: { ...text(700, 'Noto Sans', 400, 'Shipped font'), style: { fontFamily: 'Noto Sans', fontSize: 64, color: '#15121AFF' } } },
  },
  overrides: {},
})

/** The face ids of font files a page fetched, from the moment this is called; previews are pictures, not fonts. */
function fontRequests(page: Page) {
  const seen: string[] = []
  const elsewhere: string[] = []
  const listen = (request: Request) => {
    const url = new URL(request.url())
    if (!['localhost', '127.0.0.1'].includes(url.hostname)) elsewhere.push(url.href)
    const face = new RegExp(`^/brands/${DEV_BRAND}/fonts/([^/]+)$`).exec(url.pathname)?.[1]
    if (face) seen.push(decodeURIComponent(face))
  }
  page.on('request', listen)
  return { seen, elsewhere }
}

async function catalog() {
  return FontFamily.array().parse(await (await fetch(`${API_URL}/brands/${DEV_BRAND}/fonts`)).json())
}
const faceIds = (families: FontFamily[], ...names: string[]) => families.filter((f) => names.includes(f.family)).flatMap((f) => f.faces.map((face) => face.id)).sort()

/** The files of the named families through the API, the bytes Node registers. */
async function filesOf(families: FontFamily[], names: string[]) {
  const faces = families.filter((f) => names.includes(f.family)).flatMap((f) => f.faces)
  return Promise.all(faces.map(async (face) => {
    const link = FontLink.parse(await api(`/fonts/faces/${face.id}`))
    return { family: face.family, bytes: new Uint8Array(await (await fetch(link.url)).arrayBuffer()) }
  }))
}

test('a design with a Google font and an uploaded font loads only those files, and exports what Node draws', async ({ browser }) => {
  const designId = await seed(design())
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
  const page = await context.newPage()
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  const requests = fontRequests(page)
  await page.goto(editorPath(designId))
  await expect(page.getByTestId('status')).toHaveAttribute('data-ready', '', { timeout: 30_000 })
  await page.evaluate(() => window.razzlr?.drawn())

  const families = await catalog()
  expect(families.filter((f) => GOOGLE.includes(f.family)).map((f) => f.family).sort()).toEqual([...GOOGLE].sort())
  // Every Inter weight and the one Righteous file, no other family's, nothing from anywhere but us.
  expect([...requests.seen].sort()).toEqual(faceIds(families, 'Inter', 'Righteous'))
  expect(requests.elsewhere).toEqual([])
  expect(await page.evaluate(() => window.razzlr?.loadedFamilies().sort())).toEqual(['Inter', 'Noto Naskh Arabic', 'Noto Sans', 'Noto Sans Devanagari', 'Righteous'])

  const browserPng = Buffer.from(await page.evaluate(async () => {
    const file = await window.razzlr?.exportFiles({ pageIds: ['p1'], formatIds: ['sq'], type: 'png' })
    return btoa(Array.from(file?.bytes ?? [], (b) => String.fromCharCode(b)).join(''))
  }), 'base64')
  const ck = await loadCanvasKit()
  const json = JSON.parse(await designOf(page)) as unknown
  const shipped = loadFontFiles().map((f) => ({ family: f.family, bytes: f.bytes }))
  const node = (fonts: { family: string; bytes: Uint8Array }[]) =>
    Buffer.from(exportDesign(ck, json, { pageIds: ['p1'], formatIds: ['sq'], type: 'png' }, { fonts, fallbackFamilies: [...FALLBACK_FAMILIES], images: {} }).bytes)
  const nodePng = node([...shipped, ...await filesOf(families, ['Inter', 'Righteous'])])
  expect(browserPng.equals(nodePng), 'the browser export is byte for byte the Node one').toBe(true)
  // And the families are really drawn: with the fallback fonts alone the picture differs.
  expect(browserPng.equals(node(shipped))).toBe(false)
  writeOutput('fonts-0-export.png', browserPng)
  writeOutput('fonts-0-requests.json', JSON.stringify({ fontFiles: requests.seen.length, families: ['Inter', 'Righteous'], elsewhere: requests.elsewhere }, null, 2))
  expect(errors).toEqual([])
  await context.close()
})

const style = async (page: Page, id: string) => (JSON.parse(await designOf(page)) as { nodes: Record<string, { props: { style: { fontFamily: string; fontWeight: number } } }> }).nodes[id]?.props.style

test('the font picker shows families as pictures of their names, searches, picks, sets the weight and uploads', async ({ browser }) => {
  const { page, errors } = await openStage(browser, design())
  const families = await catalog()
  await page.evaluate(() => window.razzlr?.select(['body']))
  const panel = page.getByTestId('font-panel')
  await expect(page.getByTestId('font-open')).toHaveAttribute('data-family', 'Noto Sans')
  writeOutput('fonts-1-panel.png', await panel.screenshot())

  const requests = fontRequests(page)
  await page.getByTestId('font-open').click()
  const list = page.getByTestId('font-list')
  await expect(list).toBeVisible()
  // Previews are pictures drawn by the API in each family; Inter's has loaded and has a size.
  const inter = list.locator('[data-family="Inter"] img')
  await expect(inter).toHaveAttribute('alt', 'Inter')
  await expect.poll(() => inter.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth)).toBeGreaterThan(40)
  await expect(list.getByText('Google Fonts')).toBeVisible()
  await expect(list.getByText('Brand fonts')).toBeVisible()
  writeOutput('fonts-2-list.png', await page.screenshot())
  // Opening the list loads no font files, only pictures.
  expect(requests.seen).toEqual([])

  await page.getByTestId('font-search').fill('playf')
  await expect(list.locator('[role="option"]')).toHaveCount(1)
  writeOutput('fonts-3-search.png', await page.screenshot({ clip: { x: 1100, y: 0, width: 340, height: 700 } }))
  await page.getByTestId('font-search').press('Enter')
  await expect(list).toBeHidden()
  // Noto Sans 400 becomes Playfair Display 400, and its files load now.
  expect(await style(page, 'body')).toMatchObject({ fontFamily: 'Playfair Display', fontWeight: 400 })
  await expect.poll(() => [...requests.seen].sort()).toEqual(faceIds(families, 'Playfair Display'))
  await expect.poll(() => page.evaluate(() => window.razzlr?.loadedFamilies().includes('Playfair Display'))).toBe(true)

  await page.getByTestId('font-weight').selectOption('900')
  expect(await style(page, 'body')).toMatchObject({ fontFamily: 'Playfair Display', fontWeight: 900 })
  await page.evaluate(() => window.razzlr?.drawn())
  writeOutput('fonts-4-picked.png', await page.screenshot())

  // Each pick is one undo step.
  await page.evaluate(() => window.razzlr?.perform('undo'))
  expect(await style(page, 'body')).toMatchObject({ fontFamily: 'Playfair Display', fontWeight: 400 })
  await page.evaluate(() => window.razzlr?.perform('undo'))
  expect(await style(page, 'body')).toMatchObject({ fontFamily: 'Noto Sans', fontWeight: 400 })

  // An upload from the list joins the brand's fonts and is set at once.
  await page.getByTestId('font-open').click()
  await page.getByTestId('font-upload').setInputFiles({ name: 'Righteous-Regular.ttf', mimeType: 'font/ttf', buffer: Buffer.from(righteous) })
  await expect(list).toBeHidden()
  await expect.poll(async () => (await style(page, 'body'))?.fontFamily).toBe('Righteous')
  await page.getByTestId('font-open').click()
  await expect(list.locator('[data-family="Righteous"]')).toHaveAttribute('aria-selected', 'true')
  writeOutput('fonts-5-uploaded.png', await page.screenshot({ clip: { x: 1100, y: 0, width: 340, height: 700 } }))
  await page.keyboard.press('Escape')

  // A file that isn't a font is refused with a reason.
  await page.getByTestId('font-open').click()
  await page.getByTestId('font-upload').setInputFiles({ name: 'notes.ttf', mimeType: 'font/ttf', buffer: Buffer.from('not a font') })
  await expect(list.getByRole('alert')).toContainText('not a TrueType or OpenType font')
  expect(errors).toEqual([])
})
