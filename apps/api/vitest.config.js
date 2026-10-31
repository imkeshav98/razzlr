import preset from '@razzlr/config/vitest'
import { defineConfig } from 'vitest/config'

// The seam tests share one database: it is migrated once, before any of them run.
export default defineConfig({ ...preset, test: { ...preset.test, globalSetup: ['./src/test-database.ts'] } })
