// The API seam, against Postgres from Docker Compose (`docker compose up -d --wait postgres`).
import { createHash, randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { brands, fontFaces, migrateDatabase, openDatabase, workspaces, readDesignState, writeDesignState } from '@razzlr/db'
import { loadDesign, readDesign } from '@razzlr/doc'
import { ApiError, AssetLink, AssetSummary, BrandKit, brandVariables, SignedLink, BrandSummary, DesignSummary, DesignThumbnail, FontFace, FontFamily, FontLink, FontUploadTicket, SyncToken, UploadTicket, WorkspaceSummary } from '@razzlr/schema'
import { openStorage, storageSettings } from '@razzlr/storage'
import { verifySyncToken } from '@razzlr/sync-token'
import { FONT_FILES_DIR } from '@razzlr/fonts/node'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { eq } from 'drizzle-orm'
import { createApp } from './app.ts'
import { fontFiles, importGoogleFamily } from './fonts.ts'
import { readImageHeader } from './images.ts'
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

describe('brand kits (#53)', () => {
  const kit = {
    colors: [{ token: 'primary', name: 'Harbour red', value: '#E0262BFF' }, { token: 'ink', name: 'Ink', value: '#14213DFF' }],
    fonts: [{ token: 'heading', name: 'Heading', family: 'Playfair Display' }],
    logoAssetId: null,
    voice: 'Warm, short, no jargon.',
  }

  it('starts empty, saves the whole kit and gives its tokens as variables', async () => {
    expect((await call('a', 'GET', `/brands/${sibling.id}/kit`)).json).toEqual({ colors: [], fonts: [], logoAssetId: null, voice: '' })
    const saved = await call('a', 'PUT', `/brands/${brand.id}/kit`, kit)
    expect(saved).toEqual({ status: 200, json: kit })
    const changed = { ...kit, colors: [{ ...kit.colors[0], value: '#1F9D55FF' }] }
    await call('a', 'PUT', `/brands/${brand.id}/kit`, changed)
    const read = BrandKit.parse((await call('a', 'GET', `/brands/${brand.id}/kit`)).json)
    expect(brandVariables(read)).toEqual({ 'brand:primary': '#1F9D55FF', 'brand:heading': 'Playfair Display' })
  })

  it('takes a logo only from the brand\'s own assets', async () => {
    const sha = createHash('sha256')
    const bytes = png(12, 12, `${run}-logo`)
    const ticket = UploadTicket.parse((await call('a', 'POST', `/brands/${brand.id}/assets/uploads`, { sha256: sha.update(bytes).digest('hex'), byteSize: bytes.length, contentType: 'image/png' })).json)
    if (ticket.upload) await fetch(ticket.upload.url, { method: 'PUT', body: bytes, headers: ticket.upload.headers })
    const logo = ticket.asset ?? AssetSummary.parse((await call('a', 'POST', `/brands/${brand.id}/assets`, { sha256: createHash('sha256').update(bytes).digest('hex') })).json)
    expect((await call('a', 'PUT', `/brands/${brand.id}/kit`, { ...kit, logoAssetId: logo.id })).json).toMatchObject({ logoAssetId: logo.id })
    expect((await call('a', 'PUT', `/brands/${sibling.id}/kit`, { ...kit, logoAssetId: logo.id })).json).toEqual({ error: 'The logo is not an asset of this brand' })
  })

  it('refuses a token used twice or badly named, and keeps kits to their workspace', async () => {
    expect((await call('a', 'PUT', `/brands/${brand.id}/kit`, { ...kit, fonts: [{ token: 'primary', name: 'Body', family: 'Inter' }] })).status).toBe(400)
    expect((await call('a', 'PUT', `/brands/${brand.id}/kit`, { ...kit, colors: [{ token: 'Primary', name: 'P', value: '#000000FF' }] })).status).toBe(400)
    expect((await call('a', 'PUT', `/brands/${brand.id}/kit`, { ...kit, colors: [{ token: 'p', name: 'P', value: 'red' }] })).status).toBe(400)
    expect((await call('b', 'GET', `/brands/${brand.id}/kit`)).status).toBe(404)
    expect((await call('b', 'PUT', `/brands/${brand.id}/kit`, kit)).status).toBe(404)
  })
})

// Recording an image makes its thumbnail with CanvasKit, which takes seconds to load on a busy CI runner.
describe('image uploads', { timeout: 30_000 }, () => {
  const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')

  /** Starts an upload, PUTs the bytes when asked to, and records the asset. */
  async function upload(as: string, brandId: string, bytes: Uint8Array, name?: string) {
    const ticket = UploadTicket.parse((await call(as, 'POST', `/brands/${brandId}/assets/uploads`, { sha256: sha256(bytes), byteSize: bytes.length, contentType: 'image/png' })).json)
    if (ticket.asset) return { asset: ticket.asset, uploaded: false }
    const put = await fetch(ticket.upload.url, { method: 'PUT', body: bytes, headers: ticket.upload.headers })
    expect(put.status).toBe(200)
    const recorded = await call(as, 'POST', `/brands/${brandId}/assets`, { sha256: sha256(bytes), ...(name ? { name } : {}) })
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

  it('names an asset as uploaded, renames and tags it, and finds it by either (#52)', async () => {
    const { asset } = await upload('a', brand.id, png(7, 3, `${run}-named`), `Summer sale ${run}.png`)
    expect(asset).toMatchObject({ name: `Summer sale ${run}.png`, tags: [] })
    const tagged = await call('a', 'PATCH', `/brands/${brand.id}/assets/${asset.id}`, { tags: ['Beach ', 'hero', 'beach'] })
    expect(tagged.status).toBe(200)
    expect(AssetSummary.parse(tagged.json).tags).toEqual(['beach', 'hero'])
    const { asset: plain } = await upload('a', brand.id, png(7, 4, `${run}-plain`), `Winter ${run}.png`)

    const search = async (q: string) => AssetSummary.array().parse((await call('a', 'GET', `/brands/${brand.id}/assets?q=${encodeURIComponent(q)}`)).json).map((a) => a.id)
    // A word finds names that have it anywhere and tags that start with it, ignoring case.
    expect(await search(`SALE ${run}`)).toEqual([asset.id])
    expect(await search(`bea ${run}`)).toEqual([asset.id])
    expect(await search('each')).not.toContain(asset.id)
    // Every word has to match; newest first.
    expect(await search(`${run}.png`)).toEqual([plain.id, asset.id])
    expect(await search(`winter hero ${run}`)).toEqual([])
    // LIKE's wildcards are only letters here.
    expect(await search(`%${run}`)).toEqual([])

    const renamed = AssetSummary.parse((await call('a', 'PATCH', `/brands/${brand.id}/assets/${plain.id}`, { name: `  Winter hero ${run} ` })).json)
    expect(renamed.name).toBe(`Winter hero ${run}`)
    expect(await search(`winter hero ${run}`)).toEqual([plain.id])
  })

  it('keeps names, tags and search to the brand', async () => {
    const { asset } = await upload('a', brand.id, png(8, 3, `${run}-walled`), `Walled ${run}`)
    await call('a', 'PATCH', `/brands/${brand.id}/assets/${asset.id}`, { tags: [`walled-${run}`] })
    // The sibling brand uploads the same bytes and gets its own, unnamed and untagged asset.
    const { asset: theirs } = await upload('a', sibling.id, png(8, 3, `${run}-walled`))
    expect(theirs).toMatchObject({ name: '', tags: [] })
    expect((await call('a', 'GET', `/brands/${sibling.id}/assets?q=walled-${run}`)).json).toEqual([])
    expect((await call('a', 'PATCH', `/brands/${sibling.id}/assets/${asset.id}`, { name: 'Mine now' })).status).toBe(404)
    expect((await call('b', 'PATCH', `/brands/${brand.id}/assets/${asset.id}`, { name: 'Mine now' })).status).toBe(404)
  })

  it('refuses an empty name, too many tags or nothing to change', async () => {
    const { asset } = await upload('a', brand.id, png(9, 3, `${run}-refused`))
    expect((await call('a', 'PATCH', `/brands/${brand.id}/assets/${asset.id}`, { name: '   ' })).status).toBe(400)
    expect((await call('a', 'PATCH', `/brands/${brand.id}/assets/${asset.id}`, { tags: Array.from({ length: 21 }, (_, i) => `t${i}`) })).status).toBe(400)
    expect((await call('a', 'PATCH', `/brands/${brand.id}/assets/${asset.id}`, {})).status).toBe(400)
    expect((await call('a', 'GET', `/brands/${brand.id}/assets?q=${'x'.repeat(201)}`)).status).toBe(400)
  })

  it('makes a thumbnail no larger than 320 pixels a side, for the brand only', async () => {
    const { asset } = await upload('a', brand.id, png(960, 600, `${run}-big`))
    const link = SignedLink.parse((await call('a', 'GET', `/brands/${brand.id}/assets/${asset.id}/thumbnail`)).json)
    const thumbnail = new Uint8Array(await (await fetch(link.url)).arrayBuffer())
    expect(readImageHeader(thumbnail)).toEqual({ contentType: 'image/png', width: 320, height: 200 })
    const { asset: small } = await upload('a', brand.id, png(40, 30, `${run}-small`))
    const smallLink = SignedLink.parse((await call('a', 'GET', `/brands/${brand.id}/assets/${small.id}/thumbnail`)).json)
    expect(readImageHeader(new Uint8Array(await (await fetch(smallLink.url)).arrayBuffer()))).toMatchObject({ width: 40, height: 30 })
    expect((await call('a', 'GET', `/brands/${sibling.id}/assets/${asset.id}/thumbnail`)).status).toBe(404)
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
// A design's picture for the home's bento (#84), drawn with CanvasKit like an export.
describe('design thumbnails', { timeout: 30_000 }, () => {
  const story = (color: string) => ({
    meta: { schemaVersion: 2, designId: 'ignored', name: 'Story', kind: 'single', primaryFormatId: 'st' },
    formats: { sq: { name: 'Square', width: 1080, height: 1080, order: 'a0' }, st: { name: 'Story', width: 1080, height: 1920, order: 'a1' } },
    pages: { p1: { name: 'Page 1', order: 'a0', fills: [{ type: 'solid', color }] } },
    nodes: {},
    overrides: {},
  })
  const keyOf = (url: string) => new URL(url).pathname

  it('draws the first page in the primary format, at most 640 a side, once per version', async () => {
    const { json } = await call('a', 'POST', `/brands/${brand.id}/designs`, { name: 'Story', content: story('#FF48B0FF') })
    const design = DesignSummary.parse(json)
    const first = DesignThumbnail.parse((await call('a', 'GET', `/brands/${brand.id}/designs/${design.id}/thumbnail`)).json)
    // The format's own size, so a tile can be tall before the picture loads.
    expect([first.width, first.height]).toEqual([1080, 1920])
    const bytes = new Uint8Array(await (await fetch(first.url)).arrayBuffer())
    expect(readImageHeader(bytes)).toEqual({ contentType: 'image/png', width: 360, height: 640 })
    // Asked again, the same stored picture.
    const again = DesignThumbnail.parse((await call('a', 'GET', `/brands/${brand.id}/designs/${design.id}/thumbnail`)).json)
    expect(keyOf(again.url)).toBe(keyOf(first.url))
    // Once the design changes, a new one.
    const blue = story('#3D6BFFFF')
    await writeDesignState(db, design.id, Y.encodeStateAsUpdate(loadDesign({ ...blue, meta: { ...blue.meta, designId: design.id } } as never)))
    const changed = DesignThumbnail.parse((await call('a', 'GET', `/brands/${brand.id}/designs/${design.id}/thumbnail`)).json)
    expect(keyOf(changed.url)).not.toBe(keyOf(first.url))
  })

  it('keeps a design\'s picture to its brand and workspace', async () => {
    const design = DesignSummary.parse((await call('a', 'POST', `/brands/${brand.id}/designs`, { name: 'Mine' })).json)
    expect((await call('a', 'GET', `/brands/${sibling.id}/designs/${design.id}/thumbnail`)).status).toBe(404)
    expect((await call('b', 'GET', `/brands/${brand.id}/designs/${design.id}/thumbnail`)).status).toBe(404)
  })
})

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
