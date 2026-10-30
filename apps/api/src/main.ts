// The API server: migrates the database, then serves. Settings come from the environment only.
import { serve } from '@hono/node-server'
import { migrateDatabase, openDatabase, orgs, clients } from '@razzlr/db'
import { openStorage, storageSettings } from '@razzlr/storage'
import { syncTokenSecret } from '@razzlr/sync-token'
import { createApp } from './app.ts'
import { DEV_CLIENTS, DEV_ORG, devSession } from './session.ts'

const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) throw new Error('DATABASE_URL is not set')
const port = Number(process.env.API_PORT ?? 8787)
const syncSecret = syncTokenSecret()
const storage = openStorage(storageSettings())
// Local and CI storage starts empty; deployed buckets are made once, by hand.
if (process.env.STORAGE_CREATE_BUCKET === 'on') await storage.ensureBucket()
// Until sign-in (#58), the development session is the only way in, so it must be asked for.
const dev = process.env.RAZZLR_DEV_SESSION === 'on'
if (dev && process.env.NODE_ENV === 'production') throw new Error('RAZZLR_DEV_SESSION is never on in production')

const { db, close } = openDatabase(databaseUrl)
await migrateDatabase(db)
if (dev) {
  await db.insert(orgs).values(DEV_ORG).onConflictDoNothing()
  await db.insert(clients).values(DEV_CLIENTS.map((c) => ({ ...c, orgId: DEV_ORG.id }))).onConflictDoNothing()
}

const app = createApp({ db, storage, sessionOf: dev ? devSession : () => null, syncSecret })
const server = serve({ fetch: app.fetch, port }, () => console.log(`api on http://localhost:${port}${dev ? ' with the development session' : ''}`))

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => server.close(() => void close()))
}
