import preset from '@dazbee/config/vitest'
import { defineConfig } from 'vitest/config'

// Whole designs render here, a few seconds each on a slow CI runner.
export default defineConfig({ ...preset, test: { ...preset.test, testTimeout: 30_000 } })
