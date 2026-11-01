// Google families for the font checks, copied into the storage of the API the specs talk to.
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { SUITE_STORE } from './local-servers.ts'

/** docker compose's database and bucket, which CI's API uses. */
const COMPOSE_STORE = {
  DATABASE_URL: 'postgres://razzlr:razzlr-local@127.0.0.1:55432/razzlr',
  STORAGE_ENDPOINT: 'http://127.0.0.1:59000', STORAGE_BUCKET: 'razzlr', STORAGE_ACCESS_KEY_ID: 'razzlr',
  STORAGE_SECRET_ACCESS_KEY: 'razzlr-local-secret', STORAGE_REGION: 'us-east-1',
}

/**
 * Copies Google families into the API's storage, as `fonts:google` does for a deployment: CI's
 * docker compose stack, or off CI the suite's own (support/local-servers.ts).
 */
export function importGoogleFonts(families: string[]) {
  execFileSync('node', ['apps/api/src/import-google-fonts.ts', ...families], {
    cwd: join(import.meta.dirname, '..', '..', '..'),
    stdio: 'pipe',
    env: process.env.CI ? { ...COMPOSE_STORE, ...process.env } : { ...process.env, ...SUITE_STORE },
  })
}
