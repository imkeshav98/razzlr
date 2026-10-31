// The brand's home (#84): "What are we making for <brand>?" as a brief with Format chips and Make
// drafts, and recent work as a bento of real pictures, the latest large, stories tall, banners wide.
import { expect, test, type Page } from '@playwright/test'
import type { DesignInput } from '@razzlr/schema'
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
  await page.goto('/brands/dev-brand-coffee')
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('What are we making for Harbour Coffee?')

  const bento = page.getByRole('list', { name: 'Recent work' })
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

test('Make drafts opens a design in the formats the brief picked, named by the brief', async ({ page }) => {
  // The home, then the editor opening, which alone may take its 30 s on a busy runner.
  test.setTimeout(60_000)
  await page.goto('/brands/dev-brand-coffee')
  const brief = `Autumn roast launch ${crypto.randomUUID().slice(0, 6)}`
  await page.getByLabel('Brief').fill(`${brief}\nWarm, cosy, a cup on a wooden table`)
  // Feed square is picked from the start; add Story.
  await expect(page.getByTestId('brief-format-feed-square')).toBeChecked()
  await page.getByText('Story', { exact: true }).click()
  await expect(page.getByTestId('brief-format-story')).toBeChecked()
  await expect(page.getByRole('button', { name: 'Reference ad' })).toBeDisabled()
  await shoot(page, 'brief')
  await page.getByRole('button', { name: 'Make drafts' }).click()
  await expect(page).toHaveURL(/\/brands\/dev-brand-coffee\/designs\/[\w-]+$/)
  await expect(page.getByTestId('status')).toHaveAttribute('data-ready', '', { timeout: 30_000 })
  const design = await page.evaluate(() => window.razzlr?.design())
  expect(design?.meta.name).toBe(brief)
  expect(Object.values(design?.formats ?? {}).map((f) => [f.name, f.width, f.height])).toEqual([['Feed square', 1080, 1080], ['Story', 1080, 1920]])
  expect(design?.meta.primaryFormatId).toBe('f1')
})

test('on a phone the brief and the bento fit the screen', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
  const page = await context.newPage()
  await page.goto('/brands/dev-brand-coffee')
  await expect(page.getByRole('button', { name: 'Make drafts' })).toBeVisible()
  // Nothing runs off the side.
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
  await page.waitForTimeout(400)
  await shoot(page, 'phone', true)
  await context.close()
})
