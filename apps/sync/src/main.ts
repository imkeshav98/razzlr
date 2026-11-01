// Starts the sync server; settings come from the environment only.
import { openDatabase } from '@dazbee/db'
import { syncTokenSecret } from '@dazbee/sync-token'
import { createSyncServer } from './server.ts'

const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) throw new Error('DATABASE_URL is not set')
const port = Number(process.env.SYNC_PORT ?? 1234)
const secret = syncTokenSecret()

const { db, close } = openDatabase(databaseUrl)
const server = createSyncServer({ db, secret, port, onDestroy: close })
await server.listen()
console.log(`sync server on ws://localhost:${port}`)
