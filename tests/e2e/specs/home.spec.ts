// The brand's home (#84): "What are we making for <brand>?" as a brief with Format chips and Make
// drafts. The capsule opens recent work (a bento of real pictures, the latest large, stories tall,
// banners wide) and the templates under the brief, one at a time, kept in the address (?show=).
import { expect, test, type Page } from '../support/test.ts'
import type { DesignInput } from '@dazbee/schema'
import { writeOutput } from '../support/editor.ts'
import { seed } from '../support/seed.ts'

const shoot = async (page: Page, name: string, fullPage = false) => writeOutput(`home-${name}.png`, await page.screenshot({ fullPage }))

/** A design in one format with a coloured page and a block, so its picture is easy to tell apart. */
const poster = (name: string, width: number, height: number, page: string, block: string): DesignInput => ({
  meta: { schemaVersion: 2, designId: 'replaced-by-the-api', name, kind: 'single', primaryFormatId: 'f' },
  formats: { f: { name: 'Format', width, height, order: 'a0' } },
  pages: { p1: { name: 'Page 1', order: 'a0', fills: [{ type: 'solid', color: page }] } },
  nodes: {
    block: {
      type: 'graphic', parentId: 'p1', index: 'a0', name: 'Block',
      props: { x: width * 0.1, y: height * 0.1, width: width * 0.5, height: height * 0.3, shape: { kind: 'rect', cornerRadius: 24 }, fills: [{ type: 'solid', color: block }] },
    },
  },
  overrides: {},
})

test.use({ viewport: { width: 1440, height: 900 } })

test('recent work is a bento of real pictures: the latest large, a story tall, a banner wide', async ({ page }) => {
  const run = crypto.randomUUID().slice(0, 6)
  await seed(poster(`Story ${run}`, 1080, 1920, '#3D6BFFFF', '#FFD23FFF'))
  await seed(poster(`Banner ${run}`, 1500, 500, '#1A1420FF', '#FF48B0FF'))
  await seed(poster(`Square ${run}`, 1080, 1080, '#FF48B0FF', '#FFFFFFFF'))
  await page.context().addCookies([{ name: 'theme', value: 'dark', url: 'http://localhost:3100' }])
  await page.goto('/brands/dev-brand-coffee?show=recent')
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('What are we making for Harbour Coffee?')

  // As in the final mock: one line, the brand's name in the AI gradient, the editor's top bar
  // (the brand switcher in the crumb, the account avatar), no list of brands beside the page.
  const heading = await page.getByRole('heading', { level: 1 }).boundingBox()
  expect(heading?.height).toBeLessThan(70)
  expect(await page.getByRole('heading', { level: 1 }).getByText('Harbour Coffee').evaluate((el) => getComputedStyle(el).backgroundImage)).toContain('linear-gradient')
  await expect(page.getByTestId('brand-switcher')).toContainText('Harbour Coffee')
  await expect(page.getByTestId('account-open')).toBeVisible()
  await expect(page.getByRole('complementary')).toHaveCount(0)

  const bento = page.getByRole('list', { name: 'Recent' })
  const tile = (name: string) => bento.getByTestId('bento-tile').filter({ has: page.getByRole('link', { name: new RegExp(name) }) })
  // Newest first: the square, made last, is the big tile.
  await expect(bento.getByTestId('bento-tile').first()).toContainText(`Square ${run}`)
  await expect(tile(`Square ${run}`)).toHaveAttribute('data-span', 'large')
  await expect(tile(`Story ${run}`)).toHaveAttribute('data-span', 'tall')
  await expect(tile(`Banner ${run}`)).toHaveAttribute('data-span', 'wide')
  const big = await tile(`Square ${run}`).boundingBox()
  const story = await tile(`Story ${run}`).boundingBox()
  const banner = await tile(`Banner ${run}`).boundingBox()
  if (!big || !story || !banner) throw new Error('a tile is missing')
  expect(big.width).toBeGreaterThan(story.width * 1.8)
  expect(story.height).toBeGreaterThan(story.width * 1.4)
  expect(banner.width).toBeGreaterThan(banner.height * 1.6)

  // Each picture is the design itself, drawn by the API, and fills its tile.
  for (const [name, colour] of [[`Square ${run}`, [255, 72, 176]], [`Story ${run}`, [61, 107, 255]], [`Banner ${run}`, [26, 20, 32]]] as const) {
    const img = tile(name).locator('img')
    await expect.poll(() => img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth), { timeout: 20_000 }).toBeGreaterThan(100)
    const fit = await img.evaluate((el: HTMLImageElement) => {
      const box = el.getBoundingClientRect()
      const parent = (el.parentElement as HTMLElement).getBoundingClientRect()
      return { fills: Math.abs(box.width - parent.width) < 3 && Math.abs(box.height - parent.height) < 3, fit: getComputedStyle(el).objectFit }
    })
    expect(fit).toEqual({ fills: true, fit: 'cover' })
    // The page's colour, near the picture's lower right corner (the block sits top left).
    const pixel = await img.evaluate((el: HTMLImageElement) => {
      const canvas = document.createElement('canvas')
      canvas.width = el.naturalWidth
      canvas.height = el.naturalHeight
      const ctx = canvas.getContext('2d') as CanvasRenderingContext2D
      ctx.drawImage(el, 0, 0)
      return [...ctx.getImageData(Math.floor(el.naturalWidth * 0.9), Math.floor(el.naturalHeight * 0.9), 1, 1).data].slice(0, 3)
    })
    for (const [i, c] of colour.entries()) expect(Math.abs((pixel[i] ?? 0) - c), `${name} channel ${i}`).toBeLessThanOrEqual(2)
  }
  await page.waitForTimeout(400)
  await shoot(page, 'bento', true)
})

test('the capsule opens Recent and Templates under the brief, one at a time, and the address keeps it', async ({ page }) => {
  await page.goto('/brands/dev-brand-coffee')
  const capsule = page.getByTestId('library-capsule')
  const recent = capsule.getByRole('link', { name: 'Recent' })
  const templates = capsule.getByRole('link', { name: 'Templates' })
  const bento = page.getByRole('list', { name: 'Recent' })
  const brief = page.getByRole('heading', { level: 1 })

  // At first the brief is alone, and Home is lit.
  await expect(bento).toHaveCount(0)
  await expect(page.getByTestId('home-panel-templates')).toHaveCount(0)
  await expect(capsule.locator('[data-lit]')).toHaveAttribute('data-entry', 'home')
  const alone = await brief.boundingBox()
  await shoot(page, 'brief-alone')

  // Recent lights up, the brief moves up and the bento rises under it.
  await recent.click()
  await expect(page).toHaveURL(/\/brands\/dev-brand-coffee\?show=recent$/)
  await expect(bento).toBeVisible()
  await expect(recent).toHaveAttribute('aria-expanded', 'true')
  await expect(capsule.locator('[data-lit]')).toHaveAttribute('data-entry', 'recent')
  await expect.poll(async () => (await brief.boundingBox())?.y).toBeLessThan((alone?.y ?? 0) - 40)
  await page.waitForTimeout(500)
  await shoot(page, 'recent-open')

  // Templates takes its place.
  await templates.click()
  await expect(page).toHaveURL(/\?show=templates$/)
  await expect(page.getByTestId('home-panel-templates')).toBeVisible()
  await expect(bento).toHaveCount(0)
  await page.waitForTimeout(500)
  await shoot(page, 'templates-open')

  // A reload keeps it; back goes to Recent; the lit entry again, Esc and the close button close it.
  await page.reload()
  await expect(page.getByTestId('home-panel-templates')).toBeVisible()
  await page.goBack()
  await expect(page).toHaveURL(/\?show=recent$/)
  await expect(bento).toBeVisible()
  await recent.click()
  await expect(page).toHaveURL(/\/brands\/dev-brand-coffee$/)
  await expect(bento).toHaveCount(0)
  await templates.click()
  await page.keyboard.press('Escape')
  await expect(page).toHaveURL(/\/brands\/dev-brand-coffee$/)
  await recent.click()
  await page.getByTestId('home-panel-recent').getByRole('button', { name: 'Close' }).click()
  await expect(page).toHaveURL(/\/brands\/dev-brand-coffee$/)
  await expect(capsule.locator('[data-lit]')).toHaveAttribute('data-entry', 'home')
})

test('Make drafts opens a design in the formats the brief picked, named by the brief', async ({ page }) => {
  // The home, then the editor opening, which alone may take its 30 s on a busy runner.
  test.setTimeout(60_000)
  await page.goto('/brands/dev-brand-coffee')
  const brief = `Autumn roast launch ${crypto.randomUUID().slice(0, 6)}`
  await page.getByLabel('Brief').fill(`${brief}\nWarm, cosy, a cup on a wooden table`)
  // Feed square is picked from the start; add Story.
  await expect(page.getByTestId('brief-format-feed-square')).toBeChecked()
  await page.getByTestId('brief-formats').click()
  await page.getByRole('dialog', { name: 'Formats' }).getByText('Story', { exact: true }).click()
  await expect(page.getByTestId('brief-format-story')).toBeChecked()
  await page.keyboard.press('Escape')
  await shoot(page, 'brief')
  await page.getByRole('button', { name: 'Make drafts' }).click()
  await expect(page).toHaveURL(/\/brands\/dev-brand-coffee\/designs\/[\w-]+$/)
  await expect(page.getByTestId('status')).toHaveAttribute('data-ready', '', { timeout: 30_000 })
  const design = await page.evaluate(() => window.dazbee?.design())
  expect(design?.meta.name).toBe(brief)
  expect(Object.values(design?.formats ?? {}).map((f) => [f.name, f.width, f.height])).toEqual([['Feed square', 1080, 1080], ['Story', 1080, 1920]])
  expect(design?.meta.primaryFormatId).toBe('f1')
})

test('on a phone the brief fits the screen and Recent is a bottom sheet over it', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
  const page = await context.newPage()
  await page.goto('/brands/dev-brand-coffee')
  await expect(page.getByRole('button', { name: 'Make drafts' })).toBeVisible()
  // Nothing runs off the side.
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
  await page.waitForTimeout(400)
  await shoot(page, 'phone', true)

  await page.getByTestId('library-capsule').getByRole('link', { name: 'Recent' }).click()
  const sheet = page.getByTestId('home-panel-recent')
  await expect(sheet).toBeVisible()
  await page.waitForTimeout(600)
  const box = await sheet.boundingBox()
  expect(box?.width).toBe(390)
  expect(Math.round((box?.y ?? 0) + (box?.height ?? 0))).toBe(844)
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
  await shoot(page, 'phone-recent')
  await context.close()
})
