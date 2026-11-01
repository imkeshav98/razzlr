import { parseDesign, type Design, type DesignInput } from '@dazbee/schema'
import { describe, expect, it } from 'vitest'
import { boundsOf, centreOf, normalAngle, turn } from './geometry.ts'
import { childrenOf, loadDesign, openSession, readDesign } from './index.ts'

const rect = (x: number, y: number, width: number, height: number, rotation = 0) =>
  ({ x, y, width, height, rotation, shape: { kind: 'rect' as const }, fills: [{ type: 'solid' as const, color: '#FF5A36FF' }] })

/**
 * Two loose layers, and a turned frame holding a layer and a turned group: a square and a banner,
 * where the banner moves, turns back and hides some of them.
 */
const design = (): DesignInput => ({
  meta: { schemaVersion: 2, designId: 'd1', name: 'Groups', kind: 'single', primaryFormatId: 'sq' },
  formats: {
    sq: { name: 'Square', width: 1080, height: 1080, order: 'a0' },
    banner: { name: 'Banner', width: 960, height: 320, order: 'a1' },
  },
  pages: { p1: { name: 'Page 1', order: 'a0', fills: [{ type: 'solid', color: '#FFFFFFFF' }] } },
  nodes: {
    a: { type: 'graphic', parentId: 'p1', index: 'a0', name: 'A', props: rect(100, 100, 200, 100, 20) },
    b: { type: 'graphic', parentId: 'p1', index: 'a1', name: 'B', props: rect(400, 150, 120, 120) },
    f: { type: 'frame', parentId: 'p1', index: 'a2', name: 'F', props: { x: 300, y: 500, width: 500, height: 400, rotation: 30, clip: true } },
    c: { type: 'graphic', parentId: 'f', index: 'a0', name: 'C', props: rect(340, 540, 100, 60) },
    g2: { type: 'group', parentId: 'f', index: 'a1', name: 'G2', props: { x: 500, y: 600, width: 200, height: 150, rotation: -15 } },
    d: { type: 'graphic', parentId: 'g2', index: 'a0', name: 'D', props: rect(500, 600, 200, 150, 10) },
  },
  overrides: {
    'format:banner': {
      a: { x: 20, y: 20, width: 100, height: 50 },
      f: { x: 500, y: 10, rotation: 0 },
      c: { visible: false },
    },
  },
})

const fresh = () => {
  const parsed = parseDesign(design())
  if (!parsed.success) throw new Error(parsed.errors.join('\n'))
  return loadDesign(parsed.design)
}
const SCOPES = ['base', 'format:sq', 'format:banner'] as const
type Scope = (typeof SCOPES)[number]

/** A layer's own box in a scope: the base with the scope's overrides. */
function boxOf(d: Design, scope: Scope, id: string) {
  const p = { ...d.nodes[id]?.props, ...(scope === 'base' ? {} : d.overrides[scope]?.[id]) } as { x: number; y: number; width: number; height: number; rotation?: number; visible?: boolean }
  return { x: p.x, y: p.y, width: p.width, height: p.height, rotation: p.rotation ?? 0, visible: p.visible ?? true }
}

/** Where a layer is drawn in a scope, after every container around it turns it, and whether it shows. */
function drawn(d: Design, scope: Scope, id: string) {
  const own = boxOf(d, scope, id)
  let centre = centreOf(own)
  let rotation = own.rotation
  let visible = own.visible
  for (let up = d.nodes[id]?.parentId; up && d.nodes[up]; up = d.nodes[up]?.parentId) {
    const box = boxOf(d, scope, up)
    centre = turn(centre, centreOf(box), box.rotation)
    rotation += box.rotation
    visible &&= box.visible
  }
  return { x: centre.x, y: centre.y, width: own.width, height: own.height, rotation: normalAngle(rotation), visible }
}
const drawnAll = (d: Design, ids: string[]) => Object.fromEntries(SCOPES.flatMap((scope) => ids.map((id) => [`${scope} ${id}`, drawn(d, scope, id)])))
/**
 * Two placements are the same within what the document keeps: values are rounded to hundredths,
 * so a centre can be off by a few of them after a turn.
 */
function expectSame(after: ReturnType<typeof drawnAll>, before: ReturnType<typeof drawnAll>) {
  expect(Object.keys(after)).toEqual(Object.keys(before))
  for (const [key, was] of Object.entries(before)) {
    const now = after[key] as typeof was
    for (const field of ['x', 'y', 'width', 'height', 'rotation'] as const) {
      expect(Math.abs(now[field] - was[field]), `${key} ${field}: ${now[field]} vs ${was[field]}`).toBeLessThan(0.02)
    }
    expect(now.visible, `${key} visible`).toBe(was.visible)
  }
}
const LEAVES = ['a', 'b', 'c', 'd']

describe('groups', () => {
  it('node.group wraps layers in a group that hugs them in each format, and nothing moves', () => {
    const doc = fresh()
    const tab = openSession(doc)
    const before = drawnAll(readDesign(doc), LEAVES)

    const id = tab.run('node.group', { ids: ['b', 'a'] })

    const after = readDesign(doc)
    expect(after.nodes[id]).toMatchObject({ type: 'group', parentId: 'p1', name: 'Group' })
    expect(childrenOf(after, id).map(([child]) => child)).toEqual(['a', 'b'])
    // In the layer order, the group stands where B, the topmost, was: under the frame.
    expect(childrenOf(after, 'p1').map(([child]) => child)).toEqual([id, 'f'])
    for (const scope of SCOPES) {
      const hug = boundsOf([boxOf(after, scope, 'a'), boxOf(after, scope, 'b')])
      const box = boxOf(after, scope, id)
      expect([box.x, box.y, box.width, box.height]).toEqual([hug.x, hug.y, hug.width, hug.height].map((n) => Math.round(n * 100) / 100))
    }
    expectSame(drawnAll(after, LEAVES), before)

    tab.undo()
    const undone = readDesign(doc)
    expect(undone.nodes[id]).toBeUndefined()
    expect(undone.nodes.a?.parentId).toBe('p1')
  })

  it('group then ungroup leaves every layer where it was in every format, inside turned containers too', () => {
    const doc = fresh()
    const tab = openSession(doc)
    const before = drawnAll(readDesign(doc), LEAVES)

    // Inside the turned frame: C and the turned group G2 together.
    const outer = tab.run('node.group', { ids: ['c', 'g2'] })
    expectSame(drawnAll(readDesign(doc), LEAVES), before)

    // G2 is turned -15° in the square and the banner: its turn goes into D.
    expect(tab.run('node.ungroup', { ids: ['g2'] })).toEqual(['d'])
    let now = readDesign(doc)
    expect(now.nodes.g2).toBeUndefined()
    expect(now.nodes.d?.parentId).toBe(outer)
    expect(now.nodes.d?.props.rotation).toBe(-5)
    expectSame(drawnAll(now, LEAVES), before)

    expect(tab.run('node.ungroup', { ids: [outer] })).toEqual(['c', 'd'])
    now = readDesign(doc)
    expect(childrenOf(now, 'f').map(([child]) => child)).toEqual(['c', 'd'])
    expectSame(drawnAll(now, LEAVES), before)

    // Each was one undo step.
    tab.undo()
    expect(readDesign(doc).nodes[outer]?.type).toBe('group')
    tab.undo()
    expect(readDesign(doc).nodes.g2?.type).toBe('group')
    tab.undo()
    expect(readDesign(doc)).toEqual(readDesign(fresh()))
  })

  it('a format that turns the group differently gets its own overrides when ungrouping', () => {
    const doc = fresh()
    const tab = openSession(doc)
    const id = tab.run('node.group', { ids: ['a', 'b'] })
    tab.run('node.update', { ids: [id], scope: 'format:banner', patch: { rotation: 45, visible: false } })
    const before = drawnAll(readDesign(doc), ['a', 'b'])

    tab.run('node.ungroup', { ids: [id] })

    const after = readDesign(doc)
    expectSame(drawnAll(after, ['a', 'b']), before)
    // The banner hid the group, so it hides what the group held; the square still shows them.
    expect(drawn(after, 'format:banner', 'b').visible).toBe(false)
    expect(drawn(after, 'format:sq', 'b').visible).toBe(true)
    expect(after.overrides['format:banner']?.b).toMatchObject({ rotation: 45 })
  })

  it('node.hug fits a turned group to what it holds after one of them moves, and nothing moves on screen', () => {
    const doc = fresh()
    const tab = openSession(doc)
    tab.run('node.update', { ids: ['d'], scope: 'format:sq', patch: { x: 560, y: 700 } })
    const before = drawnAll(readDesign(doc), LEAVES)

    tab.run('node.hug', { ids: ['d'] })

    const after = readDesign(doc)
    expectSame(drawnAll(after, LEAVES), before)
    for (const scope of SCOPES) {
      const hug = boundsOf([boxOf(after, scope, 'd')])
      const box = boxOf(after, scope, 'g2')
      expect(box.x).toBeCloseTo(hug.x, 1)
      expect(box.y).toBeCloseTo(hug.y, 1)
      expect(box.width).toBeCloseTo(hug.width, 1)
      expect(box.height).toBeCloseTo(hug.height, 1)
    }
    // Fitting again changes nothing.
    tab.run('node.hug', { ids: ['g2'] })
    expect(readDesign(doc)).toEqual(after)
  })

  it('node.frame wraps layers in a frame that hugs them in each format, without a fill or clipping, and nothing moves', () => {
    const doc = fresh()
    const tab = openSession(doc)
    const before = drawnAll(readDesign(doc), LEAVES)

    const id = tab.run('node.frame', { ids: ['c', 'g2'] })

    const after = readDesign(doc)
    expect(after.nodes[id]).toMatchObject({ type: 'frame', parentId: 'f', name: 'Frame', props: { clip: false, fills: [] } })
    expect(childrenOf(after, id).map(([child]) => child)).toEqual(['c', 'g2'])
    for (const scope of SCOPES) {
      const hug = boundsOf([boxOf(after, scope, 'c'), boxOf(after, scope, 'g2')])
      const box = boxOf(after, scope, id)
      expect([box.x, box.y, box.width, box.height]).toEqual([hug.x, hug.y, hug.width, hug.height].map((n) => Math.round(n * 100) / 100))
    }
    expectSame(drawnAll(after, LEAVES), before)

    tab.undo()
    expect(readDesign(doc)).toEqual(readDesign(fresh()))
  })

  it('node.enclose moves layers into a frame drawn around them, placing the frame around them in every format', () => {
    const doc = fresh()
    const tab = openSession(doc)
    // A frame drawn in the square around A and B, 20 px clear of them.
    const square = boundsOf([boxOf(readDesign(doc), 'format:sq', 'a'), boxOf(readDesign(doc), 'format:sq', 'b')])
    const drawnBox = { x: square.x - 20, y: square.y - 20, width: square.width + 40, height: square.height + 40 }
    const id = tab.run('node.create', { parentId: 'p1', layer: { type: 'frame', name: 'Frame', props: drawnBox } })
    const before = drawnAll(readDesign(doc), LEAVES)

    tab.run('node.enclose', { id, ids: ['b', 'a'], scope: 'format:sq' })

    const after = readDesign(doc)
    expect(childrenOf(after, id).map(([child]) => child)).toEqual(['a', 'b'])
    expectSame(drawnAll(after, LEAVES), before)
    // In the square it stays where it was drawn; in the banner, where A is smaller and elsewhere, it holds them as it did.
    expect(boxOf(after, 'format:sq', id)).toMatchObject({ x: drawnBox.x, y: drawnBox.y, width: drawnBox.width, height: drawnBox.height })
    for (const scope of SCOPES) {
      const kids = boundsOf([boxOf(after, scope, 'a'), boxOf(after, scope, 'b')])
      const box = boxOf(after, scope, id)
      expect(box.x).toBeLessThanOrEqual(kids.x)
      expect(box.y).toBeLessThanOrEqual(kids.y)
      expect(box.x + box.width).toBeGreaterThanOrEqual(kids.x + kids.width - 0.01)
      expect(box.y + box.height).toBeGreaterThanOrEqual(kids.y + kids.height - 0.01)
    }

    tab.undo()
    const undone = readDesign(doc)
    expect(undone.nodes.a?.parentId).toBe('p1')
    expect(undone.nodes[id]?.props).toMatchObject(drawnBox)
  })

  it('refuses what it can not do', () => {
    const tab = openSession(fresh())
    expect(() => tab.run('node.frame', { ids: ['a', 'c'] })).toThrow(/frame must share a parent/)
    expect(() => tab.run('node.enclose', { id: 'g2', ids: ['d'], scope: 'format:sq' })).toThrow(/not a frame/)
    expect(() => tab.run('node.enclose', { id: 'f', ids: ['c'], scope: 'format:sq' })).toThrow(/not beside/)
    expect(() => tab.run('node.group', { ids: ['a', 'c'] })).toThrow(/share a parent/)
    expect(() => tab.run('node.ungroup', { ids: ['f'] })).toThrow(/frame, not a group/)
    tab.run('node.lock', { ids: ['g2'], lock: { delete: true } })
    expect(() => tab.run('node.ungroup', { ids: ['g2'] })).toThrow(/locked/)
  })
})
