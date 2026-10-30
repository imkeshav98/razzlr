// The UI foundation (#51): themes change only tokens, Arabic mirrors the chrome but not the design,
// reduced motion turns chrome animation off. Screenshots go to output/ for the PR.
import { expect, test, type Page } from '@playwright/test'
import { writeOutput, editorPath } from '../support/editor.ts'
import { liveDesign, seed } from '../support/seed.ts'

const shoot = async (page: Page, name: string) => writeOutput(`ui-${name}.png`, await page.screenshot())

async function setCookies(page: Page, cookies: Record<string, string>) {
  await page.context().addCookies(Object.entries(cookies).map(([name, value]) => ({ name, value, url: 'http://localhost:3100' })))
}

test.use({ viewport: { width: 1440, height: 900 } })

test('dark and light change only the tokens', async ({ page }) => {
  test.setTimeout(90_000)
  const designId = await seed(liveDesign())
  for (const theme of ['dark', 'light'] as const) {
    await setCookies(page, { theme })
    await page.goto('/')
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme)
    await page.waitForTimeout(300)
    await shoot(page, `${theme}-brands`)
    await page.goto('/brands/dev-brand-coffee')
    await page.waitForTimeout(400)
    await shoot(page, `${theme}-designs`)
    await page.goto(editorPath(designId))
    await expect(page.getByTestId('status')).toHaveAttribute('data-ready', '', { timeout: 30_000 })
    await page.getByRole('button', { name: 'AI' }).click()
    await expect(page.getByTestId('flyout')).toBeVisible()
    await page.waitForTimeout(300)
    await shoot(page, `${theme}-editor`)
  }
  // Same markup in both themes: only custom properties differ.
  const backgrounds: string[] = []
  for (const theme of ['dark', 'light'] as const) {
    backgrounds.push(await page.evaluate((t) => {
      document.documentElement.dataset.theme = t
      return getComputedStyle(document.body).backgroundColor
    }, theme))
  }
  expect(backgrounds[0]).not.toBe(backgrounds[1])
})

test('the system theme is followed until a pick is made', async ({ browser }) => {
  for (const colorScheme of ['light', 'dark'] as const) {
    const context = await browser.newContext({ colorScheme })
    const page = await context.newPage()
    await page.goto('/')
    await expect(page.locator('html')).toHaveAttribute('data-theme', colorScheme)
    await context.close()
  }
})

test('in Arabic the chrome mirrors and reads right to left, the design does not', async ({ page }) => {
  const designId = await seed(liveDesign())
  await setCookies(page, { locale: 'ar', theme: 'dark' })
  await page.goto('/brands/dev-brand-coffee')
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl')
  await expect(page.getByRole('button', { name: 'تصميم جديد' })).toBeVisible()
  await page.waitForTimeout(400)
  await shoot(page, 'arabic-designs')

  await page.goto(editorPath(designId))
  await expect(page.getByTestId('status')).toHaveAttribute('data-ready', '', { timeout: 30_000 })
  await expect(page.getByTestId('status')).toHaveText('تم الحفظ')
  const rail = await page.getByRole('button', { name: 'الطبقات' }).boundingBox()
  const stage = await page.getByTestId('stage').boundingBox()
  if (!rail || !stage) throw new Error('missing rail or stage')
  // The rail sits on the right of the stage in Arabic.
  expect(rail.x).toBeGreaterThan(stage.x + stage.width)
  await expect(page.getByTestId('stage').locator('xpath=..')).toHaveCSS('direction', 'ltr')
  await page.getByRole('button', { name: 'الطبقات' }).click()
  await page.waitForTimeout(300)
  await shoot(page, 'arabic-editor')
})

test('reduced motion turns chrome animation off', async ({ browser }) => {
  test.setTimeout(90_000)
  const designId = await seed(liveDesign())
  for (const reducedMotion of ['no-preference', 'reduce'] as const) {
    const context = await browser.newContext({ reducedMotion, viewport: { width: 1440, height: 900 } })
    const page = await context.newPage()
    await page.goto(editorPath(designId))
    await expect(page.getByTestId('status')).toHaveAttribute('data-ready', '', { timeout: 30_000 })
    // The flyout's opacity on every frame for half a second from the click: a fade passes through
    // values between 0 and 1, appearing outright doesn't. Every frame rather than one sample at a
    // fixed delay, which a slow CI runner can land before the first frame or after the fade.
    const opacities = page.evaluate(() => new Promise<number[]>((resolve) => {
      const seen: number[] = []
      const start = performance.now()
      const tick = () => {
        const flyout = document.querySelector('[data-testid=flyout]')
        if (flyout) seen.push(Number(getComputedStyle(flyout).opacity))
        if (performance.now() - start < 500) requestAnimationFrame(tick)
        else resolve(seen)
      }
      requestAnimationFrame(tick)
    }))
    await page.getByRole('button', { name: 'Layers' }).click()
    const seen = await opacities
    expect(seen.at(-1)).toBe(1)
    const fading = seen.filter((o) => o > 0 && o < 1)
    const tooltipTransition = await page.locator('.rise, [role=toolbar] button').first().evaluate((el) => getComputedStyle(el).transitionDuration)
    if (reducedMotion === 'reduce') {
      expect(fading).toEqual([])
      expect(Number.parseFloat(tooltipTransition)).toBeLessThan(0.001)
    } else {
      expect(fading.length).toBeGreaterThan(0)
    }
    await context.close()
  }
})
