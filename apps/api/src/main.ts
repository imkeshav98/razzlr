// The API server: migrates the database, then serves. Settings come from the environment only.
import { serve } from '@hono/node-server'
import { migrateDatabase, openDatabase, workspaces, brands } from '@dazbee/db'
import { openStorage, storageSettings } from '@dazbee/storage'
import { syncTokenSecret } from '@dazbee/sync-token'
import { createApp } from './app.ts'
import { DEV_BRANDS, DEV_WORKSPACE, devSession, firstSession, sessionSecret, tokenSession } from './session.ts'
import { workosProvider, workosSettings } from './sign-in.ts'

const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) throw new Error('DATABASE_URL is not set')
const port = Number(process.env.API_PORT ?? 8787)
const syncSecret = syncTokenSecret()
const storage = openStorage(storageSettings())
// Local and CI storage starts empty; deployed buckets are made once, by hand.
if (process.env.STORAGE_CREATE_BUCKET === 'on') await storage.ensureBucket()
// Sign-in with WorkOS (#58) when its settings are given; the development session only when asked for.
const workos = workosSettings()
const dev = process.env.DAZBEE_DEV_SESSION === 'on'
if (dev && process.env.NODE_ENV === 'production') throw new Error('DAZBEE_DEV_SESSION is never on in production')
const signIn = workos ? { provider: workosProvider(workos), secret: sessionSecret() } : null

const { db, close } = openDatabase(databaseUrl)
await migrateDatabase(db)
if (dev) {
  await db.insert(workspaces).values(DEV_WORKSPACE).onConflictDoNothing()
  await db.insert(brands).values(DEV_BRANDS.map((c) => ({ ...c, workspaceId: DEV_WORKSPACE.id }))).onConflictDoNothing()
}

const sessionOf = firstSession(...(signIn ? [tokenSession(db, signIn.secret)] : []), ...(dev ? [devSession] : []))
const app = createApp({ db, storage, sessionOf, syncSecret, signIn })
const ways = [signIn && 'WorkOS sign-in', dev && 'the development session'].filter(Boolean).join(' and ') || 'no way to sign in'
const server = serve({ fetch: app.fetch, port }, () => console.log(`api on http://localhost:${port} with ${ways}`))

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => server.close(() => void close()))
}
