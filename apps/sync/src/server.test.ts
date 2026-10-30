// The sync server refuses every connection without a valid token for the design it opens (#34).
// Runs against Postgres from Docker Compose, like the API's seam tests.
import { randomUUID } from 'node:crypto'
import type { AddressInfo } from 'node:net'
import { HocuspocusProvider } from '@hocuspocus/provider'
import { brands, designs, designStates, migrateDatabase, openDatabase, workspaces } from '@razzlr/db'
import { signSyncToken } from '@razzlr/sync-token'
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
const who = { workspaceId: `workspace-${run}`, userId: 'user-1' }

beforeAll(async () => {
  await migrateDatabase(db)
  await db.insert(workspaces).values({ id: who.workspaceId, name: 'Workspace' })
  await db.insert(brands).values({ id: `brand-${run}`, workspaceId: who.workspaceId, name: 'Brand' })
  await db.insert(designs).values([design, other].map((id) => ({ id, workspaceId: who.workspaceId, brandId: `brand-${run}`, name: id, kind: 'single' as const })))
  const doc = new Y.Doc()
  doc.getMap('meta').set('name', 'stored')
  await db.insert(designStates).values({ designId: design, state: Y.encodeStateAsUpdate(doc) })
  await server.listen()
  url = `ws://127.0.0.1:${(server.httpServer.address() as AddressInfo).port}`
})
afterAll(async () => {
  await server.destroy()
  await close()
})

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
