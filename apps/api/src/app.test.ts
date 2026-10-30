// The API seam, against Postgres from Docker Compose (`docker compose up -d --wait postgres`).
import { createHash, randomUUID } from 'node:crypto'
import { clients, migrateDatabase, openDatabase, orgs, readDesignState } from '@razzlr/db'
import { readDesign } from '@razzlr/doc'
import { ApiError, AssetLink, AssetSummary, ClientSummary, DesignSummary, SyncToken, UploadTicket } from '@razzlr/schema'
import { openStorage, storageSettings } from '@razzlr/storage'
import { verifySyncToken } from '@razzlr/sync-token'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { createApp } from './app.ts'
import { png } from './images.test.ts'
import type { Session } from './session.ts'

const DATABASE_URL = process.env.DATABASE_URL ?? 'postgres://razzlr:razzlr-local@127.0.0.1:55432/razzlr'
const { db, close } = openDatabase(DATABASE_URL)

// Two orgs with a client each, fresh for every run so runs never see each other's rows.
const run = randomUUID().slice(0, 8)
const org = { id: `org-a-${run}`, name: 'Agency A' }
const other = { id: `org-b-${run}`, name: 'Agency B' }
const client = { id: `client-a-${run}`, orgId: org.id, name: 'Client A' }
const sibling = { id: `client-a2-${run}`, orgId: org.id, name: 'Client A2' }
const otherClient = { id: `client-b-${run}`, orgId: other.id, name: 'Client B' }

const sessions: Record<string, Session> = {
  a: { userId: 'user-a', orgId: org.id },
  b: { userId: 'user-b', orgId: other.id },
}
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
  await db.insert(orgs).values([org, other])
  await db.insert(clients).values([client, sibling, otherClient])
})
afterAll(() => close())

describe('designs per client', () => {
  it('creates, lists and opens a design', async () => {
    const created = await call('a', 'POST', `/clients/${client.id}/designs`, { name: 'Spring sale' })
    expect(created.status).toBe(201)
    const design = DesignSummary.parse(created.json)
    expect(design).toMatchObject({ clientId: client.id, name: 'Spring sale', kind: 'single' })

    const listed = await call('a', 'GET', `/clients/${client.id}/designs`)
    expect(DesignSummary.array().parse(listed.json).map((d) => d.id)).toEqual([design.id])

    const opened = await call('a', 'GET', `/clients/${client.id}/designs/${design.id}`)
    expect(opened).toEqual({ status: 200, json: design })
  })

  it('starts a design with one blank page, already in the store for the sync server', async () => {
    const { json } = await call('a', 'POST', `/clients/${client.id}/designs`, { name: 'Blank' })
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
      meta: { schemaVersion: 1, designId: 'ignored', name: 'Ignored', kind: 'carousel', primaryFormatId: 'pt' },
      formats: { pt: { name: 'Portrait', width: 1080, height: 1350, order: 'a0' } },
      pages: { p1: { name: 'Card 1', order: 'a0' }, p2: { name: 'Card 2', order: 'a1' } },
      nodes: {},
      overrides: {},
    }
    const { status, json } = await call('a', 'POST', `/clients/${client.id}/designs`, { name: 'Carousel', content })
    expect(status).toBe(201)
    const { id, kind } = DesignSummary.parse(json)
    expect(kind).toBe('carousel')
    const doc = new Y.Doc()
    Y.applyUpdate(doc, await readDesignState(db, id) ?? new Uint8Array())
    expect(readDesign(doc).meta).toMatchObject({ designId: id, name: 'Carousel' })
    expect(Object.keys(readDesign(doc).pages)).toEqual(['p1', 'p2'])
  })

  it('lists only the asked client’s designs, newest change first', async () => {
    const first = DesignSummary.parse((await call('a', 'POST', `/clients/${sibling.id}/designs`, { name: 'First' })).json)
    const second = DesignSummary.parse((await call('a', 'POST', `/clients/${sibling.id}/designs`, { name: 'Second' })).json)
    const { json } = await call('a', 'GET', `/clients/${sibling.id}/designs`)
    expect(DesignSummary.array().parse(json).map((d) => d.id)).toEqual([second.id, first.id])
  })

  it('lists and creates clients within the org only', async () => {
    const created = await call('a', 'POST', '/clients', { name: 'New client' })
    expect(created.status).toBe(201)
    const { json } = await call('a', 'GET', '/clients')
    expect(ClientSummary.array().parse(json).map((c) => c.name)).toEqual(['Client A', 'Client A2', 'New client'])
    const theirs = await call('b', 'GET', '/clients')
    expect(ClientSummary.array().parse(theirs.json).map((c) => c.id)).toEqual([otherClient.id])
  })
})

describe('refusals', () => {
  it('refuses every route without a session', async () => {
    for (const [method, path] of [['GET', '/clients'], ['POST', '/clients'], ['GET', `/clients/${client.id}/designs`], ['POST', `/clients/${client.id}/designs`]] as const) {
      const response = await call(null, method, path, method === 'POST' ? { name: 'x' } : undefined)
      expect(response, `${method} ${path}`).toEqual({ status: 401, json: { error: 'Sign in first' } })
    }
  })

  it('answers another org’s client and design as if they did not exist', async () => {
    const theirs = DesignSummary.parse((await call('b', 'POST', `/clients/${otherClient.id}/designs`, { name: 'Theirs' })).json)
    expect((await call('a', 'GET', `/clients/${otherClient.id}/designs`)).status).toBe(404)
    expect((await call('a', 'GET', `/clients/${otherClient.id}/designs/${theirs.id}`)).status).toBe(404)
    expect((await call('a', 'POST', `/clients/${otherClient.id}/designs`, { name: 'Sneaky' })).status).toBe(404)
    // The owner still sees it.
    expect((await call('b', 'GET', `/clients/${otherClient.id}/designs/${theirs.id}`)).status).toBe(200)
  })

  it('refuses a design opened under another client of the same org', async () => {
    const design = DesignSummary.parse((await call('a', 'POST', `/clients/${client.id}/designs`, { name: 'Mine' })).json)
    const { status, json } = await call('a', 'GET', `/clients/${sibling.id}/designs/${design.id}`)
    expect(status).toBe(404)
    expect(ApiError.parse(json).error).toBe('No such design')
  })

  it('refuses a bad body and a design that is not valid, saying why', async () => {
    const empty = await call('a', 'POST', `/clients/${client.id}/designs`, { name: '  ' })
    expect(empty.status).toBe(400)
    expect(ApiError.parse(empty.json).error).toMatch(/^name:/)
    const broken = await call('a', 'POST', `/clients/${client.id}/designs`, { name: 'Broken', content: { meta: {} } })
    expect(broken.status).toBe(400)
    expect(ApiError.parse(broken.json).error).toMatch(/^The design is not valid: /)
    const notJson = await app.request(`/clients/${client.id}/designs`, { method: 'POST', headers: { 'x-test-session': 'a' }, body: '{' })
    expect(notJson.status).toBe(400)
  })
})

describe('sync tokens', () => {
  it('issues a token for a design the session may open, good for that design only', async () => {
    const design = DesignSummary.parse((await call('a', 'POST', `/clients/${client.id}/designs`, { name: 'Tokened' })).json)
    const { status, json } = await call('a', 'POST', `/clients/${client.id}/designs/${design.id}/sync-token`)
    expect(status).toBe(200)
    const { token, expiresAt } = SyncToken.parse(json)
    expect(Date.parse(expiresAt)).toBeGreaterThan(Date.now())
    expect(verifySyncToken(syncSecret, token, design.id)).toMatchObject({ ok: true, payload: { designId: design.id, orgId: org.id, userId: 'user-a' } })
    expect(verifySyncToken(syncSecret, token, 'another-design')).toEqual({ ok: false, reason: 'token for another design' })
  })

  it('issues none without a session, for another org, or under another client', async () => {
    const mine = DesignSummary.parse((await call('a', 'POST', `/clients/${client.id}/designs`, { name: 'Mine' })).json)
    expect((await call(null, 'POST', `/clients/${client.id}/designs/${mine.id}/sync-token`)).status).toBe(401)
    expect((await call('b', 'POST', `/clients/${client.id}/designs/${mine.id}/sync-token`)).status).toBe(404)
    expect((await call('a', 'POST', `/clients/${sibling.id}/designs/${mine.id}/sync-token`)).status).toBe(404)
  })
})

describe('image uploads', () => {
  const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')

  /** Starts an upload, PUTs the bytes when asked to, and records the asset. */
  async function upload(as: string, clientId: string, bytes: Uint8Array) {
    const ticket = UploadTicket.parse((await call(as, 'POST', `/clients/${clientId}/assets/uploads`, { sha256: sha256(bytes), byteSize: bytes.length, contentType: 'image/png' })).json)
    if (ticket.asset) return { asset: ticket.asset, uploaded: false }
    const put = await fetch(ticket.upload.url, { method: 'PUT', body: bytes, headers: ticket.upload.headers })
    expect(put.status).toBe(200)
    const recorded = await call(as, 'POST', `/clients/${clientId}/assets`, { sha256: sha256(bytes) })
    expect(recorded.status).toBe(201)
    return { asset: AssetSummary.parse(recorded.json), uploaded: true }
  }

  it('uploads, records and fetches an image by asset id', async () => {
    const bytes = png(3, 2, run)
    const { asset, uploaded } = await upload('a', client.id, bytes)
    expect(uploaded).toBe(true)
    expect(asset).toMatchObject({ clientId: client.id, sha256: sha256(bytes), contentType: 'image/png', byteSize: bytes.length, width: 3, height: 2 })
    const link = AssetLink.parse((await call('a', 'GET', `/clients/${client.id}/assets/${asset.id}`)).json)
    expect(link.asset).toEqual(asset)
    expect(new Uint8Array(await (await fetch(link.url)).arrayBuffer())).toEqual(bytes)
    const listed = AssetSummary.array().parse((await call('a', 'GET', `/clients/${client.id}/assets`)).json)
    expect(listed.map((a) => a.id)).toContain(asset.id)
  })

  it('stores the same file once: a second upload gets the asset without sending bytes', async () => {
    const bytes = png(4, 4, `${run}-twice`)
    const first = await upload('a', client.id, bytes)
    const second = await upload('a', client.id, bytes)
    expect(second).toEqual({ asset: first.asset, uploaded: false })
    // Another client of the org gets its own asset over the same stored original.
    const sibling$ = await upload('a', sibling.id, bytes)
    expect(sibling$.uploaded).toBe(false)
    expect(sibling$.asset.id).not.toBe(first.asset.id)
  })

  it('keeps assets to their org and client', async () => {
    const { asset } = await upload('a', client.id, png(5, 5, `${run}-scoped`))
    expect((await call('b', 'GET', `/clients/${client.id}/assets/${asset.id}`)).status).toBe(404)
    expect((await call('a', 'GET', `/clients/${sibling.id}/assets/${asset.id}`)).status).toBe(404)
    expect((await call('b', 'GET', `/clients/${client.id}/assets`)).status).toBe(404)
    expect((await call('b', 'POST', `/clients/${client.id}/assets/uploads`, { sha256: asset.sha256, byteSize: 1, contentType: 'image/png' })).status).toBe(404)
    expect((await call(null, 'GET', `/clients/${client.id}/assets/${asset.id}`)).status).toBe(401)
  })

  it('refuses to record bytes that were never uploaded, do not match, or are not an image', async () => {
    const missing = await call('a', 'POST', `/clients/${client.id}/assets`, { sha256: 'f'.repeat(64) })
    expect(missing).toEqual({ status: 400, json: { error: 'Nothing was uploaded for that SHA-256' } })

    const text = new TextEncoder().encode(`not an image ${run}`)
    const ticket = UploadTicket.parse((await call('a', 'POST', `/clients/${client.id}/assets/uploads`, { sha256: sha256(text), byteSize: text.length, contentType: 'image/png' })).json)
    if (!ticket.upload) throw new Error('expected an upload URL')
    await fetch(ticket.upload.url, { method: 'PUT', body: text, headers: ticket.upload.headers })
    expect((await call('a', 'POST', `/clients/${client.id}/assets`, { sha256: sha256(text) })).json).toEqual({ error: 'The upload is not a PNG, JPEG or WebP image' })

    // Bytes put under someone else's hash.
    const real = png(2, 2, `${run}-real`)
    const claimed = sha256(png(2, 2, `${run}-claimed`))
    const lie = UploadTicket.parse((await call('a', 'POST', `/clients/${client.id}/assets/uploads`, { sha256: claimed, byteSize: real.length, contentType: 'image/png' })).json)
    // (Same size as the claimed bytes, so storage takes it; the API's hash check is what refuses it.)
    if (!lie.upload) throw new Error('expected an upload URL')
    await fetch(lie.upload.url, { method: 'PUT', body: real, headers: lie.upload.headers })
    expect((await call('a', 'POST', `/clients/${client.id}/assets`, { sha256: claimed })).json).toEqual({ error: 'The uploaded bytes do not match their SHA-256' })
    // The bad bytes are gone, so the real owner of that hash can still upload it.
    const honest = await upload('a', client.id, png(2, 2, `${run}-claimed`))
    expect(honest).toMatchObject({ uploaded: true, asset: { sha256: claimed } })
  })

  it('refuses uploads that are too big or not an image type', async () => {
    expect((await call('a', 'POST', `/clients/${client.id}/assets/uploads`, { sha256: 'a'.repeat(64), byteSize: 31 * 1024 * 1024, contentType: 'image/png' })).status).toBe(400)
    expect((await call('a', 'POST', `/clients/${client.id}/assets/uploads`, { sha256: 'a'.repeat(64), byteSize: 10, contentType: 'image/svg+xml' })).status).toBe(400)
  })

  it('signs an upload URL for its key, content type and size only', async () => {
    const bytes = png(6, 6, `${run}-signed`)
    const ticket = UploadTicket.parse((await call('a', 'POST', `/clients/${client.id}/assets/uploads`, { sha256: sha256(bytes), byteSize: bytes.length, contentType: 'image/png' })).json)
    if (!ticket.upload) throw new Error('expected an upload URL')
    expect((await fetch(ticket.upload.url, { method: 'PUT', body: bytes, headers: { 'content-type': 'image/jpeg' } })).status).toBe(403)
    expect((await fetch(ticket.upload.url, { method: 'PUT', body: new Uint8Array([...bytes, 0]), headers: ticket.upload.headers })).status).toBe(403)
    const elsewhere = new URL(ticket.upload.url)
    elsewhere.pathname = elsewhere.pathname.replace(/[^/]+$/, 'b'.repeat(64))
    expect((await fetch(elsewhere, { method: 'PUT', body: bytes, headers: ticket.upload.headers })).status).toBe(403)
  })
})
