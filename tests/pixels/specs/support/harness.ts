import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { test as base, type Page } from '@playwright/test'
import { FONT_FACES } from '@razzlr/fonts'
import { FONT_FILES_DIR } from '@razzlr/fonts/node'
import type { ExportType } from '@razzlr/schema'
import { build } from 'esbuild'
import { ASSETS_DIR, type Pixels } from '../../src/pixels.ts'

const ORIGIN = 'http://parity.test'

export type Surface = 'cpu' | 'webgl'
export interface Harness {
  render(json: unknown, pageId: string, formatId: string, surface: Surface, assetIds: string[]): Promise<Pixels>
  /** The file the browser's export makes: PNG, JPG at quality 85, PDF or SVG (#55, #56). */
  exportFile(json: unknown, pageId: string, formatId: string, type: ExportType, assetIds: string[]): Promise<Uint8Array>
}

async function files() {
  const bundle = await build({
    entryPoints: [join(import.meta.dirname, '..', '..', 'browser', 'harness.ts')],
    bundle: true, write: false, format: 'esm', platform: 'browser', target: 'es2022',
    // Emscripten's Node branch, never taken in the browser.
    external: ['fs', 'path'],
  })
  const wasm = readFileSync(join(createRequire(import.meta.url).resolve('@razzlr/canvaskit'), '..', 'canvaskit.wasm'))
  const served: Record<string, [string, Buffer | string]> = {
    '/': ['text/html', '<!doctype html><script type="module" src="/harness.js"></script>'],
    '/harness.js': ['text/javascript', bundle.outputFiles[0]?.text ?? ''],
    '/canvaskit.wasm': ['application/wasm', wasm],
  }
  for (const face of FONT_FACES) served[`/fonts/${face.file}`] = ['font/ttf', readFileSync(join(FONT_FILES_DIR, face.file))]
  return served
}

async function openHarness(page: Page) {
  const served = await files()
  await page.route(`${ORIGIN}/**`, (route) => {
    const path = new URL(route.request().url()).pathname
    const asset = path.match(/^\/assets\/([\w-]+\.jpg)$/)?.[1]
    if (asset) return route.fulfill({ contentType: 'image/jpeg', body: readFileSync(join(ASSETS_DIR, asset)) })
    const file = served[path]
    return file ? route.fulfill({ contentType: file[0], body: file[1] }) : route.fulfill({ status: 404 })
  })
  const failed = new Promise<never>((_, reject) => page.once('pageerror', reject))
  await page.goto(ORIGIN)
  await Promise.race([page.waitForFunction(() => 'harnessReady' in globalThis, null, { timeout: 60_000 }), failed])
}

/** Chromium with the renderer loaded, shared by every test in the worker. */
export const test = base.extend<object, { harness: Harness }>({
  harness: [async ({ browser }, use) => {
    const page = await browser.newPage()
    await openHarness(page)
    await use({
      async render(json, pageId, formatId, surface, assetIds) {
        const out = await page.evaluate(
          ([j, p, f, s, a]) =>
            (globalThis as unknown as { renderFixture: (...args: unknown[]) => Promise<{ width: number; height: number; pixels: string }> })
              .renderFixture(j, p, f, s, a),
          [json, pageId, formatId, surface, assetIds] as const,
        )
        return { width: out.width, height: out.height, pixels: new Uint8Array(Buffer.from(out.pixels, 'base64')) }
      },
      async exportFile(json, pageId, formatId, type, assetIds) {
        const out = await page.evaluate(
          ([j, p, f, t, a]) => (globalThis as unknown as { exportFixture: (...args: unknown[]) => Promise<string> }).exportFixture(j, p, f, t, a),
          [json, pageId, formatId, type, assetIds] as const,
        )
        return new Uint8Array(Buffer.from(out, 'base64'))
      },
    })
    await page.close()
  }, { scope: 'worker' }],
})
