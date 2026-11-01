import { defineConfig } from 'drizzle-kit'

// `pnpm --filter @dazbee/db migration` writes a migration for schema changes; never edit one by hand.
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/tables.ts',
  out: './migrations',
})
