// The live editing checks of the phase 0 spike (#8): two tabs on one design through the sync
// server, edited by commands and by a real mouse and keyboard. Needs the sync server running:
// `docker compose up -d --wait` from the repo root. The tests in this file run one at a time,
// which the restart test relies on: it restarts the server under no other test.
import { expect, test, type Page } from '@playwright/test'
import { designOf, exportHashOf, openTabs, restartSyncServer, screenPoint, settle, writeOutput } from '../support/editor.ts'

test.describe.configure({ timeout: 120_000 })

/** Runs `count` random commands in a tab, with short pauses so the two tabs' edits interleave on the wire. */
const randomEdits = (page: Page, seed: number, count: number) =>
  page.evaluate(async ({ seed, count }) => {
    const editor = window.razzlr
    if (!editor) throw new Error('no editor')
    let state = seed
    // mulberry32: the same seed makes the same edits on every run.
    const random = () => {
      state = (state + 0x6d2b79f5) | 0
      let t = Math.imul(state ^ (state >>> 15), 1 | state)
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
    const pick = <T,>(xs: T[]) => xs[Math.floor(random() * xs.length)] as T
    const ran: Record<string, number> = {}
    let refused = 0
    for (let i = 0; i < count; i++) {
      const design = editor.design()
      const ids = Object.keys(design.nodes)
      const texts = ids.filter((id) => design.nodes[id]?.type === 'text')
      const roll = random()
      const kind = roll < 0.12 ? 'node.create' : roll < 0.4 ? 'node.update' : roll < 0.5 ? 'node.move' : roll < 0.56 ? 'node.delete'
        : roll < 0.84 ? 'text.edit' : roll < 0.92 ? 'undo' : 'redo'
      ran[kind] = (ran[kind] ?? 0) + 1
      try {
        if (kind === 'undo') editor.session.undo()
        else if (kind === 'redo') editor.session.redo()
        else if (kind === 'node.create') {
          editor.session.run('node.create', {
            parentId: 'p1',
            layer: { type: 'graphic', name: 'R', props: { x: Math.round(random() * 1000), y: Math.round(random() * 1000), width: 60, height: 60, shape: { kind: 'rect' }, fills: [{ type: 'solid', color: '#7E57C2FF' }] } },
          })
        } else if (kind === 'node.update') {
          editor.session.run('node.update', { ids: [pick(ids)], patch: random() < 0.5 ? { x: Math.round(random() * 1000) } : { rotation: Math.round(random() * 90), opacity: 0.5 + random() / 2 } })
        } else if (kind === 'node.move') {
          editor.session.run('node.move', { id: pick(ids), parentId: 'p1', ...(random() < 0.5 ? { before: pick(ids) } : {}) })
        } else if (kind === 'node.delete') {
          // Keep the two text layers: the text edits need somewhere to land.
          editor.session.run('node.delete', { ids: [pick(ids.filter((id) => !texts.includes(id)).concat('box'))] })
        } else {
          const id = pick(texts)
          const length = design.nodes[id]?.type === 'text' ? design.nodes[id].props.text.length : 0
          editor.session.run('text.edit', random() < 0.65 || length < 2
            ? { id, op: { kind: 'insert', at: Math.floor(random() * (length + 1)), text: pick(['a', 'S', 'ب', 'ع', ' ', '%', '4']) } }
            : { id, op: { kind: 'delete', at: Math.floor(random() * (length - 1)), length: 1 } })
        }
      } catch (error) {
        // A command the other tab's edits made impossible (a deleted layer, say) is refused whole.
        if (!(error instanceof Error) || error.name !== 'CommandError') throw error
        refused++
      }
      if (random() < 0.3) await new Promise((resolve) => setTimeout(resolve, random() * 8))
    }
    return { ran, refused }
  }, { seed, count })

test('two tabs make 200 random edits each and end with the same document and the same pixels', async ({ browser }) => {
  const { tabs, errors } = await openTabs(browser, 2)
  const [a, b] = tabs as [Page, Page]
  const [ranA, ranB] = await Promise.all([randomEdits(a, 2026, 200), randomEdits(b, 31337, 200)])
  test.info().annotations.push({ type: 'tab A', description: JSON.stringify(ranA) }, { type: 'tab B', description: JSON.stringify(ranB) })

  await settle(tabs)
  const [designA, designB] = await Promise.all([designOf(a), designOf(b)])
  expect(designA).toBe(designB)
  const [hashA, hashB] = await Promise.all([exportHashOf(a), exportHashOf(b)])
  expect(hashA).toBe(hashB)

  writeOutput('two-tabs-a.png', await a.getByTestId('stage').screenshot())
  writeOutput('two-tabs-b.png', await b.getByTestId('stage').screenshot())
  writeOutput('two-tabs.json', JSON.stringify({ tabA: ranA, tabB: ranB, exportSha256: hashA, layers: Object.keys(JSON.parse(designA).nodes).length }, null, 2))
  expect(errors).toEqual([])
})

test("each tab's undo leaves the other tab's edits intact", async ({ browser }) => {
  const { tabs, errors } = await openTabs(browser, 2)
  const [a, b] = tabs as [Page, Page]
  await a.evaluate(() => window.razzlr?.session.run('node.update', { ids: ['box'], patch: { x: 500 } }))
  await b.evaluate(() => window.razzlr?.session.run('node.update', { ids: ['dot'], patch: { x: 300 } }))
  await b.evaluate(() => window.razzlr?.session.run('text.edit', { id: 'headline', op: { kind: 'insert', at: 11, text: '!' } }))
  await settle(tabs)

  await a.evaluate(() => window.razzlr?.session.undo())
  await settle(tabs)
  for (const tab of tabs) {
    const design = JSON.parse(await designOf(tab))
    expect(design.nodes.box.props.x).toBe(80)
    expect(design.nodes.dot.props.x).toBe(300)
    expect(design.nodes.headline.props.text).toBe('Summer sale!')
  }

  await b.evaluate(() => window.razzlr?.session.undo())
  await settle(tabs)
  for (const tab of tabs) {
    const design = JSON.parse(await designOf(tab))
    expect(design.nodes.box.props.x).toBe(80)
    expect(design.nodes.dot.props.x).toBe(300)
    expect(design.nodes.headline.props.text).toBe('Summer sale')
  }
  expect(errors).toEqual([])
})

test('a real mouse drag and real typing in one tab show up in the other, and undo as one step each', async ({ browser }) => {
  const { tabs, errors } = await openTabs(browser, 2)
  const [a, b] = tabs as [Page, Page]
  writeOutput('real-input-0-start.png', await a.screenshot())

  // Drag the box from its centre 200 design pixels right and 100 down, in small steps.
  const from = await screenPoint(a, 230, 180)
  const to = await screenPoint(a, 430, 280)
  await a.mouse.move(from.x, from.y)
  await a.mouse.down()
  for (let i = 1; i <= 20; i++) await a.mouse.move(from.x + ((to.x - from.x) * i) / 20, from.y + ((to.y - from.y) * i) / 20)
  await expect(a.locator('.selection[data-layer="box"]')).toBeVisible()
  writeOutput('real-input-1-dragging.png', await a.screenshot())
  await a.mouse.up()
  await settle(tabs)
  const dragged = JSON.parse(await designOf(b)).nodes.box.props
  expect(Math.abs(dragged.x - 280)).toBeLessThanOrEqual(1)
  expect(Math.abs(dragged.y - 180)).toBeLessThanOrEqual(1)
  writeOutput('real-input-2-dragged-tab-b.png', await b.screenshot())

  // Double-click past the end of the headline, type, and see it arrive in tab B.
  const end = await screenPoint(a, 700, 540)
  await a.mouse.dblclick(end.x, end.y)
  await expect(a.locator('.caret')).toBeVisible()
  await a.keyboard.type(' now on')
  await a.keyboard.press('Backspace')
  await a.keyboard.press('Backspace')
  await a.keyboard.press('Backspace')
  await settle(tabs)
  expect(JSON.parse(await designOf(b)).nodes.headline.props.text).toBe('Summer sale now')
  writeOutput('real-input-3-typed-tab-a.png', await a.screenshot())
  writeOutput('real-input-4-typed-tab-b.png', await b.screenshot())

  // Backspace in the Arabic line takes one grapheme, from the end of the text in logical order.
  const arabicEnd = await screenPoint(a, 120, 720)
  await a.keyboard.press('Escape')
  await a.mouse.dblclick(arabicEnd.x, arabicEnd.y)
  await a.keyboard.press('Backspace')
  await settle(tabs)
  expect(JSON.parse(await designOf(b)).nodes.arabic.props.text).toBe('تخفيضات الصي')

  // Each undo takes back one whole gesture: the Arabic backspace, then all the typing, then the drag.
  const undo = async (expected: { arabic: string; headline: string; x: number }) => {
    await a.keyboard.press('Control+z')
    await settle(tabs)
    const nodes = JSON.parse(await designOf(b)).nodes
    expect({ arabic: nodes.arabic.props.text, headline: nodes.headline.props.text, x: Math.round(nodes.box.props.x) }).toEqual(expected)
  }
  await undo({ arabic: 'تخفيضات الصيف', headline: 'Summer sale now', x: 280 })
  await undo({ arabic: 'تخفيضات الصيف', headline: 'Summer sale', x: 280 })
  await undo({ arabic: 'تخفيضات الصيف', headline: 'Summer sale', x: 80 })
  writeOutput('real-input-5-undone-tab-b.png', await b.screenshot())
  expect(errors).toEqual([])
})

test('latency from a command in tab A to the redraw in tab B', async ({ browser }) => {
  const { tabs, errors } = await openTabs(browser, 2)
  const [a, b] = tabs as [Page, Page]
  const samples: number[] = []
  for (let i = 0; i < 60; i++) {
    const x = 100 + i
    const seen = b.evaluate((x) => new Promise<number>((resolve) => {
      const stop = window.razzlr?.onDraw((design, at) => {
        if (design.nodes.box?.props.x !== x) return
        stop?.()
        resolve(at)
      })
    }), x)
    // Let tab B's listener be in place before tab A sends.
    await b.evaluate(() => new Promise((resolve) => requestAnimationFrame(resolve)))
    const sent = await a.evaluate((x) => {
      const at = performance.timeOrigin + performance.now()
      window.razzlr?.session.run('node.update', { ids: ['box'], patch: { x } })
      return at
    }, x)
    samples.push((await seen) - sent)
  }
  const warm = samples.slice(10).sort((p, q) => p - q)
  const at = (share: number) => warm[Math.min(warm.length - 1, Math.floor(share * warm.length))] as number
  const report = { samples: warm.length, medianMs: Math.round(at(0.5) * 10) / 10, p95Ms: Math.round(at(0.95) * 10) / 10, maxMs: Math.round(at(1) * 10) / 10 }
  test.info().annotations.push({ type: 'latency', description: JSON.stringify(report) })
  writeOutput('latency.json', JSON.stringify({ ...report, note: 'Both tabs and the sync server on one machine; the first 10 sends are warm-up and left out.', allMs: samples }, null, 2))
  console.log(`tab A command → tab B redraw: median ${report.medianMs} ms, p95 ${report.p95Ms} ms over ${report.samples} edits`)
  expect(report.p95Ms).toBeLessThan(1000)
  expect(errors).toEqual([])
})

test('a design survives the sync server restarting, from Postgres', async ({ browser }) => {
  const { designId, tabs, errors } = await openTabs(browser, 1)
  const [a] = tabs as [Page]
  await a.evaluate(() => {
    window.razzlr?.session.run('node.update', { ids: ['dot'], patch: { x: 420, y: 640 } })
    window.razzlr?.session.run('text.edit', { id: 'headline', op: { kind: 'insert', at: 11, text: ' today' } })
  })
  await settle(tabs)
  const before = await designOf(a)
  // Closing the last tab makes the server store the design at once, without waiting for the debounce.
  await a.context().close()
  restartSyncServer()

  const reopened = await openTabs(browser, 1, designId)
  const [b] = reopened.tabs as [Page]
  expect(await designOf(b)).toBe(before)
  expect(JSON.parse(before).nodes.headline.props.text).toBe('Summer sale today')
  writeOutput('after-restart.png', await b.screenshot())
  expect([...errors, ...reopened.errors]).toEqual([])
})
