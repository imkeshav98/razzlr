import pg from 'pg'

/** Each design's Yjs state as one row, replaced on every store (ADR-0003: one Yjs doc per design). */
export function postgresStore(databaseUrl: string) {
  const pool = new pg.Pool({ connectionString: databaseUrl, max: 4 })
  const ready = pool.query(`
    create table if not exists designs (
      id text primary key,
      state bytea not null,
      updated_at timestamptz not null default now()
    )`)

  return {
    async fetch(id: string): Promise<Uint8Array | null> {
      await ready
      const { rows } = await pool.query<{ state: Buffer }>('select state from designs where id = $1', [id])
      return rows[0] ? new Uint8Array(rows[0].state) : null
    },
    async store(id: string, state: Uint8Array): Promise<void> {
      await ready
      await pool.query(
        `insert into designs (id, state) values ($1, $2)
         on conflict (id) do update set state = excluded.state, updated_at = now()`,
        [id, Buffer.from(state)],
      )
    },
    close: () => pool.end(),
  }
}
