// The UI foundation (#51): themes change only tokens, Arabic mirrors the chrome but not the design,
// reduced motion turns chrome animation off. Screenshots go to output/ for the PR.
import { expect, test, type Page } from '../support/test.ts'
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
    await page.getByRole('button', { name: 'AI', exact: true }).click()
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
  await expect(page.getByRole('button', { name: 'اصنع المسودات' })).toBeVisible()
  await page.waitForTimeout(400)
  await shoot(page, 'arabic-designs')

  await page.goto(editorPath(designId))
  await expect(page.getByTestId('status')).toHaveAttribute('data-ready', '', { timeout: 30_000 })
  await expect(page.getByTestId('status')).toHaveText('تم الحفظ')
  const rail = await page.getByRole('button', { name: 'الطبقات' }).boundingBox()
  const stage = await page.getByTestId('stage').boundingBox()
  if (!rail || !stage) throw new Error('missing rail or stage')
  // The capsule floats over the right side of the stage in Arabic.
  expect(rail.x).toBeGreaterThan(stage.x + stage.width / 2)
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
    await page.getByRole('button', { name: 'Layers', exact: true }).click()
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

// Riso Pop and frosted surfaces (#81): floating chrome blurs what is under it and carries grain,
// in both themes; close-ups of the dock, zoom pill and flyout go to output/ for the PR.
test('floating chrome is frosted with grain in both themes', async ({ page }) => {
  test.setTimeout(90_000)
  const designId = await seed(liveDesign())
  for (const theme of ['dark', 'light'] as const) {
    await setCookies(page, { theme })
    await page.goto(editorPath(designId))
    await expect(page.getByTestId('status')).toHaveAttribute('data-ready', '', { timeout: 30_000 })
    await page.getByRole('button', { name: 'Layers', exact: true }).click()
    await expect(page.getByTestId('flyout')).toBeVisible()
    for (const surface of [page.getByRole('toolbar'), page.getByRole('group', { name: 'Zoom' }), page.getByTestId('flyout')]) {
      const style = await surface.evaluate((el) => {
        const s = getComputedStyle(el)
        return { filter: s.backdropFilter, image: s.backgroundImage }
      })
      expect(style.filter).toContain('blur(18px)')
      expect(style.image).toContain('feTurbulence')
    }
    await page.waitForTimeout(300)
    await shoot(page, `${theme}-frost`)
    const dock = await page.getByRole('toolbar').boundingBox()
    const zoom = await page.getByRole('group', { name: 'Zoom' }).boundingBox()
    if (!dock || !zoom) throw new Error('missing dock or zoom')
    writeOutput(`ui-${theme}-frost-dock.png`, await page.screenshot({ clip: { x: dock.x - 40, y: dock.y - 40, width: zoom.x + zoom.width - dock.x + 80, height: dock.height + 80 } }))
  }
})

// The floating capsule (#82): it floats over the canvas, a pink blob slides between its buttons,
// flyouts are only as tall as their content, and on phones it is a tab bar at the bottom.
const centre = (box: { x: number; y: number; width: number; height: number } | null) => {
  if (!box) throw new Error('missing box')
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
}

/**
 * The blob's centre and vertical scale on every frame and style change for 900 ms from clicking
 * the named panel button, and the vertical scale the blob starts from when it lands (read as it
 * mounts, since a slow machine may draw no frame before it settles).
 */
async function blobPath(page: Page, name: string) {
  const path = page.evaluate(() => new Promise<{ landing: number; frames: { y: number; scaleY: number }[] }>((resolve) => {
    const seen: { y: number; scaleY: number }[] = []
    let landing = 1
    const rail = document.querySelector('[data-testid=rail]')
    // Motion writes the blob's style on each step of the slide, so this also sees the steps a busy
    // machine draws no frame for.
    const watch = new MutationObserver(() => {
      const blob = document.querySelector('[data-testid=rail-blob]')
      const squish = blob?.firstElementChild
      if (!blob || !(squish instanceof HTMLElement)) return
      landing = Math.max(landing, new DOMMatrix(squish.style.transform || 'none').d)
      const box = blob.getBoundingClientRect()
      seen.push({ y: box.y + box.height / 2, scaleY: new DOMMatrix(getComputedStyle(squish).transform).d })
    })
    if (rail) watch.observe(rail, { childList: true, subtree: true, attributes: true, attributeFilter: ['style'] })
    const start = performance.now()
    const tick = () => {
      const blob = document.querySelector('[data-testid=rail-blob]')
      const squish = blob?.firstElementChild
      if (blob && squish) {
        const box = blob.getBoundingClientRect()
        seen.push({ y: box.y + box.height / 2, scaleY: new DOMMatrix(getComputedStyle(squish).transform).d })
      }
      if (performance.now() - start < 900) requestAnimationFrame(tick)
      else {
        watch.disconnect()
        resolve({ landing, frames: seen })
      }
    }
    requestAnimationFrame(tick)
  }))
  await page.getByRole('button', { name }).click()
  return path
}

test('the panels live in a capsule floating over the canvas', async ({ page }) => {
  const designId = await seed(liveDesign())
  await setCookies(page, { theme: 'dark' })
  await page.goto(editorPath(designId))
  await expect(page.getByTestId('status')).toHaveAttribute('data-ready', '', { timeout: 30_000 })
  const rail = page.getByTestId('rail')
  const stage = await page.getByTestId('stage').boundingBox()
  const box = await rail.boundingBox()
  if (!stage || !box) throw new Error('missing rail or stage')
  // Over the canvas at the start edge, centred top to bottom, round ends, frosted.
  expect(box.x).toBeGreaterThan(stage.x)
  expect(box.x - stage.x).toBeLessThan(24)
  expect(Math.abs(centre(box).y - centre(stage).y)).toBeLessThan(4)
  expect(box.height).toBeGreaterThan(box.width)
  expect(Number.parseFloat(await rail.evaluate((el) => getComputedStyle(el).borderTopLeftRadius))).toBeGreaterThanOrEqual(box.width / 2)
  expect(await rail.evaluate((el) => getComputedStyle(el).backdropFilter)).toContain('blur(18px)')

  // The blob lands on the open panel's button and slides there, stretched, when another opens.
  await expect(page.getByTestId('rail-blob')).toHaveCount(0)
  await page.getByRole('button', { name: 'Layers', exact: true }).click()
  const layers = centre(await page.getByRole('button', { name: 'Layers', exact: true }).boundingBox())
  await expect.poll(async () => Math.abs(centre(await page.getByTestId('rail-blob').boundingBox()).y - layers.y)).toBeLessThan(1)
  await shoot(page, 'capsule-layers')
  const { landing, frames: path } = await blobPath(page, 'Brand')
  const brand = centre(await page.getByRole('button', { name: 'Brand', exact: true }).boundingBox())
  // A slide, not a jump: once the blob is on Brand, it is drawn back where Layers was and travels
  // from there. (How many steps between a busy machine draws depends on its frame rate.) It lands
  // stretched and settles on Brand.
  const arrived = path.findIndex((p) => Math.abs(p.y - brand.y) < 4)
  expect(arrived).toBeGreaterThanOrEqual(0)
  expect(path.slice(arrived).some((p) => p.y < brand.y - 4)).toBe(true)
  expect(landing).toBeGreaterThan(1.05)
  await expect.poll(async () => Math.abs(centre(await page.getByTestId('rail-blob').boundingBox()).y - brand.y)).toBeLessThan(1)
  await expect(page.getByRole('button', { name: 'Brand', exact: true })).toHaveAttribute('aria-expanded', 'true')
  await expect(page.getByRole('button', { name: 'Layers', exact: true })).toHaveAttribute('aria-expanded', 'false')

  // The flyout opens beside the capsule.
  const flyout = await page.getByTestId('flyout').boundingBox()
  if (!flyout) throw new Error('missing flyout')
  expect(flyout.x).toBeGreaterThan(box.x + box.width)

  // Keyboard: the buttons take focus and toggle their panel with Enter. (Space is the canvas's pan
  // key, which the editor takes before any button does.)
  const ai = page.getByRole('button', { name: 'AI', exact: true })
  await ai.focus()
  await page.keyboard.press('Enter')
  await expect(ai).toHaveAttribute('aria-expanded', 'true')
  await expect(ai).toBeFocused()
  await page.waitForTimeout(400)
  // A flyout is only as tall as what it holds: the AI one, still empty, is short. (Brand holds the
  // brand kit since #53.)
  expect((await page.getByTestId('flyout').boundingBox())?.height).toBeLessThan(stage.height / 2)
  await shoot(page, 'capsule-ai')
  await page.keyboard.press('Enter')
  await expect(ai).toHaveAttribute('aria-expanded', 'false')
  await expect(page.getByTestId('flyout')).toHaveCount(0)
})

test('with reduced motion the blob jumps without sliding or squishing', async ({ browser }) => {
  const designId = await seed(liveDesign())
  const context = await browser.newContext({ reducedMotion: 'reduce', viewport: { width: 1440, height: 900 } })
  const page = await context.newPage()
  await page.goto(editorPath(designId))
  await expect(page.getByTestId('status')).toHaveAttribute('data-ready', '', { timeout: 30_000 })
  await page.getByRole('button', { name: 'Layers', exact: true }).click()
  const layers = centre(await page.getByRole('button', { name: 'Layers', exact: true }).boundingBox())
  const { landing, frames: path } = await blobPath(page, 'Brand')
  const brand = centre(await page.getByRole('button', { name: 'Brand', exact: true }).boundingBox())
  expect(landing).toBe(1)
  // Every frame has the blob on Layers (before the click lands) or on Brand, never between.
  expect(Math.abs((path.at(-1)?.y ?? Number.NaN) - brand.y)).toBeLessThan(1)
  for (const p of path) {
    expect(Math.min(Math.abs(p.y - layers.y), Math.abs(p.y - brand.y))).toBeLessThan(1)
    expect(p.scaleY).toBe(1)
  }
  await context.close()
})

test('on a phone the capsule is a tab bar at the bottom', async ({ browser }) => {
  const designId = await seed(liveDesign())
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })
  const page = await context.newPage()
  await context.addCookies([{ name: 'theme', value: 'dark', url: 'http://localhost:3100' }])
  await page.goto(editorPath(designId))
  await expect(page.getByTestId('status')).toHaveAttribute('data-ready', '', { timeout: 30_000 })
  const rail = await page.getByTestId('rail').boundingBox()
  const dock = await page.getByRole('toolbar').boundingBox()
  const zoom = await page.getByRole('group', { name: 'Zoom' }).boundingBox()
  if (!rail || !dock || !zoom) throw new Error('missing chrome')
  expect(rail.width).toBeGreaterThan(rail.height)
  expect(Math.abs(centre(rail).x - 390 / 2)).toBeLessThan(2)
  expect(844 - (rail.y + rail.height)).toBeLessThan(24)
  // The dock sits above the tab bar and the zoom pill moves to the top, so nothing overlaps.
  expect(dock.y + dock.height).toBeLessThanOrEqual(rail.y)
  expect(zoom.y + zoom.height).toBeLessThan(dock.y)
  await shoot(page, 'capsule-phone')
  await page.getByRole('button', { name: 'Layers', exact: true }).tap()
  const flyout = await page.getByTestId('flyout').boundingBox()
  if (!flyout) throw new Error('missing flyout')
  expect(flyout.y + flyout.height).toBeLessThanOrEqual(dock.y)
  expect(flyout.x).toBeGreaterThanOrEqual(0)
  expect(flyout.x + flyout.width).toBeLessThanOrEqual(390)
  await page.waitForTimeout(400)
  await shoot(page, 'capsule-phone-layers')
  await context.close()
})
