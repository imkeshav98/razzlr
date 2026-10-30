import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { FONT_FACES } from '@razzlr/fonts'
import { FONT_FILES_DIR } from '@razzlr/fonts/node'
import { renderDesign } from '@razzlr/renderer'
import { loadCanvasKit } from '@razzlr/renderer/node'
import { parseDesign } from '@razzlr/schema'
import { build } from 'esbuild'
import { loadFixtures } from '../src/fixtures.ts'
import { ASSETS_DIR, comparePixels, encodePng, fixtureResources, OUTPUT_DIR, type Pixels } from '../src/pixels.ts'

const ORIGIN = 'http://parity.test'
const OUT = join(OUTPUT_DIR, 'browser')

const cases = loadFixtures().flatMap(({ name, json }) => {
  const parsed = parseDesign(json)
  if (!parsed.success) throw new Error(parsed.errors.join('\n'))
  const assetIds = [...new Set(JSON.stringify(json).match(/"assetId":"[^"]+"/g)?.map((m) => m.slice(11, -1)) ?? [])]
  return Object.keys(parsed.design.pages).flatMap((pageId) =>
    Object.keys(parsed.design.formats).map((formatId) => ({ name, json, pageId, formatId, assetIds })))
})

type Surface = 'cpu' | 'webgl'
const report: { case: string; differing: number; percent: number; maxDelta: number }[] = []

test.describe.configure({ mode: 'serial' })

let page: Page

test.beforeAll(async ({ browser }) => {
  const bundle = await build({
    entryPoints: [join(import.meta.dirname, '..', 'browser', 'harness.ts')],
    bundle: true, write: false, format: 'esm', platform: 'browser', target: 'es2022',
    // Emscripten's Node branch, never taken in the browser.
    external: ['fs', 'path'],
  })
  const wasm = readFileSync(join(createRequire(import.meta.url).resolve('canvaskit-wasm/full'), '..', 'canvaskit.wasm'))
  const files: Record<string, [string, Buffer | string]> = {
    '/': ['text/html', '<!doctype html><script type="module" src="/harness.js"></script>'],
    '/harness.js': ['text/javascript', bundle.outputFiles[0]?.text ?? ''],
    '/canvaskit.wasm': ['application/wasm', wasm],
  }
  for (const face of FONT_FACES) files[`/fonts/${face.file}`] = ['font/ttf', readFileSync(join(FONT_FILES_DIR, face.file))]
  for (const id of new Set(cases.flatMap((c) => c.assetIds))) files[`/assets/${id}.jpg`] = ['image/jpeg', readFileSync(join(ASSETS_DIR, `${id}.jpg`))]

  page = await browser.newPage()
  page.on('pageerror', (e) => console.error(e))
  await page.route(`${ORIGIN}/**`, (route) => {
    const file = files[new URL(route.request().url()).pathname]
    return file ? route.fulfill({ contentType: file[0], body: file[1] }) : route.fulfill({ status: 404 })
  })
  await page.goto(ORIGIN)
  await page.waitForFunction(() => 'harnessReady' in globalThis, null, { timeout: 60_000 })
})

test.afterAll(async () => {
  await page.close()
  mkdirSync(OUTPUT_DIR, { recursive: true })
  const rows = report.map((r) => `| ${r.case} | ${r.differing} | ${r.percent.toFixed(3)}% | ${r.maxDelta} |`)
  const markdown = ['| Page in format | Differing pixels | Share | Largest channel difference |', '|---|---|---|---|', ...rows].join('\n')
  writeFileSync(join(OUTPUT_DIR, 'webgl-vs-cpu.md'), `# WebGL vs CPU in Chromium\n\n${markdown}\n`)
  if (process.env.GITHUB_STEP_SUMMARY) writeFileSync(process.env.GITHUB_STEP_SUMMARY, `## WebGL vs CPU in Chromium\n\n${markdown}\n`, { flag: 'a' })
  console.log(`\nWebGL vs CPU in Chromium\n${markdown}`)
})

async function renderInBrowser(c: (typeof cases)[number], surface: Surface): Promise<Pixels> {
  const out = await page.evaluate(
    ([json, pageId, formatId, s, assetIds]) =>
      (globalThis as unknown as { renderFixture: (...a: unknown[]) => Promise<{ width: number; height: number; pixels: string }> })
        .renderFixture(json, pageId, formatId, s, assetIds),
    [c.json, c.pageId, c.formatId, surface, c.assetIds] as const,
  )
  return { width: out.width, height: out.height, pixels: new Uint8Array(Buffer.from(out.pixels, 'base64')) }
}

function maxDelta(a: Pixels, b: Pixels) {
  let max = 0
  for (let i = 0; i < a.pixels.length; i++) max = Math.max(max, Math.abs((a.pixels[i] ?? 0) - (b.pixels[i] ?? 0)))
  return max
}

for (const c of cases) {
  const label = `${c.name} ${c.pageId}.${c.formatId}`

  test(`${label}: browser CPU matches Node CPU`, async () => {
    const ck = await loadCanvasKit()
    const node = renderDesign(ck, c.json, c.pageId, c.formatId, fixtureResources())
    const browser = await renderInBrowser(c, 'cpu')
    const { differing, diff } = comparePixels(node, browser)
    if (differing > 0) {
      mkdirSync(OUT, { recursive: true })
      writeFileSync(join(OUT, `${c.name}.${c.pageId}.${c.formatId}.browser.png`), encodePng(ck, browser))
      writeFileSync(join(OUT, `${c.name}.${c.pageId}.${c.formatId}.diff.png`), encodePng(ck, diff))
    }
    expect(differing, `pixels differing from Node; see ${OUT}`).toBe(0)
  })

  test(`${label}: WebGL drift from CPU is measured`, async () => {
    const cpu = await renderInBrowser(c, 'cpu')
    const webgl = await renderInBrowser(c, 'webgl')
    const { differing } = comparePixels(cpu, webgl)
    report.push({ case: label, differing, percent: (100 * differing) / (cpu.width * cpu.height), maxDelta: maxDelta(cpu, webgl) })
  })
}
