// The canvas gesture matrix (#232): every canvas gesture against every kind of container, in one
// format of a design that has two, with real pointer and keyboard input. Each gesture is checked
// against what it should do: a move moves the layer by the drag, a resize sizes it from the handle
// dragged (scaling a group's or boolean's layers, never a frame's), a turn turns it, align lines it
// up, the other format stays as it was, auto layout keeps placing its flow (a drag or an arrow
// moves a layer along it, and what it decides is said), the gesture is one undo step, and nothing
// logs an error. Failures that have a ticket of their own are listed in KNOWN.
import { pressFor, type ShortcutAction } from '@dazbee/editor/shortcuts'
import type { DesignInput } from '@dazbee/schema'
import type { Browser, Page } from '@playwright/test'
import { upload, photo } from './assets.ts'
import { designOf } from './editor.ts'
import { openStage } from './stage.ts'

type Node = DesignInput['nodes'][string]
const rect = (name: string, parentId: string, index: string, x: number, y: number, width: number, height: number, color: string, extra: Record<string, unknown> = {}): Node =>
  ({ type: 'graphic', parentId, index, name, props: { x, y, width, height, shape: { kind: 'rect' }, fills: [{ type: 'solid', color }], ...extra } }) as Node
const row = (direction: 'row' | 'column', gap = 20, pad = 20) => ({ direction, gap, padding: { top: pad, right: pad, bottom: pad, left: pad } })

/** One page holding a layer of each kind, spread out so each can be pressed on its own. */
export const matrixDesign = (assetId: string): DesignInput => ({
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
      props: { x: 40, y: 240, width: 560, height: 160, sizing: { width: 'fixed', height: 'hug' }, fills: [{ type: 'solid', color: '#E6F4EFFF' }], layout: row('row') },
    },
    aFixed: rect('Flow fixed', 'auto', 'a0', 0, 0, 120, 120, '#00A88AFF'),
    aFill: rect('Flow fill', 'auto', 'a1', 0, 0, 100, 120, '#1F2329FF', { sizing: { width: 'fill', height: 'fixed' } }),
    aHug: {
      type: 'frame', parentId: 'auto', index: 'a2', name: 'Flow hug',
      props: { x: 0, y: 0, width: 10, height: 10, sizing: { width: 'hug', height: 'hug' }, fills: [{ type: 'solid', color: '#FFB020FF' }], layout: row('row', 0, 30) },
    },
    aHugIn: rect('Hug inner', 'aHug', 'a0', 0, 0, 60, 60, '#FF2E7EFF'),
    aAbs: rect('Flow absolute', 'auto', 'a3', 520, 330, 60, 60, '#2F6BFFFF', { absolute: true }),
    col: {
      type: 'frame', parentId: 'p1', index: 'a4', name: 'Column',
      props: { x: 920, y: 240, width: 140, height: 10, sizing: { width: 'fixed', height: 'hug' }, fills: [{ type: 'solid', color: '#FFF0D6FF' }], layout: row('column', 10, 10) },
    },
    colA: rect('Column A', 'col', 'a0', 0, 0, 120, 60, '#FF7A2EFF'),
    colB: rect('Column B', 'col', 'a1', 0, 0, 120, 60, '#2F6BFFFF'),
    bool: { type: 'boolean', parentId: 'p1', index: 'a5', name: 'Boolean', props: { x: 680, y: 40, width: 200, height: 140, op: 'union', fills: [{ type: 'solid', color: '#FF7A2EFF' }] } },
    bA: rect('Bool A', 'bool', 'a0', 680, 40, 140, 100, '#000000FF'),
    bB: rect('Bool B', 'bool', 'a1', 740, 80, 140, 100, '#000000FF'),
    maskGroup: { type: 'group', parentId: 'p1', index: 'a6', name: 'Masked', props: { x: 680, y: 260, width: 200, height: 160 } },
    mask: { type: 'graphic', parentId: 'maskGroup', index: 'a0', name: 'Mask', props: { x: 680, y: 260, width: 200, height: 160, shape: { kind: 'ellipse' }, fills: [{ type: 'solid', color: '#000000FF' }], mask: 'alpha' } },
    masked: rect('Masked', 'maskGroup', 'a1', 680, 260, 200, 160, '#00A88AFF'),
    tWide: { type: 'text', parentId: 'p1', index: 'a7', name: 'Auto width', props: { x: 40, y: 460, width: 300, height: 60, text: 'Auto width', boxMode: 'autoWidth', style: { fontFamily: 'Noto Sans', fontSize: 44, fontWeight: 700, color: '#1F2329FF' } } },
    tTall: { type: 'text', parentId: 'p1', index: 'a8', name: 'Auto height', props: { x: 40, y: 560, width: 320, height: 60, text: 'Auto height text', boxMode: 'autoHeight', style: { fontFamily: 'Noto Sans', fontSize: 40, fontWeight: 700, color: '#1F2329FF' } } },
    tFixed: { type: 'text', parentId: 'p1', index: 'a9', name: 'Fixed', props: { x: 40, y: 680, width: 320, height: 120, text: 'Fixed box', boxMode: 'fixed', style: { fontFamily: 'Noto Sans', fontSize: 40, fontWeight: 700, color: '#1F2329FF' } } },
    photo: { type: 'graphic', parentId: 'p1', index: 'b0', name: 'Photo', props: { x: 440, y: 460, width: 300, height: 200, shape: { kind: 'rect' }, fills: [{ type: 'image', assetId, fit: 'crop', crop: { x: 200, y: 100, width: 1200, height: 800 } }] } },
    turned: { type: 'frame', parentId: 'p1', index: 'b1', name: 'Turned frame', props: { x: 800, y: 600, width: 200, height: 140, rotation: 20, clip: false, fills: [{ type: 'solid', color: '#E8E0FFFF' }] } },
    tInner: rect('Turned inner', 'turned', 'a0', 830, 630, 90, 60, '#9747FFFF'),
    autoTurned: {
      type: 'frame', parentId: 'p1', index: 'b2', name: 'Turned auto layout',
      props: { x: 440, y: 860, width: 300, height: 100, rotation: 10, fills: [{ type: 'solid', color: '#E6F4EFFF' }], layout: row('row', 10, 10) },
    },
    atA: rect('Turned flow A', 'autoTurned', 'a0', 0, 0, 80, 80, '#FF2E7EFF'),
    atB: rect('Turned flow B', 'autoTurned', 'a1', 0, 0, 80, 80, '#2F6BFFFF'),
  },
  overrides: {},
})

/** The layers the matrix acts on, each selected alone (or with two beside it, to distribute). */
export const SUBJECTS = [
  'shape', 'group', 'gA', 'frame', 'fInner', 'auto', 'aFixed', 'aFill', 'aHug', 'aAbs', 'col', 'colA', 'bool', 'mask', 'masked',
  'tWide', 'tTall', 'tFixed', 'photo', 'turned', 'tInner', 'autoTurned', 'atA',
] as const
type Subject = (typeof SUBJECTS)[number]
/** What each container holds. */
const HOLDS: Record<string, readonly string[]> = {
  group: ['gA', 'gB'], bool: ['bA', 'bB'], maskGroup: ['mask', 'masked'], frame: ['fInner'], auto: ['aFixed', 'aFill', 'aHug', 'aAbs'], aHug: ['aHugIn'],
  turned: ['tInner'], col: ['colA', 'colB'], autoTurned: ['atA', 'atB'],
}
/** Each layer auto layout places, by the frame whose flow it is in. */
const FLOW: Record<string, string> = { aFixed: 'auto', aFill: 'auto', aHug: 'auto', colA: 'col', colB: 'col', atA: 'autoTurned', atB: 'autoTurned' }
const AUTO = new Set(['auto', 'aHug', 'col', 'autoTurned'])
const TEXT = new Set(['tWide', 'tTall', 'tFixed'])
/** Layers turned on the page as drawn, by degrees: a handle dragged along the page sizes them by the part along their side. */
const TURNED: Record<string, number> = { turned: 20, tInner: 20, autoTurned: 10, atA: 10 }
/** Two layers beside each subject that can be distributed with it. */
const BESIDE: Record<string, [string, string]> = {
  shape: ['group', 'frame'], group: ['shape', 'frame'], frame: ['shape', 'group'], bool: ['shape', 'group'], photo: ['shape', 'group'],
  aFixed: ['aFill', 'aHug'], aFill: ['aFixed', 'aHug'], aHug: ['aFixed', 'aFill'],
}
const LEAVES = ['shape', 'gA', 'gB', 'fInner', 'aFixed', 'aFill', 'aHugIn', 'aAbs', 'colA', 'colB', 'bA', 'bB', 'mask', 'masked', 'tWide', 'tTall', 'tFixed', 'photo', 'tInner', 'atA', 'atB']
const ALL = [...LEAVES, ...Object.keys(HOLDS)]

const HANDLES: Record<string, { dx: number; dy: number; w: number; h: number }> = {
  e: { dx: 40, dy: 0, w: 40, h: 0 }, w: { dx: -40, dy: 0, w: 40, h: 0 }, s: { dx: 0, dy: 30, w: 0, h: 30 }, n: { dx: 0, dy: -30, w: 0, h: 30 },
  se: { dx: 40, dy: 30, w: 40, h: 30 }, nw: { dx: -40, dy: -30, w: 40, h: 30 }, ne: { dx: 40, dy: -30, w: 40, h: 30 }, sw: { dx: -40, dy: 30, w: 40, h: 30 },
}
export const GESTURES = [
  'move', ...Object.keys(HANDLES).map((h) => `resize-${h}`), 'rotate', 'nudge', 'align', 'distribute', 'duplicate', 'paste', 'group', 'frame-selection', 'ungroup', 'delete',
] as const

/** Failures that have their own ticket: `subject gesture format` → issue number. */
const KNOWN: Record<string, number> = Object.fromEntries([
  ...['aFill', 'aHug', 'aAbs'].flatMap((s) => ['group', 'frame-selection'].flatMap((g) => ['sq', 'wide'].map((f) => [`${s} ${g} ${f}`, 233]))),
  ...['sq', 'wide'].map((f) => [`mask move ${f}`, 234]),
])

type Box = { x: number; y: number; width: number; height: number }
type Boxes = Record<string, Box | null>
type Doc = { nodes: Record<string, { parentId: string; index: string; props: Record<string, unknown> }>; overrides: Record<string, Record<string, Record<string, unknown>>> }

const boxesIn = (page: Page, formatId: string): Promise<Boxes> =>
  page.evaluate(({ formatId, ids }) => Object.fromEntries(ids.map((id) => [id, window.dazbee?.boxOf(id, 'p1', formatId) ?? null])), { formatId, ids: ALL })
const point = (page: Page, x: number, y: number, formatId: string) =>
  page.evaluate(({ x, y, formatId }) => window.dazbee?.screenPoint(x, y, 'p1', formatId), { x, y, formatId }) as Promise<{ x: number; y: number }>
const drawn = (page: Page) => page.evaluate(() => window.dazbee?.drawn())
const press = async (page: Page, action: ShortcutAction) => {
  await page.keyboard.press(pressFor(action))
  await drawn(page)
}
async function drag(page: Page, a: { x: number; y: number }, b: { x: number; y: number }) {
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
const same = (a: Box | null | undefined, b: Box | null | undefined) => !a || !b || (close(a.x, b.x) && close(a.y, b.y) && close(a.width, b.width) && close(a.height, b.height))
const flowOrder = (doc: Doc, parent: string) => Object.entries(doc.nodes).filter(([id, n]) => n.parentId === parent && FLOW[id]).sort(([, a], [, b]) => (a.index < b.index ? -1 : 1)).map(([id]) => id).join()
const notices = (page: Page) => page.evaluate(() => (window as unknown as { notices?: number }).notices ?? 0)

/** Runs one gesture on the subject; returns what went wrong, null when it did what it should, or 'n/a'. */
async function run(page: Page, subject: Subject, gesture: string, formatId: string, other: string): Promise<string | null> {
  const before = await boxesIn(page, formatId)
  const beforeOther = await boxesIn(page, other)
  const json = await designOf(page)
  const doc = JSON.parse(json) as Doc
  const count = Object.keys(doc.nodes).length
  const noticesBefore = await notices(page)
  const box = before[subject]
  if (!box) return 'no box before'
  const zoom = await page.evaluate(() => window.dazbee?.camera().zoom ?? 1)
  // A group's middle may be a gap between its layers: it is pressed on its first one.
  const grip = subject === 'group' || subject === 'bool' ? before[HOLDS[subject]?.[0] ?? ''] ?? box : box
  const centre = await point(page, grip.x + grip.width / 2, grip.y + grip.height / 2, formatId)
  const turnBy = ((TURNED[subject] ?? 0) * Math.PI) / 180
  const flowParent = FLOW[subject]
  switch (true) {
    case gesture === 'move': {
      // In a flow, a drag to its other end; anywhere else, by 30, 20.
      const flow = flowParent ? (HOLDS[flowParent] ?? []).filter((id) => FLOW[id]) : []
      const isLast = flow.at(-1) === subject
      const end = flow.filter((id) => id !== subject).map((id) => before[id]).filter((b): b is Box => b !== null).at(isLast ? 0 : -1)
      // Past that sibling's far corner, so a row or a column takes it beyond it.
      const to = end ? await point(page, isLast ? end.x + 2 : end.x + end.width - 2, isLast ? end.y + 2 : end.y + end.height - 2, formatId) : { x: centre.x + 30 * zoom, y: centre.y + 20 * zoom }
      await drag(page, centre, to)
      break
    }
    case gesture.startsWith('resize-'): {
      const which = gesture.slice(7)
      const h = HANDLES[which]
      const at = await handleAt(page, which)
      if (!h || !at) return `no ${which} handle`
      await drag(page, at, { x: at.x + h.dx * zoom, y: at.y + h.dy * zoom })
      break
    }
    case gesture === 'rotate': {
      const at = await handleAt(page, 'ne')
      if (!at) return 'no ne handle'
      await drag(page, { x: at.x + 12, y: at.y - 12 }, { x: at.x + 40, y: at.y + 30 })
      break
    }
    case gesture === 'nudge': await press(page, 'nudgeRight')
      break
    case gesture === 'align': await press(page, 'alignLeft')
      break
    case gesture === 'distribute': {
      const beside = BESIDE[subject]
      if (!beside) return 'n/a'
      await page.evaluate(({ ids, formatId }) => window.dazbee?.select(ids, 'p1', formatId), { ids: [subject, ...beside], formatId })
      await press(page, 'distributeHorizontal')
      break
    }
    case gesture === 'duplicate': await press(page, 'duplicate')
      break
    case gesture === 'paste':
      await page.keyboard.press('Control+KeyC')
      await page.keyboard.press('Control+KeyV')
      await drawn(page)
      break
    case gesture === 'group': await press(page, 'group')
      break
    case gesture === 'frame-selection': await press(page, 'frameSelection')
      break
    case gesture === 'ungroup': await press(page, 'ungroup')
      break
    case gesture === 'delete': await press(page, 'delete')
      break
  }
  const after = await boxesIn(page, formatId)
  const afterOther = await boxesIn(page, other)
  const now = JSON.parse(await designOf(page)) as Doc
  const told = (await notices(page)) > noticesBefore
  const problems: string[] = []
  const b = after[subject]
  // Who may change: the subject and what it holds, what holds it, and a flow it is in.
  const inside = (id: string): string[] => (HOLDS[id] ?? []).flatMap((kid) => [kid, ...inside(kid)])
  const holders = Object.entries(HOLDS).filter(([, kids]) => kids.includes(subject)).map(([id]) => id)
  const flowMates = flowParent ? [...inside(flowParent), flowParent] : AUTO.has(subject) ? inside(subject) : []
  const may = new Set([subject, ...inside(subject), ...holders, ...flowMates, ...(gesture === 'distribute' ? [...(BESIDE[subject] ?? []), ...(BESIDE[subject] ?? []).flatMap(inside)] : [])])
  const placement = gesture === 'move' || gesture.startsWith('resize-') || ['rotate', 'nudge', 'align', 'distribute'].includes(gesture)
  // Moving in a flow reorders it, and a layer's order is the same in every format.
  const reorders = Boolean(flowParent) && (gesture === 'move' || gesture === 'nudge')
  if (placement) {
    for (const id of ALL) if (!may.has(id) && !same(before[id], after[id])) problems.push(`${id} changed`)
    for (const id of ALL) if (!(reorders && flowMates.includes(id)) && !same(beforeOther[id], afterOther[id])) problems.push(`${id} changed in ${other}`)
  }
  if (gesture === 'move' && b) {
    if (flowParent) {
      if (flowOrder(doc, flowParent) === flowOrder(now, flowParent)) problems.push('not moved along its flow')
    } else if (!close(b.x, box.x + 30, 1) || !close(b.y, box.y + 20, 1)) problems.push(`moved to ${b.x},${b.y}, not by 30,20`)
  }
  if (gesture.startsWith('resize-') && b) {
    const which = gesture.slice(7)
    const h = HANDLES[which] as { dx: number; dy: number; w: number; h: number }
    // The drag along the layer's own sides, as it is turned.
    const sx = which.includes('e') ? 1 : which.includes('w') ? -1 : 0
    const wantW = box.width + sx * (h.dx * Math.cos(turnBy) + h.dy * Math.sin(turnBy))
    if (h.w && !close(b.width, wantW, 1.5)) problems.push(`width ${b.width}, not ${wantW}`)
    if (h.h && !TEXT.has(subject) && !turnBy && !close(b.height, box.height + h.h, 1.5)) problems.push(`height ${b.height}, not ${box.height + h.h}`)
    // A frame's layers keep their size; a group's or boolean's scale with it; a flow fills what it is given.
    const scaled = subject === 'group' || subject === 'bool'
    if (!scaled) {
      for (const id of inside(subject).filter((id) => id !== 'aFill')) if (before[id] && after[id] && (!close((before[id] as Box).width, (after[id] as Box).width) || !close((before[id] as Box).height, (after[id] as Box).height))) problems.push(`${id} resized inside a frame`)
    }
    if (AUTO.has(subject)) {
      for (const id of inside(subject).filter((id) => FLOW[id])) {
        const kid = after[id]
        if (kid && b && !turnBy && (kid.x < b.x - 0.5 || kid.y < b.y - 0.5 || kid.x + kid.width > b.x + b.width + 0.5 || kid.y + kid.height > b.y + b.height + 0.5)) problems.push(`${id} outside its frame`)
      }
    }
    if (subject === 'photo' && JSON.stringify(now.nodes.photo?.props.fills) !== JSON.stringify(doc.nodes.photo?.props.fills)) problems.push('crop changed')
  }
  if (gesture === 'rotate') {
    const turn = (d: Doc) => Number({ ...d.nodes[subject]?.props, ...d.overrides[`format:${formatId}`]?.[subject] }.rotation ?? 0)
    if (close(turn(doc), turn(now), 0.5)) problems.push('not turned')
  }
  if (gesture === 'nudge' && b) {
    if (flowParent) {
      if (flowOrder(doc, flowParent) === flowOrder(now, flowParent) && !told) problems.push('nothing moved and nothing said')
    } else if (!close(b.x, box.x + 1)) problems.push(`nudged to ${b.x}, not ${box.x + 1}`)
  }
  if (gesture === 'align' && b) {
    if (flowParent) {
      if (!told) problems.push('a flow layer, and nothing said')
    } else {
      const holder = holders[0] && before[holders[0]]
      const left = holder ? holder.x : 0
      if (!close(b.x, left, 1) && !turnBy && !holders.includes('turned')) problems.push(`left at ${b.x}, not ${left}`)
    }
  }
  if (gesture === 'distribute' && flowParent && !told) problems.push('a flow layer, and nothing said')
  if ((gesture === 'duplicate' || gesture === 'paste') && Object.keys(now.nodes).length <= count) problems.push('no copy')
  if ((gesture === 'group' || gesture === 'frame-selection') && Object.keys(now.nodes).length !== count + 1) problems.push('no new container')
  if (gesture === 'ungroup' && (subject === 'group' || subject === 'bool') && now.nodes[subject]) problems.push('still there')
  if (gesture === 'delete' && now.nodes[subject]) problems.push('not deleted')
  if (['group', 'frame-selection', 'ungroup'].includes(gesture)) for (const id of LEAVES) if (!same(before[id], after[id])) problems.push(`${id} moved`)
  // One undo step puts everything back.
  await page.keyboard.press(pressFor('undo'))
  await drawn(page)
  if (await designOf(page) !== json) {
    problems.push('one undo did not put it back')
    for (let i = 0; i < 5 && await designOf(page) !== json; i++) {
      await page.keyboard.press(pressFor('undo'))
      await drawn(page)
    }
  }
  return problems.length > 0 ? problems.join('; ') : null
}

/** Runs the matrix in one format; returns the table's rows and what failed without a ticket. */
export async function runMatrix(browser: Browser, formatId: 'sq' | 'wide') {
  const other = formatId === 'sq' ? 'wide' : 'sq'
  const asset = await upload(photo)
  const opened = await openStage(browser, matrixDesign(asset.id))
  const { page } = opened
  await page.setViewportSize({ width: 1600, height: 1000 })
  await page.evaluate((formatId) => {
    const editor = window.dazbee
    if (!editor) return
    editor.setSnapping(false)
    editor.fitFrame('p1', formatId)
    const counter = window as unknown as { notices: number }
    counter.notices = 0
    editor.onNotice(() => {
      counter.notices++
    })
  }, formatId)
  await drawn(page)
  const rows: { key: string; result: string }[] = []
  const unexpected: string[] = []
  for (const subject of SUBJECTS) {
    for (const gesture of GESTURES) {
      await page.evaluate(({ subject, formatId }) => window.dazbee?.select([subject], 'p1', formatId), { subject, formatId })
      await drawn(page)
      const errorsBefore = opened.errors.length
      const problem = await run(page, subject, gesture, formatId, other)
      const logged = opened.errors.length > errorsBefore ? `errors: ${opened.errors.slice(errorsBefore).join(' | ')}` : null
      opened.errors.length = errorsBefore
      const key = `${subject} ${gesture} ${formatId}`
      if (problem === 'n/a') {
        rows.push({ key, result: 'n/a' })
        continue
      }
      const failure = [problem, logged].filter(Boolean).join('; ') || null
      const ticket = KNOWN[key]
      rows.push({ key, result: failure ? (ticket ? `#${ticket}` : `FAIL: ${failure}`) : (ticket ? `pass (fixed? #${ticket})` : 'pass') })
      if (failure && !ticket) unexpected.push(`${key}: ${failure}`)
      if (!failure && ticket) unexpected.push(`${key}: passes now; take #${ticket} out of KNOWN`)
    }
  }
  const table = ['| Layer | Gesture | Format | Result |', '|---|---|---|---|', ...rows.map(({ key, result }) => `| ${key.split(' ').join(' | ')} | ${result} |`)].join('\n')
  return { rows, unexpected, table }
}
