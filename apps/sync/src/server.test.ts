// The sync server refuses every connection without a valid token for the design it opens (#34), and
// compacts a design once its last connection leaves (#57).
// Runs against Postgres from Docker Compose, like the API's seam tests.
import { randomUUID } from 'node:crypto'
import type { AddressInfo } from 'node:net'
import { HocuspocusProvider } from '@hocuspocus/provider'
import { brands, designs, designStates, migrateDatabase, openDatabase, workspaces, readDesignState } from '@dazbee/db'
import { signSyncToken } from '@dazbee/sync-token'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { createSyncServer } from './server.ts'

const DATABASE_URL = process.env.DATABASE_URL ?? 'postgres://razzlr:razzlr-local@127.0.0.1:55432/razzlr'
const { db, close } = openDatabase(DATABASE_URL)
const secret = 'sync-test-secret-'.padEnd(32, 'x')
const server = createSyncServer({ db, secret, port: 0 })
let url = ''

const run = randomUUID().slice(0, 8)
const design = `design-${run}`
const other = `design-other-${run}`
const tidy = `design-tidy-${run}`
const who = { workspaceId: `workspace-${run}`, userId: 'user-1' }

beforeAll(async () => {
  await migrateDatabase(db)
  await db.insert(workspaces).values({ id: who.workspaceId, name: 'Workspace' })
  await db.insert(brands).values({ id: `brand-${run}`, workspaceId: who.workspaceId, name: 'Brand' })
  await db.insert(designs).values([design, other, tidy].map((id) => ({ id, workspaceId: who.workspaceId, brandId: `brand-${run}`, name: id, kind: 'single' as const })))
  const doc = new Y.Doc()
  doc.getMap('meta').set('name', 'stored')
  await db.insert(designStates).values([
    { designId: design, state: Y.encodeStateAsUpdate(doc) },
    { designId: tidy, state: Y.encodeStateAsUpdate(withDeletedLayer()) },
  ])
  await server.listen()
  url = `ws://127.0.0.1:${(server.httpServer.address() as AddressInfo).port}`
})
afterAll(async () => {
  await server.destroy()
  await close()
})

/** A design's layers as the doc keeps them: one live, one deleted, each with an override. */
function withDeletedLayer() {
  const doc = new Y.Doc()
  const layer = (deleted: boolean) => new Y.Map<unknown>(Object.entries({ type: 'graphic', parentId: 'p1', index: 'a0', name: 'Box', ...(deleted && { deleted }) }))
  doc.transact(() => {
    doc.getMap('nodes').set('live', layer(false))
    doc.getMap('nodes').set('gone', layer(true))
    doc.getMap('overrides').set('format:f|live|x', 1)
    doc.getMap('overrides').set('format:f|gone|x', 2)
  })
  return doc
}

/** Connects with `token` and reports whether the server let the design open. */
function connect(name: string, token: string | null) {
  const document = new Y.Doc()
  return new Promise<{ outcome: 'synced' | 'refused'; document: Y.Doc }>((resolve) => {
    const provider = new HocuspocusProvider({
      url, name, document, token,
      onSynced: () => finish('synced'),
      onAuthenticationFailed: () => finish('refused'),
    })
    function finish(outcome: 'synced' | 'refused') {
      provider.destroy()
      resolve({ outcome, document })
    }
  })
}

describe('sync server tokens', () => {
  it('opens the design for a valid token, with its stored state', async () => {
    const { outcome, document } = await connect(design, signSyncToken(secret, { designId: design, ...who }).token)
    expect(outcome).toBe('synced')
    expect(document.getMap('meta').get('name')).toBe('stored')
  })

  it('refuses a connection without a token', async () => {
    expect((await connect(design, null)).outcome).toBe('refused')
  })

  it('refuses an expired token', async () => {
    const { token } = signSyncToken(secret, { designId: design, ...who }, Date.now() - 11 * 60 * 1000)
    expect((await connect(design, token)).outcome).toBe('refused')
  })

  it('refuses a token for another design', async () => {
    const { token } = signSyncToken(secret, { designId: other, ...who })
    const { outcome, document } = await connect(design, token)
    expect(outcome).toBe('refused')
    expect(document.getMap('meta').size).toBe(0)
  })

  it('refuses a token signed with another secret', async () => {
    const { token } = signSyncToken('someone-else-'.padEnd(32, 'y'), { designId: design, ...who })
    expect((await connect(design, token)).outcome).toBe('refused')
  })
})

describe('compaction', () => {
  const token = () => signSyncToken(secret, { designId: tidy, ...who }).token
  /** A tab that stays connected until it leaves. */
  function open() {
    const document = new Y.Doc()
    return new Promise<{ document: Y.Doc; leave: () => void }>((resolve) => {
      const provider = new HocuspocusProvider({ url, name: tidy, document, token: token(), onSynced: () => resolve({ document, leave: () => provider.destroy() }) })
    })
  }
  const keys = (doc: Y.Doc, name: string) => [...doc.getMap(name).keys()].sort()
  const stored = async () => {
    const state = await readDesignState(db, tidy)
    const doc = new Y.Doc()
    if (state) Y.applyUpdate(doc, state)
    return doc
  }
  const until = async (ok: () => Promise<boolean>) => {
    for (let i = 0; i < 100 && !(await ok()); i++) await new Promise((r) => setTimeout(r, 50))
  }

  it('waits while anyone is connected, then drops deleted layers and stores the result', async () => {
    const first = await open()
    const second = await open()
    expect(keys(second.document, 'nodes')).toEqual(['gone', 'live'])
    first.leave()
    // The other tab is still here, so nothing changes under it.
    await new Promise((r) => setTimeout(r, 800))
    expect(keys(second.document, 'nodes')).toEqual(['gone', 'live'])
    expect(keys(await stored(), 'nodes')).toEqual(['gone', 'live'])

    second.leave()
    await until(async () => keys(await stored(), 'nodes').length === 1)
    const after = await stored()
    expect(keys(after, 'nodes')).toEqual(['live'])
    expect(keys(after, 'overrides')).toEqual(['format:f|live|x'])

    // Coming back, a tab sees the same live layer.
    const again = await open()
    expect(keys(again.document, 'nodes')).toEqual(['live'])
    expect(again.document.getMap<Y.Map<unknown>>('nodes').get('live')?.toJSON()).toEqual({ type: 'graphic', parentId: 'p1', index: 'a0', name: 'Box' })
    again.leave()
  })
})
