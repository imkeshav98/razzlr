// The database every server shares: tables, migrations and the design state the sync server keeps.
import { fileURLToPath } from 'node:url'
import { eq, sql } from 'drizzle-orm'
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import pg from 'pg'
import * as tables from './tables.ts'

export * from './tables.ts'

export type Db = NodePgDatabase<typeof tables>

export interface Database {
  db: Db
  close(): Promise<void>
}

export function openDatabase(url: string, { max = 4 } = {}): Database {
  const pool = new pg.Pool({ connectionString: url, max })
  return { db: drizzle(pool, { schema: tables }), close: () => pool.end() }
}

const MIGRATIONS = fileURLToPath(new URL('../migrations', import.meta.url))

/** Brings the database up to the latest migration; servers call it on start. */
export async function migrateDatabase(db: Db): Promise<void> {
  await migrate(db, { migrationsFolder: MIGRATIONS })
}

/** A design's Yjs state, or null when the design has none yet. */
export async function readDesignState(db: Db, designId: string): Promise<Uint8Array | null> {
  const [row] = await db.select({ state: tables.designStates.state }).from(tables.designStates).where(eq(tables.designStates.designId, designId))
  return row?.state ?? null
}

/**
 * Replaces a design's Yjs state and marks the design updated. A design deleted while someone still
 * had it open is gone: its state is not stored again.
 */
export async function writeDesignState(db: Db, designId: string, state: Uint8Array): Promise<void> {
  await db.transaction(async (tx) => {
    const [design] = await tx.select({ id: tables.designs.id }).from(tables.designs).where(eq(tables.designs.id, designId))
    if (!design) return
    await tx.insert(tables.designStates).values({ designId, state })
      .onConflictDoUpdate({ target: tables.designStates.designId, set: { state, updatedAt: sql`now()` } })
    await tx.update(tables.designs).set({ updatedAt: sql`now()` }).where(eq(tables.designs.id, designId))
  })
}
