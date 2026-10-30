import { defineConfig, devices } from '@playwright/test'

/** Browser half of the render seam: the same renderer in Chromium, compared with Node (#6). */
export default defineConfig({
  testDir: './specs',
  globalSetup: './specs/support/global-setup.ts',
  globalTeardown: './specs/support/global-teardown.ts',
  // One worker shares one browser page with CanvasKit loaded; tests stay independent.
  workers: 1,
  forbidOnly: !!process.env.CI,
  timeout: 120_000,
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  projects: [{
    name: 'chromium',
    use: { ...devices['Desktop Chrome'], launchOptions: { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] } },
  }],
})
