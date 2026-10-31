// Floating property cards (#83): no inspector column, the canvas runs full width, and the cards
// float at the top end, each as tall as its content. The stage fits the ads between the capsule
// and the cards. With nothing selected the Page card paints the page; a selection shows Arrange.
// On phones the cards are a bottom sheet opened from the tab bar.
import { expect, test, type Page } from '../support/test.ts'
import { designOf, editorPath, screenPoint, writeOutput } from '../support/editor.ts'
import { liveDesign, seed } from '../support/seed.ts'

const shoot = async (page: Page, name: string) => writeOutput(`cards-${name}.png`, await page.screenshot())
const box = async (page: Page, testId: string) => {
  const found = await page.getByTestId(testId).boundingBox()
  if (!found) throw new Error(`no ${testId}`)
  return found
}
const pageFill = async (page: Page) => (JSON.parse(await designOf(page)) as { pages: Record<string, { fills: { color: string }[] }> }).pages.p1?.fills[0]?.color

async function open(page: Page) {
  const designId = await seed(liveDesign())
  await page.context().addCookies([{ name: 'theme', value: 'dark', url: 'http://localhost:3100' }])
  await page.goto(editorPath(designId))
  await expect(page.getByTestId('status')).toHaveAttribute('data-ready', '', { timeout: 30_000 })
}

test.use({ viewport: { width: 1440, height: 900 } })

test('the cards float over a full-width canvas and the ads fit between the capsule and them', async ({ page }) => {
  await open(page)
  const stage = await box(page, 'stage')
  const cards = await box(page, 'cards')
  const rail = await box(page, 'rail')
  // No inspector column: the canvas runs the whole width, and the cards sit at its top end.
  expect(stage.width).toBeGreaterThan(1430)
  expect(stage.x + stage.width - (cards.x + cards.width)).toBeLessThan(16)
  // Below the end island (#110).
  expect(cards.y - stage.y).toBeLessThan(96)
  expect(await page.getByTestId('cards').evaluate((el) => getComputedStyle(el).backgroundColor)).toBe('rgba(0, 0, 0, 0)')
  for (const card of ['page-card', 'formats', 'pages']) await expect(page.getByTestId(card)).toBeVisible()
  // Each card is as tall as what it holds, and frosted.
  const pageCard = page.getByTestId('page-card')
  expect((await box(page, 'page-card')).height).toBeLessThan(140)
  expect(await pageCard.evaluate((el) => getComputedStyle(el).backdropFilter)).toContain('blur(18px)')

  // The square, fitted, sits wholly between the capsule and the cards, centred in that gap: as
  // it opens (the editor is ready only once it is), and again from Zoom to fit.
  const between = async () => {
    await page.evaluate(() => window.razzlr?.drawn())
    const left = (await screenPoint(page, 0, 0)).x
    const right = (await screenPoint(page, 1080, 1080)).x
    expect(left).toBeGreaterThan(rail.x + rail.width)
    expect(right).toBeLessThan(cards.x)
    expect(Math.abs((left + right) / 2 - (rail.x + rail.width + cards.x) / 2)).toBeLessThan(12)
  }
  await between()
  await page.evaluate(() => window.razzlr?.setCamera({ x: 0, y: 0, zoom: 1 }))
  await page.getByRole('button', { name: 'Zoom to fit' }).click()
  await between()
  await shoot(page, 'design')
})

test('the Page card paints the page, and Fine-tune takes any colour', async ({ page }) => {
  await open(page)
  const card = page.getByTestId('page-card')
  expect(await pageFill(page)).toBe('#FFF8F0FF')
  await card.getByRole('button', { name: '#FF48B0' }).click()
  await expect.poll(() => pageFill(page)).toBe('#FF48B0FF')
  await expect(card.getByRole('button', { name: '#FF48B0' })).toHaveAttribute('aria-pressed', 'true')
  await shoot(page, 'page-pink')
  // One undo step takes the colour back.
  await page.keyboard.press('Control+z')
  await expect.poll(() => pageFill(page)).toBe('#FFF8F0FF')
  await expect(card.getByRole('button', { name: '#FF48B0' })).toHaveAttribute('aria-pressed', 'false')

  await card.getByRole('button', { name: 'Fine-tune' }).click()
  const hex = card.getByRole('textbox', { name: 'Hex' })
  await expect(hex).toHaveValue('#FFF8F0')
  await hex.fill('3d6bff')
  await hex.press('Enter')
  await expect.poll(() => pageFill(page)).toBe('#3D6BFFFF')
  await shoot(page, 'page-fine-tune')
})

test('a selection swaps the design cards for Arrange, which aligns, distributes and groups', async ({ page }) => {
  await open(page)
  const at = await screenPoint(page, 200, 180)
  await page.mouse.click(at.x, at.y)
  const arrange = page.getByTestId('arrange')
  await expect(arrange).toBeVisible()
  await expect(page.getByTestId('page-card')).toHaveCount(0)
  await expect(page.getByTestId('formats')).toHaveCount(0)
  // One layer aligns to its format; distribute and group need more.
  await expect(arrange.getByRole('button', { name: 'Align left' })).toBeEnabled()
  await expect(arrange.getByRole('button', { name: 'Distribute horizontally' })).toBeDisabled()
  await expect(arrange.getByRole('button', { name: 'Group' })).toBeDisabled()
  // The align buttons are the big ones.
  const big = await arrange.getByRole('button', { name: 'Align left' }).boundingBox()
  const small = await arrange.getByRole('button', { name: 'Distribute horizontally' }).boundingBox()
  expect(big?.height ?? 0).toBeGreaterThan((small?.height ?? Infinity) * 1.3)

  await page.keyboard.press('Control+a')
  await expect(arrange.getByRole('button', { name: 'Distribute horizontally' })).toBeEnabled()
  await shoot(page, 'arrange')
  const before = Object.keys(JSON.parse(await designOf(page)).nodes).length
  await arrange.getByRole('button', { name: 'Group' }).click()
  await expect.poll(async () => Object.values(JSON.parse(await designOf(page)).nodes as Record<string, { type: string }>).filter((n) => n.type === 'group').length).toBe(1)
  expect(Object.keys(JSON.parse(await designOf(page)).nodes).length).toBe(before + 1)

  // Escape clears the selection and the design cards come back.
  await page.keyboard.press('Escape')
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('page-card')).toBeVisible()
})

test('on a phone the cards are a bottom sheet opened from the tab bar', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })
  const page = await context.newPage()
  await open(page)
  // Closed, the cards leave the canvas to the design.
  await expect(page.getByTestId('cards')).toBeHidden()
  await page.getByRole('button', { name: 'Inspector' }).tap()
  const cards = await box(page, 'cards')
  const rail = await box(page, 'rail')
  expect(cards.x).toBeGreaterThanOrEqual(0)
  expect(cards.x + cards.width).toBeLessThanOrEqual(390)
  expect(cards.width).toBeGreaterThan(360)
  expect(cards.y + cards.height).toBeLessThanOrEqual(rail.y)
  await expect(page.getByTestId('flyout')).toHaveCount(0)
  await page.waitForTimeout(300)
  await shoot(page, 'phone-sheet')
  await page.getByRole('button', { name: 'Inspector' }).tap()
  await expect(page.getByTestId('cards')).toBeHidden()
  await context.close()
})
