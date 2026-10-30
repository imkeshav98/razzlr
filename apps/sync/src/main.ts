// The sync server: Hocuspocus relaying Yjs updates between tabs, with Postgres keeping each design.
// Phase 0 has no authentication, so it must only run locally and in CI, never on a public address.
import { Database } from '@hocuspocus/extension-database'
import { Server } from '@hocuspocus/server'
import { openDatabase, readDesignState, writeDesignState } from '@razzlr/db'

const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) throw new Error('DATABASE_URL is not set')
const port = Number(process.env.SYNC_PORT ?? 1234)

// The API creates every design with its first state and runs the migrations; this only reads and
// replaces states.
const { db, close } = openDatabase(databaseUrl)

const server = new Server({
  port,
  quiet: true,
  // Store soon after edits stop, and at least every 10 s while they continue.
  debounce: 500,
  maxDebounce: 10_000,
  extensions: [new Database({
    fetch: ({ documentName }) => readDesignState(db, documentName),
    store: ({ documentName, state }) => writeDesignState(db, documentName, state),
  })],
  async onDestroy() {
    await close()
  },
})

await server.listen()
console.log(`sync server on ws://localhost:${port}`)
