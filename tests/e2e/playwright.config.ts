import { defineConfig, devices } from '@playwright/test'
import { LOCAL } from './support/local-servers.ts'

const CI = !!process.env.CI
// On CI the web app talks to docker compose's API and sync server; off CI the suite starts its own,
// over a database of its own, so it never writes into the local site's workspace (#141).
const PORT = CI ? 3100 : LOCAL.web
// The specs seed through API_URL, so off CI it is always the suite's own API, whatever the shell says.
if (!CI) process.env.API_URL = `http://localhost:${LOCAL.api}`

export default defineConfig({
  testDir: './specs',
  forbidOnly: CI,
  retries: CI ? 1 : 0,
  reporter: CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: { baseURL: `http://localhost:${PORT}`, trace: 'retain-on-failure' },
  // SwiftShader gives headless Chromium WebGL, which the editor stage draws with.
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], launchOptions: { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] } } }],
  webServer: [
    ...(CI ? [] : [{
      command: 'node support/local-servers.ts',
      url: `http://localhost:${LOCAL.api}/health`,
      reuseExistingServer: true,
      timeout: 120_000,
    }]),
    {
      command: `pnpm --filter @dazbee/web start --port ${PORT}`,
      url: `http://localhost:${PORT}`,
      reuseExistingServer: !CI,
      env: CI ? {} : { API_URL: `http://localhost:${LOCAL.api}`, NEXT_PUBLIC_SYNC_URL: `ws://localhost:${LOCAL.sync}`, DAZBEE_DEV_SESSION: 'on' },
    },
  ],
})
