// Every canvas gesture against every kind of container, in two formats, with real pointer and
// keyboard input (#232). Each gesture is checked against what it should do: a move moves the layer
// by the drag, a resize sizes it (scaling a group's or boolean's layers, never a frame's), the
// other format stays as it was, auto layout keeps placing its flow, the gesture is one undo step,
// and nothing logs an error. Failures that have a ticket of their own are listed in KNOWN; the
// table of results is written to output/gesture-matrix.md.
import { expect, test, type Page } from '../support/test.ts'
import { pressFor, type ShortcutAction } from '@dazbee/editor/shortcuts'
import type { DesignInput } from '@dazbee/schema'
import { photo, upload } from '../support/assets.ts'
import { designOf, writeOutput } from '../support/editor.ts'
import { openStage } from '../support/stage.ts'

test.describe.configure({ timeout: 600_000 })

type Node = DesignInput['nodes'][string]
const rect = (name: string, parentId: string, index: string, x: number, y: number, width: number, height: number, color: string, extra: Record<string, unknown> = {}): Node =>
  ({ type: 'graphic', parentId, index, name, props: { x, y, width, height, shape: { kind: 'rect' }, fills: [{ type: 'solid', color }], ...extra } }) as Node

/** One page holding a layer of each kind, spread out so each can be pressed on its own. */
const design = (assetId: string): DesignInput => ({
  meta: { schemaVersion: 3, designId: 'replaced-by-the-api', name: 'Gesture matrix', kind: 'single', primaryFormatId: 'sq' },
  formats: { sq: { name: 'Square', width: 1080, height: 1080, order: 'a0' }, wide: { name: 'Wide', width: 1920, height: 1080, order: 'a1' } },
  pages: { p1: { name: 'Page 1', order: 'a0', fills: [{ type: 'solid', color: '#FFFFFFFF' }] } },
  nodes: {
    shape: rect('Shape', 'p1', 'a0', 40, 40, 120, 120, '#FF2E7EFF'),
    group: { type: 'group', parentId: 'p1', index: 'a1', name: 'Group', props: { x: 200, y: 40, width: 200, height: 120 } },
    gA: rect('Group A', 'group', 'a0', 200, 40, 90, 120, '#2F6BFFFF'),
    gB: rect('Group B', 'group', 'a1', 310, 40, 90, 120, '#FFB020FF'),
    frame: { type: 'frame', parentId: 'p1', index: 'a2', name: 'Frame', props: { x: 440, y: 40, width: 200, height: 140, fills: [{ type: 'solid', color: '#EEF1F6FF' }] } },
    fInner: rect('Frame inner', 'frame', 'a0', 460, 60, 100, 80, '#9747FFFF'),
    auto: {
      type: 'frame', parentId: 'p1', index: 'a3', name: 'Auto layout',
      props: { x: 40, y: 240, width: 560, height: 160, sizing: { width: 'fixed', height: 'hug' }, fills: [{ type: 'solid', color: '#E6F4EFFF' }], layout: { direction: 'row', gap: 20, padding: { top: 20, right: 20, bottom: 20, left: 20 } } },
    },
    aFixed: rect('Flow fixed', 'auto', 'a0', 0, 0, 120, 120, '#00A88AFF'),
    aFill: rect('Flow fill', 'auto', 'a1', 0, 0, 100, 120, '#1F2329FF', { sizing: { width: 'fill', height: 'fixed' } }),
    aHug: {
      type: 'frame', parentId: 'auto', index: 'a2', name: 'Flow hug',
      props: { x: 0, y: 0, width: 10, height: 10, sizing: { width: 'hug', height: 'hug' }, fills: [{ type: 'solid', color: '#FFB020FF' }], layout: { direction: 'row', padding: { top: 30, right: 30, bottom: 30, left: 30 } } },
    },
    aHugIn: rect('Hug inner', 'aHug', 'a0', 0, 0, 60, 60, '#FF2E7EFF'),
    aAbs: rect('Flow absolute', 'auto', 'a3', 500, 330, 60, 60, '#2F6BFFFF', { absolute: true }),
    bool: { type: 'boolean', parentId: 'p1', index: 'a4', name: 'Boolean', props: { x: 680, y: 40, width: 200, height: 140, op: 'union', fills: [{ type: 'solid', color: '#FF7A2EFF' }] } },
    bA: rect('Bool A', 'bool', 'a0', 680, 40, 140, 100, '#000000FF'),
    bB: rect('Bool B', 'bool', 'a1', 740, 80, 140, 100, '#000000FF'),
    maskGroup: { type: 'group', parentId: 'p1', index: 'a5', name: 'Masked', props: { x: 680, y: 260, width: 200, height: 160 } },
    mask: { type: 'graphic', parentId: 'maskGroup', index: 'a0', name: 'Mask', props: { x: 680, y: 260, width: 200, height: 160, shape: { kind: 'ellipse' }, fills: [{ type: 'solid', color: '#000000FF' }], mask: 'alpha' } },
    masked: rect('Masked', 'maskGroup', 'a1', 680, 260, 200, 160, '#00A88AFF'),
    tWide: { type: 'text', parentId: 'p1', index: 'a6', name: 'Auto width', props: { x: 40, y: 460, width: 300, height: 60, text: 'Auto width', boxMode: 'autoWidth', style: { fontFamily: 'Noto Sans', fontSize: 44, fontWeight: 700, color: '#1F2329FF' } } },
    tTall: { type: 'text', parentId: 'p1', index: 'a7', name: 'Auto height', props: { x: 40, y: 560, width: 320, height: 60, text: 'Auto height text', boxMode: 'autoHeight', style: { fontFamily: 'Noto Sans', fontSize: 40, fontWeight: 700, color: '#1F2329FF' } } },
    tFixed: { type: 'text', parentId: 'p1', index: 'a8', name: 'Fixed', props: { x: 40, y: 680, width: 320, height: 120, text: 'Fixed box', boxMode: 'fixed', style: { fontFamily: 'Noto Sans', fontSize: 40, fontWeight: 700, color: '#1F2329FF' } } },
    photo: { type: 'graphic', parentId: 'p1', index: 'a9', name: 'Photo', props: { x: 440, y: 460, width: 300, height: 200, shape: { kind: 'rect' }, fills: [{ type: 'image', assetId, fit: 'crop', crop: { x: 200, y: 100, width: 1200, height: 800 } }] } },
    turned: { type: 'frame', parentId: 'p1', index: 'b0', name: 'Turned frame', props: { x: 800, y: 600, width: 200, height: 140, rotation: 20, clip: false, fills: [{ type: 'solid', color: '#E8E0FFFF' }] } },
    tInner: rect('Turned inner', 'turned', 'a0', 830, 630, 90, 60, '#9747FFFF'),
  },
  overrides: {},
})

/** The layers the matrix acts on, each selected alone. `entered` ones are inside a container. */
const SUBJECTS = [
  'shape', 'group', 'gA', 'frame', 'fInner', 'auto', 'aFixed', 'aFill', 'aHug', 'aAbs', 'bool', 'mask', 'masked', 'tWide', 'tTall', 'tFixed', 'photo', 'turned', 'tInner',
] as const
type Subject = (typeof SUBJECTS)[number]
const GROUPS: Record<string, readonly string[]> = { group: ['gA', 'gB'], bool: ['bA', 'bB'], maskGroup: ['mask', 'masked'], frame: ['fInner'], auto: ['aFixed', 'aFill', 'aHug', 'aAbs'], aHug: ['aHugIn'], turned: ['tInner'] }
const FLOW = new Set(['aFixed', 'aFill', 'aHug'])
const LEAVES = ['shape', 'gA', 'gB', 'fInner', 'aFixed', 'aFill', 'aHugIn', 'aAbs', 'bA', 'bB', 'mask', 'masked', 'tWide', 'tTall', 'tFixed', 'photo', 'tInner']

const GESTURES = ['move', 'resize-e', 'resize-se', 'resize-w', 'rotate', 'nudge', 'align', 'duplicate', 'paste', 'group', 'frame-selection', 'ungroup', 'delete'] as const
type Gesture = (typeof GESTURES)[number]

/** Failures that have their own ticket: `subject gesture format` → issue number. */
const KNOWN: Record<string, number> = Object.fromEntries([
  ...['aFill', 'aHug', 'aAbs'].flatMap((subject) => ['group', 'frame-selection'].flatMap((gesture) => ['sq', 'wide'].map((format) => [`${subject} ${gesture} ${format}`, 233]))),
  ...['sq', 'wide'].map((format) => [`mask move ${format}`, 234]),
])
/** Layers turned on the page as drawn, by degrees: a handle dragged along the page sizes them by the part along their side. */
const TURNED: Record<string, number> = { turned: 20, tInner: 20 }

type Box = { x: number; y: number; width: number; height: number }
type Boxes = Record<string, Box | null>

async function boxesIn(page: Page, formatId: string, ids: string[]): Promise<Boxes> {
  return page.evaluate(({ formatId, ids }) => Object.fromEntries(ids.map((id) => [id, window.dazbee?.boxOf(id, 'p1', formatId) ?? null])), { formatId, ids })
}
const point = (page: Page, x: number, y: number, formatId: string) =>
  page.evaluate(({ x, y, formatId }) => window.dazbee?.screenPoint(x, y, 'p1', formatId), { x, y, formatId }) as Promise<{ x: number; y: number }>
const zoomOf = (page: Page) => page.evaluate(() => window.dazbee?.camera().zoom ?? 1)
const drawn = (page: Page) => page.evaluate(() => window.dazbee?.drawn())
const press = async (page: Page, action: ShortcutAction) => {
  await page.keyboard.press(pressFor(action))
  await drawn(page)
}
async function dragScreen(page: Page, a: { x: number; y: number }, b: { x: number; y: number }) {
  await page.mouse.move(a.x, a.y)
  await page.mouse.down()
  await page.mouse.move((a.x + b.x) / 2, (a.y + b.y) / 2, { steps: 3 })
  await page.mouse.move(b.x, b.y, { steps: 3 })
  await page.mouse.up()
  await drawn(page)
}
async function handleAt(page: Page, which: string) {
  const box = await page.locator(`.selection .handle[data-handle="${which}"]`).boundingBox()
  return box && { x: box.x + box.width / 2, y: box.y + box.height / 2 }
}
const close = (a: number, b: number, tol = 0.6) => Math.abs(a - b) <= tol

/** Runs one gesture on the selected layer; returns what went wrong, or null. */
async function run(page: Page, subject: Subject, gesture: Gesture, formatId: string, other: string): Promise<string | null> {
  const ids = [...LEAVES, ...Object.keys(GROUPS)]
  const before = await boxesIn(page, formatId, ids)
  const beforeOther = await boxesIn(page, other, ids)
  const json = await designOf(page)
  const count = Object.keys(JSON.parse(json).nodes).length
  const box = before[subject]
  if (!box) return 'no box before'
  const zoom = await zoomOf(page)
  // A group's middle may be a gap between its layers: it is pressed on its first one.
  const grip = GROUPS[subject] && subject !== 'auto' && subject !== 'frame' && subject !== 'turned' ? before[GROUPS[subject]?.[0] ?? ''] ?? box : box
  const centre = await point(page, grip.x + grip.width / 2, grip.y + grip.height / 2, formatId)
  const inside = (GROUPS[subject] ?? []).flatMap((id) => [id, ...(GROUPS[id] ?? [])])
  switch (gesture) {
    case 'move': await dragScreen(page, centre, { x: centre.x + 30 * zoom, y: centre.y + 20 * zoom })
      break
    case 'resize-e': case 'resize-se': case 'resize-w': {
      const which = gesture.slice(7)
      const at = await handleAt(page, which)
      if (!at) return `no ${which} handle`
      const dx = which === 'w' ? -40 : 40
      await dragScreen(page, at, { x: at.x + dx * zoom, y: at.y + (which === 'se' ? 30 * zoom : 0) })
      break
    }
    case 'rotate': {
      const at = await handleAt(page, 'ne')
      if (!at) return 'no ne handle'
      await dragScreen(page, { x: at.x + 12, y: at.y - 12 }, { x: at.x + 40, y: at.y + 30 })
      break
    }
    case 'nudge': await press(page, 'nudgeRight')
      break
    case 'align': await press(page, 'alignLeft')
      break
    case 'duplicate': await press(page, 'duplicate')
      break
    case 'paste':
      await page.keyboard.press('Control+KeyC')
      await page.keyboard.press('Control+KeyV')
      await drawn(page)
      break
    case 'group': await press(page, 'group')
      break
    case 'frame-selection': await press(page, 'frameSelection')
      break
    case 'ungroup': await press(page, 'ungroup')
      break
    case 'delete': await press(page, 'delete')
      break
  }
  const after = await boxesIn(page, formatId, ids)
  const afterOther = await boxesIn(page, other, ids)
  const now = JSON.parse(await designOf(page)) as { nodes: Record<string, { parentId: string; props: Record<string, unknown> }> }
  const problems: string[] = []
  const moved = (id: string) => {
    const a = before[id]
    const b = after[id]
    return !a || !b ? false : !close(a.x, b.x) || !close(a.y, b.y) || !close(a.width, b.width) || !close(a.height, b.height)
  }
  // What shouldn't change: every layer the gesture doesn't act on, nor what holds the subject.
  const acts = new Set<string>([subject, ...inside])
  const holders = Object.entries(GROUPS).filter(([, kids]) => kids.includes(subject)).map(([id]) => id)
  const flowSiblings = FLOW.has(subject) || subject === 'auto' ? [...FLOW, 'aHugIn', ...holders] : []
  const untouched = ids.filter((id) => !acts.has(id) && !holders.includes(id) && !flowSiblings.includes(id))
  const placement = ['move', 'resize-e', 'resize-se', 'resize-w', 'rotate', 'nudge', 'align'].includes(gesture)
  // Moving layers in a flow reorders it, and a layer's order is the same in every format.
  const reorders = FLOW.has(subject) && (gesture === 'move' || gesture === 'nudge')
  if (placement) {
    for (const id of untouched) if (moved(id)) problems.push(`${id} changed`)
    // The other format stays as it was.
    for (const id of ids.filter((id) => !reorders || !flowSiblings.includes(id))) {
      const a = beforeOther[id]
      const b = afterOther[id]
      if (a && b && (!close(a.x, b.x) || !close(a.y, b.y) || !close(a.width, b.width) || !close(a.height, b.height))) problems.push(`${id} changed in ${other}`)
    }
  }
  const b = after[subject]
  if (gesture === 'move' && b && !FLOW.has(subject) && (!close(b.x, box.x + 30, 1) || !close(b.y, box.y + 20, 1))) problems.push(`moved to ${b.x},${b.y}, not by 30,20`)
  const along = 40 * Math.cos(((TURNED[subject] ?? 0) * Math.PI) / 180)
  if ((gesture === 'resize-e' || gesture === 'resize-w') && b && !close(b.width, box.width + along, 1.5)) problems.push(`width ${b.width}, not ${box.width + along}`)
  if (gesture === 'resize-se' && b && !close(b.height, box.height + 30, 1.5) && !subject.startsWith('t')) problems.push(`height ${b.height}, not ${box.height + 30}`)
  if (gesture.startsWith('resize') && b) {
    // A frame's layers keep their size; a group's or boolean's scale with it.
    const scaled = subject === 'group' || subject === 'bool'
    for (const id of inside.filter((id) => !FLOW.has(id) || subject !== 'auto')) {
      const was = before[id]
      const is = after[id]
      if (!was || !is) continue
      if (!scaled && id !== 'aFill' && (!close(was.width, is.width) || !close(was.height, is.height))) problems.push(`${id} resized inside a frame`)
    }
    if (FLOW.has(subject)) {
      const auto = after.auto
      if (auto && b && (b.x < auto.x - 0.5 || b.y < auto.y - 0.5)) problems.push('left its flow')
    }
  }
  if (gesture === 'nudge' && b && !FLOW.has(subject) && !close(b.x, box.x + 1)) problems.push(`nudged to ${b.x}, not ${box.x + 1}`)
  if (gesture === 'duplicate' || gesture === 'paste') {
    if (Object.keys(now.nodes).length <= count) problems.push('no copy')
  }
  if (gesture === 'delete' && now.nodes[subject]) problems.push('not deleted')
  if (['group', 'frame-selection', 'ungroup'].includes(gesture)) {
    for (const id of LEAVES) {
      const was = before[id]
      const is = after[id]
      if (was && is && (!close(was.x, is.x) || !close(was.y, is.y) || !close(was.width, is.width) || !close(was.height, is.height))) problems.push(`${id} moved`)
    }
  }
  // One undo step puts everything back.
  await page.keyboard.press(pressFor('undo'))
  await drawn(page)
  if (await designOf(page) !== json) {
    problems.push('one undo did not put it back')
    // Back to where the next gesture starts, however many steps it took.
    for (let i = 0; i < 5 && await designOf(page) !== json; i++) {
      await page.keyboard.press(pressFor('undo'))
      await drawn(page)
    }
  }
  return problems.length > 0 ? problems.join('; ') : null
}

test('every canvas gesture against every container, in two formats', async ({ browser }) => {
  const asset = await upload(photo)
  const { page, errors } = await openStage(browser, design(asset.id))
  await page.setViewportSize({ width: 1600, height: 1000 })
  await page.evaluate(() => window.dazbee?.setSnapping(false))
  const rows: { key: string; result: string }[] = []
  const unexpected: string[] = []
  for (const [formatId, other] of [['sq', 'wide'], ['wide', 'sq']] as const) {
    await page.evaluate((formatId) => {
      const editor = window.dazbee
      if (!editor) return
      editor.fitFrame('p1', formatId)
    }, formatId)
    await drawn(page)
    for (const subject of SUBJECTS) {
      for (const gesture of GESTURES) {
        await page.evaluate(({ subject, formatId }) => window.dazbee?.select([subject], 'p1', formatId), { subject, formatId })
        await drawn(page)
        const errorsBefore = errors.length
        const problem = await run(page, subject, gesture, formatId, other)
        const logged = errors.length > errorsBefore ? `errors: ${errors.slice(errorsBefore).join(' | ')}` : null
        const failure = [problem, logged].filter(Boolean).join('; ') || null
        const key = `${subject} ${gesture} ${formatId}`
        const ticket = KNOWN[key]
        rows.push({ key, result: failure ? (ticket ? `#${ticket}` : `FAIL: ${failure}`) : (ticket ? `pass (fixed? #${ticket})` : 'pass') })
        if (failure && !ticket) unexpected.push(`${key}: ${failure}`)
        if (!failure && ticket) unexpected.push(`${key}: passes now; take #${ticket} out of KNOWN`)
        errors.length = errorsBefore
      }
    }
  }
  const table = ['| Layer | Gesture | Format | Result |', '|---|---|---|---|', ...rows.map(({ key, result }) => `| ${key.split(' ').join(' | ')} | ${result} |`)].join('\n')
  writeOutput('gesture-matrix.md', `${table}\n`)
  console.log(`gesture matrix: ${rows.length} cases, ${rows.filter((r) => r.result === 'pass').length} pass, ${unexpected.length} unexpected`)
  expect(unexpected).toEqual([])
})
