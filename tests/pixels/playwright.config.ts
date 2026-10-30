import { defineConfig, devices } from '@playwright/test'

/** Browser half of the render seam: the same renderer in Chromium, compared with Node (#6). */
export default defineConfig({
  testDir: './specs',
  forbidOnly: !!process.env.CI,
  timeout: 120_000,
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  projects: [{
    name: 'chromium',
    use: { ...devices['Desktop Chrome'], launchOptions: { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] } },
  }],
})
