// The sync server: Hocuspocus relaying Yjs updates between tabs, with Postgres keeping each design.
// Phase 0 has no authentication, so it must only run locally and in CI, never on a public address.
import { Database } from '@hocuspocus/extension-database'
import { Server } from '@hocuspocus/server'
import { postgresStore } from './store.ts'

const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) throw new Error('DATABASE_URL is not set')
const port = Number(process.env.SYNC_PORT ?? 1234)

const store = postgresStore(databaseUrl)

const server = new Server({
  port,
  quiet: true,
  // Store soon after edits stop, and at least every 10 s while they continue.
  debounce: 500,
  maxDebounce: 10_000,
  extensions: [new Database({
    fetch: ({ documentName }) => store.fetch(documentName),
    store: ({ documentName, state }) => store.store(documentName, state),
  })],
  async onDestroy() {
    await store.close()
  },
})

await server.listen()
console.log(`sync server on ws://localhost:${port}`)
