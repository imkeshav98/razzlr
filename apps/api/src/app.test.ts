// The API seam, against Postgres from Docker Compose (`docker compose up -d --wait postgres`).
import { createHash, randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { brands, fontFaces, migrateDatabase, openDatabase, workspaces, readDesignState } from '@razzlr/db'
import { readDesign } from '@razzlr/doc'
import { ApiError, AssetLink, AssetSummary, BrandSummary, DesignSummary, FontFace, FontFamily, FontLink, FontUploadTicket, SyncToken, UploadTicket, WorkspaceSummary } from '@razzlr/schema'
import { openStorage, storageSettings } from '@razzlr/storage'
import { verifySyncToken } from '@razzlr/sync-token'
import { FONT_FILES_DIR } from '@razzlr/fonts/node'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { eq } from 'drizzle-orm'
import { createApp } from './app.ts'
import { fontFiles, importGoogleFamily } from './fonts.ts'
import { png } from './images.test.ts'
import type { Session } from './session.ts'

const DATABASE_URL = process.env.DATABASE_URL ?? 'postgres://razzlr:razzlr-local@127.0.0.1:55432/razzlr'
const { db, close } = openDatabase(DATABASE_URL)

// Two workspaces with a brand each, fresh for every run so runs never see each other's rows.
const run = randomUUID().slice(0, 8)
const workspace = { id: `workspace-a-${run}`, name: 'Agency A', kind: 'agency' as const }
const other = { id: `workspace-b-${run}`, name: 'Studio B', kind: 'solo' as const }
const brand = { id: `brand-a-${run}`, workspaceId: workspace.id, name: 'Brand A' }
const sibling = { id: `brand-a2-${run}`, workspaceId: workspace.id, name: 'Brand A2' }
const otherBrand = { id: `brand-b-${run}`, workspaceId: other.id, name: 'Brand B' }

const sessions: Record<string, Session> = {
  a: { userId: 'user-a', workspaceId: workspace.id },
  b: { userId: 'user-b', workspaceId: other.id },
}
/** A stand-in Google family, served by a fake Google from the Noto files, removed after the run. */
const googleFamily = { family: `Test Sans ${run}`, category: 'sans-serif', weights: [400, 700], italic: false } as const

const syncSecret = 'test-secret-'.padEnd(32, 'x')
const storage = openStorage(storageSettings({
  STORAGE_ENDPOINT: 'http://127.0.0.1:59000',
  STORAGE_BUCKET: 'razzlr-test',
  STORAGE_ACCESS_KEY_ID: 'razzlr',
  STORAGE_SECRET_ACCESS_KEY: 'razzlr-local-secret',
  STORAGE_REGION: 'us-east-1',
  ...process.env,
}))
const app = createApp({ db, storage, sessionOf: (request) => sessions[request.headers.get('x-test-session') ?? ''] ?? null, syncSecret })

async function call(as: string | null, method: string, path: string, body?: unknown) {
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (as) headers['x-test-session'] = as
  const response = await app.request(path, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
  return { status: response.status, json: await response.json() as unknown }
}

beforeAll(async () => {
  await migrateDatabase(db)
  await storage.ensureBucket()
  await db.insert(workspaces).values([workspace, other])
  await db.insert(brands).values([brand, sibling, otherBrand])
})
afterAll(async () => {
  await db.delete(fontFaces).where(eq(fontFaces.family, googleFamily.family))
  await close()
})

describe('the workspace', () => {
  it('answers with the session’s own workspace and its kind', async () => {
    expect(WorkspaceSummary.parse((await call('a', 'GET', '/workspace')).json)).toEqual(workspace)
    expect(WorkspaceSummary.parse((await call('b', 'GET', '/workspace')).json)).toEqual(other)
  })

  it('changes the kind of the session’s workspace only, and refuses one it does not know', async () => {
    const changed = await call('b', 'PATCH', '/workspace', { kind: 'company' })
    expect(WorkspaceSummary.parse(changed.json)).toEqual({ ...other, kind: 'company' })
    expect(WorkspaceSummary.parse((await call('a', 'GET', '/workspace')).json).kind).toBe('agency')
    const refused = await call('b', 'PATCH', '/workspace', { kind: 'enterprise' })
    expect(refused.status).toBe(400)
    await call('b', 'PATCH', '/workspace', { kind: 'solo' })
  })
})

describe('designs per brand', () => {
  it('creates, lists and opens a design', async () => {
    const created = await call('a', 'POST', `/brands/${brand.id}/designs`, { name: 'Spring sale' })
    expect(created.status).toBe(201)
    const design = DesignSummary.parse(created.json)
    expect(design).toMatchObject({ brandId: brand.id, name: 'Spring sale', kind: 'single' })

    const listed = await call('a', 'GET', `/brands/${brand.id}/designs`)
    expect(DesignSummary.array().parse(listed.json).map((d) => d.id)).toEqual([design.id])

    const opened = await call('a', 'GET', `/brands/${brand.id}/designs/${design.id}`)
    expect(opened).toEqual({ status: 200, json: design })
  })

  it('starts a design with one blank page, already in the store for the sync server', async () => {
    const { json } = await call('a', 'POST', `/brands/${brand.id}/designs`, { name: 'Blank' })
    const { id } = DesignSummary.parse(json)
    const state = await readDesignState(db, id)
    if (!state) throw new Error('no state')
    const doc = new Y.Doc()
    Y.applyUpdate(doc, state)
    const design = readDesign(doc)
    expect(design.meta).toMatchObject({ designId: id, name: 'Blank', kind: 'single' })
    expect(Object.keys(design.pages)).toHaveLength(1)
    expect(design.formats).toEqual({ sq: expect.objectContaining({ width: 1080, height: 1080 }) })
  })

  it('starts a design from given content, under its own id and name', async () => {
    const content = {
      meta: { schemaVersion: 2, designId: 'ignored', name: 'Ignored', kind: 'carousel', primaryFormatId: 'pt' },
      formats: { pt: { name: 'Portrait', width: 1080, height: 1350, order: 'a0' } },
      pages: { p1: { name: 'Card 1', order: 'a0' }, p2: { name: 'Card 2', order: 'a1' } },
      nodes: {},
      overrides: {},
    }
    const { status, json } = await call('a', 'POST', `/brands/${brand.id}/designs`, { name: 'Carousel', content })
    expect(status).toBe(201)
    const { id, kind } = DesignSummary.parse(json)
    expect(kind).toBe('carousel')
    const doc = new Y.Doc()
    Y.applyUpdate(doc, await readDesignState(db, id) ?? new Uint8Array())
    expect(readDesign(doc).meta).toMatchObject({ designId: id, name: 'Carousel' })
    expect(Object.keys(readDesign(doc).pages)).toEqual(['p1', 'p2'])
  })

  it('lists only the asked brand’s designs, newest change first', async () => {
    const first = DesignSummary.parse((await call('a', 'POST', `/brands/${sibling.id}/designs`, { name: 'First' })).json)
    const second = DesignSummary.parse((await call('a', 'POST', `/brands/${sibling.id}/designs`, { name: 'Second' })).json)
    const { json } = await call('a', 'GET', `/brands/${sibling.id}/designs`)
    expect(DesignSummary.array().parse(json).map((d) => d.id)).toEqual([second.id, first.id])
  })

  it('lists and creates brands within the workspace only', async () => {
    const created = await call('a', 'POST', '/brands', { name: 'New brand' })
    expect(created.status).toBe(201)
    const { json } = await call('a', 'GET', '/brands')
    expect(BrandSummary.array().parse(json).map((c) => c.name)).toEqual(['Brand A', 'Brand A2', 'New brand'])
    const theirs = await call('b', 'GET', '/brands')
    expect(BrandSummary.array().parse(theirs.json).map((c) => c.id)).toEqual([otherBrand.id])
  })
})

describe('refusals', () => {
  it('refuses every route without a session', async () => {
    for (const [method, path] of [['GET', '/workspace'], ['PATCH', '/workspace'], ['GET', '/brands'], ['POST', '/brands'], ['GET', `/brands/${brand.id}/designs`], ['POST', `/brands/${brand.id}/designs`]] as const) {
      const response = await call(null, method, path, method === 'GET' ? undefined : { name: 'x' })
      expect(response, `${method} ${path}`).toEqual({ status: 401, json: { error: 'Sign in first' } })
    }
  })

  it('answers another workspace’s brand and design as if they did not exist', async () => {
    const theirs = DesignSummary.parse((await call('b', 'POST', `/brands/${otherBrand.id}/designs`, { name: 'Theirs' })).json)
    expect((await call('a', 'GET', `/brands/${otherBrand.id}/designs`)).status).toBe(404)
    expect((await call('a', 'GET', `/brands/${otherBrand.id}/designs/${theirs.id}`)).status).toBe(404)
    expect((await call('a', 'POST', `/brands/${otherBrand.id}/designs`, { name: 'Sneaky' })).status).toBe(404)
    // The owner still sees it.
    expect((await call('b', 'GET', `/brands/${otherBrand.id}/designs/${theirs.id}`)).status).toBe(200)
  })

  it('refuses a design opened under another brand of the same workspace', async () => {
    const design = DesignSummary.parse((await call('a', 'POST', `/brands/${brand.id}/designs`, { name: 'Mine' })).json)
    const { status, json } = await call('a', 'GET', `/brands/${sibling.id}/designs/${design.id}`)
    expect(status).toBe(404)
    expect(ApiError.parse(json).error).toBe('No such design')
  })

  it('refuses a bad body and a design that is not valid, saying why', async () => {
    const empty = await call('a', 'POST', `/brands/${brand.id}/designs`, { name: '  ' })
    expect(empty.status).toBe(400)
    expect(ApiError.parse(empty.json).error).toMatch(/^name:/)
    const broken = await call('a', 'POST', `/brands/${brand.id}/designs`, { name: 'Broken', content: { meta: {} } })
    expect(broken.status).toBe(400)
    expect(ApiError.parse(broken.json).error).toMatch(/^The design is not valid: /)
    const notJson = await app.request(`/brands/${brand.id}/designs`, { method: 'POST', headers: { 'x-test-session': 'a' }, body: '{' })
    expect(notJson.status).toBe(400)
  })
})

describe('sync tokens', () => {
  it('issues a token for a design the session may open, good for that design only', async () => {
    const design = DesignSummary.parse((await call('a', 'POST', `/brands/${brand.id}/designs`, { name: 'Tokened' })).json)
    const { status, json } = await call('a', 'POST', `/brands/${brand.id}/designs/${design.id}/sync-token`)
    expect(status).toBe(200)
    const { token, expiresAt } = SyncToken.parse(json)
    expect(Date.parse(expiresAt)).toBeGreaterThan(Date.now())
    expect(verifySyncToken(syncSecret, token, design.id)).toMatchObject({ ok: true, payload: { designId: design.id, workspaceId: workspace.id, userId: 'user-a' } })
    expect(verifySyncToken(syncSecret, token, 'another-design')).toEqual({ ok: false, reason: 'token for another design' })
  })

  it('issues none without a session, for another workspace, or under another brand', async () => {
    const mine = DesignSummary.parse((await call('a', 'POST', `/brands/${brand.id}/designs`, { name: 'Mine' })).json)
    expect((await call(null, 'POST', `/brands/${brand.id}/designs/${mine.id}/sync-token`)).status).toBe(401)
    expect((await call('b', 'POST', `/brands/${brand.id}/designs/${mine.id}/sync-token`)).status).toBe(404)
    expect((await call('a', 'POST', `/brands/${sibling.id}/designs/${mine.id}/sync-token`)).status).toBe(404)
  })
})

describe('image uploads', () => {
  const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')

  /** Starts an upload, PUTs the bytes when asked to, and records the asset. */
  async function upload(as: string, brandId: string, bytes: Uint8Array) {
    const ticket = UploadTicket.parse((await call(as, 'POST', `/brands/${brandId}/assets/uploads`, { sha256: sha256(bytes), byteSize: bytes.length, contentType: 'image/png' })).json)
    if (ticket.asset) return { asset: ticket.asset, uploaded: false }
    const put = await fetch(ticket.upload.url, { method: 'PUT', body: bytes, headers: ticket.upload.headers })
    expect(put.status).toBe(200)
    const recorded = await call(as, 'POST', `/brands/${brandId}/assets`, { sha256: sha256(bytes) })
    expect(recorded.status).toBe(201)
    return { asset: AssetSummary.parse(recorded.json), uploaded: true }
  }

  it('uploads, records and fetches an image by asset id', async () => {
    const bytes = png(3, 2, run)
    const { asset, uploaded } = await upload('a', brand.id, bytes)
    expect(uploaded).toBe(true)
    expect(asset).toMatchObject({ brandId: brand.id, sha256: sha256(bytes), contentType: 'image/png', byteSize: bytes.length, width: 3, height: 2 })
    const link = AssetLink.parse((await call('a', 'GET', `/brands/${brand.id}/assets/${asset.id}`)).json)
    expect(link.asset).toEqual(asset)
    expect(new Uint8Array(await (await fetch(link.url)).arrayBuffer())).toEqual(bytes)
    const listed = AssetSummary.array().parse((await call('a', 'GET', `/brands/${brand.id}/assets`)).json)
    expect(listed.map((a) => a.id)).toContain(asset.id)
  })

  it('stores the same file once: a second upload gets the asset without sending bytes', async () => {
    const bytes = png(4, 4, `${run}-twice`)
    const first = await upload('a', brand.id, bytes)
    const second = await upload('a', brand.id, bytes)
    expect(second).toEqual({ asset: first.asset, uploaded: false })
    // Another brand of the workspace gets its own asset over the same stored original.
    const sibling$ = await upload('a', sibling.id, bytes)
    expect(sibling$.uploaded).toBe(false)
    expect(sibling$.asset.id).not.toBe(first.asset.id)
  })

  it('keeps assets to their workspace and brand', async () => {
    const { asset } = await upload('a', brand.id, png(5, 5, `${run}-scoped`))
    expect((await call('b', 'GET', `/brands/${brand.id}/assets/${asset.id}`)).status).toBe(404)
    expect((await call('a', 'GET', `/brands/${sibling.id}/assets/${asset.id}`)).status).toBe(404)
    expect((await call('b', 'GET', `/brands/${brand.id}/assets`)).status).toBe(404)
    expect((await call('b', 'POST', `/brands/${brand.id}/assets/uploads`, { sha256: asset.sha256, byteSize: 1, contentType: 'image/png' })).status).toBe(404)
    expect((await call(null, 'GET', `/brands/${brand.id}/assets/${asset.id}`)).status).toBe(401)
  })

  it('refuses to record bytes that were never uploaded, do not match, or are not an image', async () => {
    const missing = await call('a', 'POST', `/brands/${brand.id}/assets`, { sha256: 'f'.repeat(64) })
    expect(missing).toEqual({ status: 400, json: { error: 'Nothing was uploaded for that SHA-256' } })

    const text = new TextEncoder().encode(`not an image ${run}`)
    const ticket = UploadTicket.parse((await call('a', 'POST', `/brands/${brand.id}/assets/uploads`, { sha256: sha256(text), byteSize: text.length, contentType: 'image/png' })).json)
    if (!ticket.upload) throw new Error('expected an upload URL')
    await fetch(ticket.upload.url, { method: 'PUT', body: text, headers: ticket.upload.headers })
    expect((await call('a', 'POST', `/brands/${brand.id}/assets`, { sha256: sha256(text) })).json).toEqual({ error: 'The upload is not a PNG, JPEG or WebP image' })

    // Bytes put under someone else's hash.
    const real = png(2, 2, `${run}-real`)
    const claimed = sha256(png(2, 2, `${run}-claimed`))
    const lie = UploadTicket.parse((await call('a', 'POST', `/brands/${brand.id}/assets/uploads`, { sha256: claimed, byteSize: real.length, contentType: 'image/png' })).json)
    // (Same size as the claimed bytes, so storage takes it; the API's hash check is what refuses it.)
    if (!lie.upload) throw new Error('expected an upload URL')
    await fetch(lie.upload.url, { method: 'PUT', body: real, headers: lie.upload.headers })
    expect((await call('a', 'POST', `/brands/${brand.id}/assets`, { sha256: claimed })).json).toEqual({ error: 'The uploaded bytes do not match their SHA-256' })
    // The bad bytes are gone, so the real owner of that hash can still upload it.
    const honest = await upload('a', brand.id, png(2, 2, `${run}-claimed`))
    expect(honest).toMatchObject({ uploaded: true, asset: { sha256: claimed } })
  })

  it('refuses uploads that are too big or not an image type', async () => {
    expect((await call('a', 'POST', `/brands/${brand.id}/assets/uploads`, { sha256: 'a'.repeat(64), byteSize: 31 * 1024 * 1024, contentType: 'image/png' })).status).toBe(400)
    expect((await call('a', 'POST', `/brands/${brand.id}/assets/uploads`, { sha256: 'a'.repeat(64), byteSize: 10, contentType: 'image/svg+xml' })).status).toBe(400)
  })

  it('signs an upload URL for its key, content type and size only', async () => {
    const bytes = png(6, 6, `${run}-signed`)
    const ticket = UploadTicket.parse((await call('a', 'POST', `/brands/${brand.id}/assets/uploads`, { sha256: sha256(bytes), byteSize: bytes.length, contentType: 'image/png' })).json)
    if (!ticket.upload) throw new Error('expected an upload URL')
    expect((await fetch(ticket.upload.url, { method: 'PUT', body: bytes, headers: { 'content-type': 'image/jpeg' } })).status).toBe(403)
    expect((await fetch(ticket.upload.url, { method: 'PUT', body: new Uint8Array([...bytes, 0]), headers: ticket.upload.headers })).status).toBe(403)
    const elsewhere = new URL(ticket.upload.url)
    elsewhere.pathname = elsewhere.pathname.replace(/[^/]+$/, 'b'.repeat(64))
    expect((await fetch(elsewhere, { method: 'PUT', body: bytes, headers: ticket.upload.headers })).status).toBe(403)
  })
})

// Recording a font draws its preview with CanvasKit, which takes seconds on a busy two-core CI runner.
describe('fonts', { timeout: 30_000 }, () => {
  const fontFile = (file: string) => new Uint8Array(readFileSync(join(FONT_FILES_DIR, file)))
  const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')
  const regular = fontFile('NotoSans-Regular.ttf')
  const bold = fontFile('NotoSans-Bold.ttf')

  /** Google Fonts as the importer sees it: a stylesheet naming two TrueType files, and the files. */
  const fakeGoogle = (async (input: string | URL | Request) => {
    const url = String(input)
    if (url.startsWith('https://fonts.googleapis.com/css2?family=Test+Sans+')) {
      const face = (weight: number) => `@font-face {\n  font-family: '${googleFamily.family}';\n  font-style: normal;\n  font-weight: ${weight};\n  src: url(https://fonts.gstatic.com/s/test/v1/w${weight}.ttf) format('truetype');\n}\n`
      return new Response(face(400) + face(700))
    }
    if (url === 'https://fonts.gstatic.com/s/test/v1/w400.ttf') return new Response(regular)
    if (url === 'https://fonts.gstatic.com/s/test/v1/w700.ttf') return new Response(bold)
    return new Response('not found', { status: 404 })
  }) as typeof fetch

  async function upload(as: string, brandId: string, bytes: Uint8Array) {
    const ticket = FontUploadTicket.parse((await call(as, 'POST', `/brands/${brandId}/fonts/uploads`, { sha256: sha256(bytes), byteSize: bytes.length, contentType: 'font/ttf' })).json)
    if (ticket.face) return { face: ticket.face, uploaded: false }
    expect((await fetch(ticket.upload.url, { method: 'PUT', body: bytes, headers: ticket.upload.headers })).status).toBe(200)
    const recorded = await call(as, 'POST', `/brands/${brandId}/fonts`, { sha256: sha256(bytes) })
    expect(recorded.status).toBe(201)
    return { face: FontFace.parse(recorded.json), uploaded: true }
  }

  it('copies a Google family into our storage once, and every brand lists it', async () => {
    expect(await importGoogleFamily(db, storage, googleFamily, fakeGoogle)).toBe(2)
    expect(await importGoogleFamily(db, storage, googleFamily, fakeGoogle)).toBe(0)
    for (const [as, brandId] of [['a', brand.id], ['b', otherBrand.id]] as const) {
      const catalog = FontFamily.array().parse((await call(as, 'GET', `/brands/${brandId}/fonts`)).json)
      expect(catalog.find((f) => f.family === googleFamily.family)).toMatchObject({
        source: 'google', category: 'sans-serif',
        faces: [{ weight: 400, style: 'normal', source: 'google', byteSize: regular.length }, { weight: 700, style: 'normal', source: 'google', byteSize: bold.length }],
      })
    }
  })

  it('uploads a font for a brand, named by its own tables, with a preview, and keeps it to that brand', async () => {
    const { face, uploaded } = await upload('a', brand.id, bold)
    expect(uploaded).toBe(true)
    expect(face).toMatchObject({ family: 'Noto Sans', weight: 700, style: 'normal', source: 'upload', byteSize: bold.length })
    expect(await upload('a', brand.id, bold)).toEqual({ face, uploaded: false })

    const link = FontLink.parse((await call('a', 'GET', `/brands/${brand.id}/fonts/faces/${face.id}`)).json)
    expect(new Uint8Array(await (await fetch(link.url)).arrayBuffer())).toEqual(bold)
    const preview = new Uint8Array(await (await fetch(link.previewUrl)).arrayBuffer())
    expect([...preview.subarray(1, 4)]).toEqual([...new TextEncoder().encode('PNG')])

    const mine = FontFamily.array().parse((await call('a', 'GET', `/brands/${brand.id}/fonts`)).json)
    expect(mine.find((f) => f.family === 'Noto Sans')?.faces.map((f) => f.id)).toEqual([face.id])
    const theirs = FontFamily.array().parse((await call('a', 'GET', `/brands/${sibling.id}/fonts`)).json)
    expect(theirs.find((f) => f.family === 'Noto Sans')).toBeUndefined()
    expect((await call('a', 'GET', `/brands/${sibling.id}/fonts/faces/${face.id}`)).status).toBe(404)
    expect((await call('b', 'GET', `/brands/${brand.id}/fonts`)).status).toBe(404)
    expect((await call(null, 'GET', `/brands/${brand.id}/fonts`)).status).toBe(401)
  })

  it('gives Node the same bytes for the families a design names, uploads and Google alike', async () => {
    await upload('a', brand.id, bold)
    const files = await fontFiles(db, storage, workspace.id, brand.id, ['Noto Sans', googleFamily.family, 'Not A Font'])
    const byFamily = (family: string) => files.filter((f) => f.family === family).map((f) => sha256(f.bytes)).sort()
    expect(byFamily('Noto Sans')).toEqual([sha256(bold)])
    expect(byFamily(googleFamily.family)).toEqual([sha256(regular), sha256(bold)].sort())
    expect(files).toHaveLength(3)
    // Another brand has no upload of that family.
    expect(await fontFiles(db, storage, workspace.id, sibling.id, ['Noto Sans'])).toEqual([])
  })

  it('refuses a file that is not a font, and an upload of the wrong type', async () => {
    const text = new TextEncoder().encode(`not a font ${run}`)
    const ticket = FontUploadTicket.parse((await call('a', 'POST', `/brands/${brand.id}/fonts/uploads`, { sha256: sha256(text), byteSize: text.length, contentType: 'font/ttf' })).json)
    if (!ticket.upload) throw new Error('expected an upload URL')
    await fetch(ticket.upload.url, { method: 'PUT', body: text, headers: ticket.upload.headers })
    expect((await call('a', 'POST', `/brands/${brand.id}/fonts`, { sha256: sha256(text) })).json).toEqual({ error: 'The upload is not a TrueType or OpenType font' })
    expect((await call('a', 'POST', `/brands/${brand.id}/fonts`, { sha256: 'e'.repeat(64) })).json).toEqual({ error: 'Nothing was uploaded for that SHA-256' })
    expect((await call('a', 'POST', `/brands/${brand.id}/fonts/uploads`, { sha256: 'a'.repeat(64), byteSize: 10, contentType: 'font/woff2' })).status).toBe(400)
  })
})
