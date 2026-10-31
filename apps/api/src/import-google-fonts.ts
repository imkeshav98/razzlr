// Copies the Google Fonts families Dazbee offers into our storage (#50): every family in the catalog,
// or only those named, as in `pnpm --filter @razzlr/api fonts:google Inter "Bebas Neue"`. Run it once
// per environment, and again to pick up new families or Google's updates; from then on fonts load
// from our storage only. Settings come from the environment, as the API's do.
import { migrateDatabase, openDatabase } from '@razzlr/db'
import { GOOGLE_FONTS } from '@razzlr/fonts'
import { openStorage, storageSettings } from '@razzlr/storage'
import { importGoogleFamily } from './fonts.ts'

const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) throw new Error('DATABASE_URL is not set')
const named = process.argv.slice(2)
const unknown = named.filter((family) => !GOOGLE_FONTS.some((f) => f.family === family))
if (unknown.length > 0) throw new Error(`not in the catalog in packages/fonts/src/google.ts: ${unknown.join(', ')}`)
const wanted = named.length > 0 ? GOOGLE_FONTS.filter((f) => named.includes(f.family)) : GOOGLE_FONTS

const storage = openStorage(storageSettings())
if (process.env.STORAGE_CREATE_BUCKET === 'on') await storage.ensureBucket()
const { db, close } = openDatabase(databaseUrl)
try {
  await migrateDatabase(db)
  for (const family of wanted) {
    const copied = await importGoogleFamily(db, storage, family)
    console.log(`${family.family}: ${copied === 0 ? 'up to date' : `${copied} face${copied === 1 ? '' : 's'} copied`}`)
  }
} finally {
  await close()
}
