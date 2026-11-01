// Off CI, the browser suite runs against servers of its own (#141): an API and a sync server on
// their own ports, over a database and a storage bucket of their own, so a run on a developer's
// machine never writes into the workspace their local site shows. CI's servers are thrown away
// after each run, so it uses docker compose's as before.
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

export const LOCAL = { api: 8797, sync: 1244, web: 3110 } as const
const ROOT = fileURLToPath(new URL('../../../', import.meta.url))
const SERVER = 'postgres://razzlr:razzlr-local@127.0.0.1:55432'
const DATABASE = 'razzlr_e2e'

/** Makes the suite's database once; the API brings it up to the latest migration as it starts. */
async function ensureDatabase() {
  // pg comes with @razzlr/db; the suite doesn't depend on it directly.
  const pg = createRequire(new URL('../../../packages/db/package.json', import.meta.url))('pg') as {
    Client: new (options: { connectionString: string }) => {
      connect(): Promise<void>
      query(text: string, values?: unknown[]): Promise<{ rowCount: number | null }>
      end(): Promise<void>
    }
  }
  const client = new pg.Client({ connectionString: `${SERVER}/razzlr` })
  await client.connect()
  try {
    const found = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [DATABASE])
    if (found.rowCount === 0) await client.query(`CREATE DATABASE ${DATABASE}`)
  } finally {
    await client.end()
  }
}

const env = {
  ...process.env,
  DATABASE_URL: `${SERVER}/${DATABASE}`,
  SYNC_TOKEN_SECRET: 'local-only-sync-token-secret-0000',
  RAZZLR_DEV_SESSION: 'on',
  API_PORT: String(LOCAL.api),
  SYNC_PORT: String(LOCAL.sync),
  STORAGE_ENDPOINT: 'http://127.0.0.1:59000',
  STORAGE_PUBLIC_ENDPOINT: 'http://127.0.0.1:59000',
  STORAGE_BUCKET: 'razzlr-e2e',
  STORAGE_ACCESS_KEY_ID: 'razzlr',
  STORAGE_SECRET_ACCESS_KEY: 'razzlr-local-secret',
  STORAGE_REGION: 'us-east-1',
  STORAGE_CREATE_BUCKET: 'on',
}

/** Starts a server from the checkout and stops this process when it stops. */
function run(script: string) {
  const child = spawn(process.execPath, [script], { cwd: ROOT, env, stdio: 'inherit' })
  child.on('exit', (code) => process.exit(code ?? 1))
  return child
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await ensureDatabase()
  const api = run('apps/api/src/main.ts')
  // The sync server waits for the API's migrations: it starts once the API answers.
  for (let i = 0; i < 120; i++) {
    if (await fetch(`http://127.0.0.1:${LOCAL.api}/health`).then((r) => r.ok, () => false)) break
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  const sync = run('apps/sync/src/main.ts')
  for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => { api.kill(); sync.kill(); process.exit(0) })
}
