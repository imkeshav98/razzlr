// The sync server: Hocuspocus relaying Yjs updates between tabs, with Postgres keeping each design.
// A connection opens a design only with a sync token the API issued for that design (#34). When the
// last connection leaves, deleted layers are compacted away before the design is stored (#57).
import { Database } from '@hocuspocus/extension-database'
import { Server } from '@hocuspocus/server'
import { readDesignState, writeDesignState, type Db } from '@razzlr/db'
import { compact } from '@razzlr/doc'
import { verifySyncToken } from '@razzlr/sync-token'

export function createSyncServer({ db, secret, port, onDestroy }: { db: Db; secret: string; port: number; onDestroy?: () => Promise<void> }) {
  return new Server({
    port,
    quiet: true,
    // Store soon after edits stop, and at least every 10 s while they continue.
    debounce: 500,
    maxDebounce: 10_000,
    async onAuthenticate({ token, documentName }) {
      const checked = verifySyncToken(secret, token, documentName)
      // Throwing refuses the connection; the provider hears "permission denied".
      if (!checked.ok) throw new Error(checked.reason)
      return { userId: checked.payload.userId, workspaceId: checked.payload.workspaceId }
    },
    // The API creates every design with its first state and runs the migrations; this only reads
    // and replaces states.
    extensions: [new Database({
      fetch: ({ documentName }) => readDesignState(db, documentName),
      store: ({ documentName, state }) => writeDesignState(db, documentName, state),
    })],
    // Hocuspocus then stores the compacted state at once, because the compaction is a change, and
    // unloads the design. Compacting runs in one go, so nobody can join halfway through it.
    async onDisconnect({ document }) {
      if (document.getConnectionsCount() === 0) compact(document)
    },
    async onDestroy() {
      await onDestroy?.()
    },
  })
}
