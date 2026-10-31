// Vitest's global setup: brings the test database up to the latest migration once, so test files
// running side by side never migrate it at the same time.
import { migrateDatabase, openDatabase } from '@razzlr/db'

export async function setup() {
  const { db, close } = openDatabase(process.env.DATABASE_URL ?? 'postgres://razzlr:razzlr-local@127.0.0.1:55432/razzlr')
  try {
    await migrateDatabase(db)
  } finally {
    await close()
  }
}
