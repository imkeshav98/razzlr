// Floating islands (#110): the editor has no top bar. The design's name and save state float at
// the start, its actions at the end, below the rulers and over the canvas, and the ads fit below
// them. Outside the editor, navigation is the same floating capsule, a tab bar on phones.
import { expect, test, type Page } from '../support/test.ts'
import { editorPath, screenPoint, writeOutput } from '../support/editor.ts'
import { liveDesign, seed } from '../support/seed.ts'

const box = async (page: Page, testId: string) => {
  const found = await page.getByTestId(testId).boundingBox()
  if (!found) throw new Error(`no ${testId}`)
  return found
}

async function open(page: Page, theme: 'dark' | 'light' = 'dark') {
  await page.context().addCookies([{ name: 'theme', value: theme, url: 'http://localhost:3100' }])
  const designId = await seed(liveDesign())
  await page.goto(editorPath(designId))
  await expect(page.getByTestId('status')).toHaveAttribute('data-ready', '', { timeout: 30_000 })
}

test.use({ viewport: { width: 1440, height: 900 } })

test('the editor has no top bar: two islands float over the canvas and the ads fit below them', async ({ page }) => {
  await open(page)
  const stage = await box(page, 'stage')
  const start = await box(page, 'island-start')
  const end = await box(page, 'island-end')
  // The canvas starts at the window's top edge; the islands float over it, clear of the 20 px
  // rulers when they are on. The rulers are off as the editor opens, as in the final mock.
  await expect(page.locator('.stage-overlay .ruler')).toHaveCount(0)
  expect(stage.y).toBe(0)
  expect(stage.height).toBe(900)
  for (const island of [start, end]) {
    expect(island.y).toBeGreaterThanOrEqual(20)
    expect(island.y + island.height).toBeLessThan(80)
  }
  expect(start.x).toBeLessThan(48)
  expect(1440 - (end.x + end.width)).toBeLessThan(16)
  // No surface of their own.
  for (const id of ['island-start', 'island-end']) {
    expect(await page.getByTestId(id).evaluate((el) => getComputedStyle(el).backgroundColor)).toBe('rgba(0, 0, 0, 0)')
  }
  await expect(page.getByTestId('island-start').getByRole('heading', { level: 1 })).toBeVisible()
  // The end island is the mock's: a pink Share button and the account avatar, nothing else.
  const end_ = page.getByTestId('island-end')
  await expect(end_.getByRole('button')).toHaveCount(2)
  await expect(end_.getByTestId('share-open')).toHaveText('Share')
  await end_.getByTestId('share-open').click()
  // Each item has its name and, under it, what it does.
  await expect(page.getByRole('menuitem')).toHaveText([/^Export/, /^Save as template/])
  await page.keyboard.press('Escape')
  // Language and theme live behind the avatar.
  await end_.getByTestId('account-open').click()
  const account = page.getByTestId('account')
  await expect(account.getByRole('radiogroup', { name: 'Language' })).toBeVisible()
  await expect(account.getByRole('radiogroup', { name: 'Theme' })).toBeVisible()
  await expect(account.getByRole('link', { name: 'Settings' })).toHaveAttribute('href', '/settings')
  await writeOutput('islands-account.png', await page.screenshot({ clip: { x: 1440 - 320, y: 0, width: 320, height: 320 } }))
  await page.keyboard.press('Escape')

  // Saved is a small muted cloud: no pill, no green words. The words stay for screen readers.
  const status = page.getByTestId('status')
  await expect(status).toHaveAttribute('data-status', 'Saved')
  await expect(status).toHaveText('Saved')
  expect((await status.boundingBox())?.width).toBeLessThan(24)
  expect(await status.evaluate((el) => getComputedStyle(el).borderTopWidth)).toBe('0px')

  // The ads fit below the islands and above the dock: as the editor opens, and from Zoom to fit.
  const below = async () => {
    await page.evaluate(() => window.razzlr?.drawn())
    expect((await screenPoint(page, 0, 0)).y).toBeGreaterThan(Math.max(start.y + start.height, end.y + end.height))
    expect((await screenPoint(page, 1080, 1080)).y).toBeLessThan((await box(page, 'stage')).height - 60)
  }
  await below()
  await page.evaluate(() => window.razzlr?.setCamera({ x: 0, y: 0, zoom: 1 }))
  await page.getByRole('button', { name: 'Zoom to fit' }).click()
  await below()
  await writeOutput('islands-editor-dark.png', await page.screenshot())

  // The cards and a flyout start below the end island.
  expect((await box(page, 'cards')).y).toBeGreaterThan(end.y + end.height)
  await page.getByRole('button', { name: 'Layers' }).click()
  expect((await box(page, 'flyout')).y).toBeGreaterThan(start.y + start.height)
})

test('the islands in light and in Arabic, mirrored', async ({ page }) => {
  await open(page, 'light')
  await writeOutput('islands-editor-light.png', await page.screenshot())
  await page.context().addCookies([{ name: 'locale', value: 'ar', url: 'http://localhost:3100' }])
  await page.reload()
  await expect(page.getByTestId('status')).toHaveAttribute('data-ready', '', { timeout: 30_000 })
  const start = await box(page, 'island-start')
  const end = await box(page, 'island-end')
  expect(start.x).toBeGreaterThan(end.x)
  // The rulers stay on the left, so the end island keeps clear of them there.
  expect(end.x).toBeGreaterThanOrEqual(20)
  expect(1440 - (start.x + start.width)).toBeLessThan(48)
  await writeOutput('islands-editor-arabic.png', await page.screenshot())
})

test('offline colours the cloud and says so in words', async ({ page }) => {
  await open(page)
  await page.context().setOffline(true)
  const status = page.getByTestId('status')
  await expect(status).toHaveAttribute('data-status', 'Offline', { timeout: 30_000 })
  await expect(status).toContainText('Offline')
  expect((await status.boundingBox())?.width).toBeGreaterThan(40)
  await writeOutput('islands-editor-offline.png', await page.screenshot({ clip: { x: 0, y: 0, width: 720, height: 120 } }))
  await page.context().setOffline(false)
})

test('the library navigates with the capsule, and on a phone with a tab bar', async ({ page, browser }) => {
  await page.goto('/brands/dev-brand-coffee')
  const capsule = page.getByTestId('library-capsule')
  await expect(capsule.getByRole('link', { name: 'Home' })).toHaveAttribute('aria-current', 'page')
  const shape = await box(page, 'library-capsule')
  expect(shape.x).toBeLessThanOrEqual(20)
  expect(shape.height).toBeGreaterThan(shape.width)
  await writeOutput('islands-library.png', await page.screenshot())
  await capsule.getByRole('link', { name: 'Templates' }).click()
  await expect(page).toHaveURL(/\/brands\/dev-brand-coffee\?show=templates$/)
  await expect(capsule.getByRole('link', { name: 'Templates' })).toHaveAttribute('aria-expanded', 'true')
  await capsule.getByRole('link', { name: 'Settings' }).click()
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Settings')
  await expect(capsule.getByRole('link', { name: 'Settings' })).toHaveAttribute('aria-current', 'page')

  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
  const phone = await context.newPage()
  await phone.goto('/brands/dev-brand-coffee')
  const bar = await phone.getByTestId('library-capsule').boundingBox()
  expect(bar?.width).toBeGreaterThan(bar?.height ?? 0)
  expect(844 - ((bar?.y ?? 0) + (bar?.height ?? 0))).toBeLessThan(24)
  expect(await phone.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
  await writeOutput('islands-library-phone.png', await phone.screenshot())
  await context.close()
})
