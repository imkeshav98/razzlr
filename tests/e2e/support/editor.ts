import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, type Browser, type Page } from '@playwright/test'
import { DEV_CLIENT, liveDesign, seed } from './seed.ts'

/** Where the live editing checks leave their screenshots and numbers; CI uploads it. */
export const OUTPUT = join(import.meta.dirname, '..', 'output')

/**
 * Opens a design in `count` tabs, each in its own browser context, all live. Without a design id
 * it creates a fresh one; with one it opens what the sync server already has.
 */
export async function openTabs(browser: Browser, count: number, existing?: string) {
  const designId = existing ?? await seed(liveDesign())
  const tabs: Page[] = []
  const errors: string[] = []
  for (let i = 0; i < count; i++) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } })
    const page = await context.newPage()
    page.on('pageerror', (error) => errors.push(`tab ${i + 1}: ${error.message}`))
    await page.goto(editorPath(designId))
    await expect(page.getByTestId('status')).toHaveAttribute('data-ready', '', { timeout: 30_000 })
    tabs.push(page)
  }
  return { designId, tabs, errors }
}

export const editorPath = (designId: string) => `/clients/${DEV_CLIENT}/designs/${designId}`

/**
 * What the stage shows, with the panel capsule masked: it floats over the canvas (#82) and the AI
 * button's glow is always moving, so two shots of the same design would otherwise differ there.
 */
export const stageShot = (page: Page) => page.getByTestId('stage').screenshot({ mask: [page.getByTestId('rail')] })

/** The design as the tab's document holds it now, as JSON with sorted keys so two tabs compare equal. */
export const designOf = (page: Page) =>
  page.evaluate(() => {
    const sort = (v: unknown): unknown =>
      Array.isArray(v) ? v.map(sort)
        : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, x]) => [k, sort(x)]))
          : v
    return JSON.stringify(sort(window.razzlr?.design()))
  })

/** SHA-256 of the tab's export render (CPU surface), so megabytes of pixels need not cross to Node. */
export const exportHashOf = (page: Page) =>
  page.evaluate(async () => {
    const pixels = window.razzlr?.exportPixels()
    if (!pixels) throw new Error('no editor')
    const digest = await crypto.subtle.digest('SHA-256', pixels.slice())
    return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
  })

export const synced = (page: Page) => page.evaluate(() => window.razzlr?.synced() ?? false)

/** Waits until every tab has sent all its changes and all tabs hold the same design. */
export async function settle(tabs: Page[]) {
  await expect.poll(async () => {
    if (!(await Promise.all(tabs.map(synced))).every(Boolean)) return false
    const designs = await Promise.all(tabs.map(designOf))
    return designs.every((d) => d === designs[0])
  }, { timeout: 30_000 }).toBe(true)
}

/**
 * A design pixel of one frame as a point on screen, as the tab's camera shows it now: the first
 * page in the primary format by default.
 */
export async function screenPoint(page: Page, x: number, y: number, frame?: { pageId: string; formatId: string }) {
  const point = await page.evaluate(({ x, y, frame }) => window.razzlr?.screenPoint(x, y, frame?.pageId, frame?.formatId), { x, y, frame })
  if (!point) throw new Error('no editor')
  return point
}

/** A layer's props as one format shows them: the base with that format's overrides on top. */
export function placed(design: { nodes: Record<string, { props: Record<string, unknown> }>; overrides?: Record<string, Record<string, Record<string, unknown>>> }, id: string, formatId: string) {
  return { ...design.nodes[id]?.props, ...design.overrides?.[`format:${formatId}`]?.[id] }
}

export function writeOutput(name: string, content: string | Buffer) {
  mkdirSync(OUTPUT, { recursive: true })
  writeFileSync(join(OUTPUT, name), content)
}

/** Restarts the sync server container and waits until it is healthy again. */
export function restartSyncServer() {
  const root = join(import.meta.dirname, '..', '..', '..')
  execFileSync('docker', ['compose', 'restart', 'sync'], { cwd: root, stdio: 'pipe' })
  execFileSync('docker', ['compose', 'up', '-d', '--wait', 'sync'], { cwd: root, stdio: 'pipe' })
}

/** Whether the sync server has stored the design's state since `since` (packages/db's design_states). */
export function storedAfter(designId: string, since: Date) {
  const root = join(import.meta.dirname, '..', '..', '..')
  const sql = `select count(*) from design_states where design_id = '${designId.replace(/'/g, "''")}' and updated_at > '${since.toISOString()}'`
  const out = execFileSync('docker', ['compose', 'exec', '-T', 'postgres', 'psql', '-U', 'razzlr', '-d', 'razzlr', '-tAc', sql], { cwd: root, encoding: 'utf8' })
  return out.trim() === '1'
}

/** How many bytes the sync server last stored for the design (packages/db's design_states). */
export function storedSize(designId: string) {
  const root = join(import.meta.dirname, '..', '..', '..')
  const sql = `select octet_length(state) from design_states where design_id = '${designId.replace(/'/g, "''")}'`
  const out = execFileSync('docker', ['compose', 'exec', '-T', 'postgres', 'psql', '-U', 'razzlr', '-d', 'razzlr', '-tAc', sql], { cwd: root, encoding: 'utf8' })
  return Number(out.trim())
}
