// The API seam, against Postgres from Docker Compose (`docker compose up -d --wait postgres`).
import { randomUUID } from 'node:crypto'
import { clients, migrateDatabase, openDatabase, orgs, readDesignState } from '@razzlr/db'
import { readDesign } from '@razzlr/doc'
import { ApiError, ClientSummary, DesignSummary } from '@razzlr/schema'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { createApp } from './app.ts'
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
const app = createApp({ db, sessionOf: (request) => sessions[request.headers.get('x-test-session') ?? ''] ?? null })

async function call(as: string | null, method: string, path: string, body?: unknown) {
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (as) headers['x-test-session'] = as
  const response = await app.request(path, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
  return { status: response.status, json: await response.json() as unknown }
}

beforeAll(async () => {
  await migrateDatabase(db)
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
