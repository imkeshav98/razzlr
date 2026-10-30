import { parseDesign } from '@razzlr/schema'
import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { anchorOffset, loadDesign, openSession, readDesign, textAnchor, type DesignDoc, type Session } from './index.ts'
import { testDesign } from './test-design.ts'

/** Two tabs on one design, each with its own doc, exchanging updates like the sync server would. */
function twoTabs() {
  const result = parseDesign(testDesign())
  if (!result.success) throw new Error(result.errors.join('\n'))
  const a = loadDesign(result.design)
  const b = new Y.Doc()
  Y.applyUpdate(b, Y.encodeStateAsUpdate(a))
  const sync = () => {
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a, Y.encodeStateVector(b)))
    Y.applyUpdate(a, Y.encodeStateAsUpdate(b, Y.encodeStateVector(a)))
  }
  return { a, b, tabA: openSession(a), tabB: openSession(b), sync }
}

describe('two tabs', () => {
  it('undo in one tab reverts only its own edits, never the other tab’s', () => {
    const { a, b, tabA, tabB, sync } = twoTabs()

    tabA.run('node.update', { ids: ['box'], patch: { x: 500 } })
    sync()
    tabB.run('node.update', { ids: ['box'], patch: { y: 700 } })
    tabB.run('text.edit', { id: 'headline', op: { kind: 'insert', at: 0, text: 'Big ' } })
    sync()

    tabA.undo()
    sync()

    for (const doc of [a, b]) {
      const design = readDesign(doc)
      expect(design.nodes.box?.props).toMatchObject({ x: 100, y: 700 })
      expect(design.nodes.headline?.type === 'text' && design.nodes.headline.props.text).toBe('Big Summer sale')
    }
  })

  it('undoing an edit that won over a concurrent edit restores the old value instead of leaving it unset', () => {
    // Yjs alone deletes the key here: the old value was overwritten by both tabs, so its undo has nothing to restore.
    for (const [first, second] of [['a', 'b'], ['b', 'a']] as const) {
      const tabs = twoTabs()
      const tab = { a: tabs.tabA, b: tabs.tabB }
      tab[first].run('node.update', { ids: ['box'], patch: { x: 1 } })
      tab[second].run('node.update', { ids: ['box'], patch: { x: 2 } })
      tabs.sync()

      const bValue = first === 'b' ? 1 : 2
      const bWon = readDesign(tabs.a).nodes.box?.props.x === bValue

      tab.a.undo()
      tabs.sync()

      // If b's edit won, a's undo must leave it alone; if a's won, undo goes back to the value before.
      const expected = bWon ? bValue : 100
      expect(readDesign(tabs.a).nodes.box?.props.x).toBe(expected)
      expect(readDesign(tabs.b).nodes.box?.props.x).toBe(expected)

      tab.a.redo()
      tabs.sync()
      expect(readDesign(tabs.a).nodes.box?.props.x).toBeTypeOf('number')
      tab.a.undo()
      tabs.sync()
      expect(readDesign(tabs.a).nodes.box?.props.x).toBeTypeOf('number')
      expect(readDesign(tabs.b)).toEqual(readDesign(tabs.a))
    }
  })

  it('a drag is one undo step, and undoing it leaves the other tab’s edits made during it', () => {
    const { a, b, tabA, tabB, sync } = twoTabs()

    tabA.gesture(() => {
      for (let i = 1; i <= 30; i++) {
        tabA.run('node.update', { ids: ['box'], patch: { x: 100 + i * 10 } })
        if (i % 10 === 0) {
          sync()
          tabB.run('node.update', { ids: ['box'], patch: { y: 100 + i } })
          sync()
        }
      }
    })
    tabA.run('node.update', { ids: ['box'], patch: { width: 50 } })
    sync()

    tabA.undo()
    sync()
    expect(readDesign(a).nodes.box?.props).toMatchObject({ x: 400, width: 200 })
    tabA.undo()
    sync()
    expect(tabA.canUndo()).toBe(false)
    for (const doc of [a, b]) expect(readDesign(doc).nodes.box?.props).toMatchObject({ x: 100, y: 130, width: 200 })
  })

  it('undoing a gesture that won over another tab’s edit restores the value from before the gesture', () => {
    const { a, b, tabA, tabB, sync } = twoTabs()
    tabB.run('node.update', { ids: ['box'], patch: { x: 7 } })
    tabA.gesture(() => {
      tabA.run('node.update', { ids: ['box'], patch: { x: 300 } })
      tabA.run('node.update', { ids: ['box'], patch: { x: 310 } })
    })
    sync()
    // Both tabs set x at once; whichever won, undoing A must not leave x unset.
    tabA.undo()
    sync()
    for (const doc of [a, b]) expect(readDesign(doc).nodes.box?.props.x).toBeTypeOf('number')
  })

  it('two tabs overriding the same layer in a new format at once keep both changes', () => {
    const { a, b, tabA, tabB, sync } = twoTabs()
    tabA.run('format.add', { id: 'story', name: 'Story', width: 1080, height: 1920 })
    sync()
    tabA.run('node.update', { ids: ['box'], scope: 'format:story', patch: { x: 1 } })
    tabB.run('node.update', { ids: ['box'], scope: 'format:story', patch: { y: 2 } })
    sync()
    for (const doc of [a, b]) expect(readDesign(doc).overrides['format:story']?.box).toEqual({ x: 1, y: 2 })
  })

  it('concurrent moves that would put two groups inside each other are repaired the same way in both tabs', () => {
    const { a, b, tabA, tabB, sync } = twoTabs()
    const group = { type: 'group', name: 'G', props: { x: 0, y: 0, width: 10, height: 10 } } as const
    tabA.run('node.create', { id: 'g1', parentId: 'p1', layer: group })
    tabA.run('node.create', { id: 'g2', parentId: 'p1', layer: group })
    sync()

    tabA.run('node.move', { id: 'g1', parentId: 'g2' })
    tabB.run('node.move', { id: 'g2', parentId: 'g1' })
    sync()

    const designA = readDesign(a)
    expect(readDesign(b)).toEqual(designA)
    expect([designA.nodes.g1?.parentId, designA.nodes.g2?.parentId].sort()).toEqual(['g1', 'p1'])
  })

  it.each([1, 7, 42, 2026, 31337])('200 random commands from each tab end in the same valid design on both (seed %i)', (seed) => {
    const { a, b, tabA, tabB, sync } = twoTabs()
    const random = seeded(seed)
    for (let i = 0; i < 200; i++) {
      randomCommand(tabA, a, random)
      randomCommand(tabB, b, random)
      if (random() < 0.3) sync()
    }
    sync()
    expect(readDesign(b)).toEqual(readDesign(a))
  })

  it.each([3, 99, 4242])("each tab's session view equals a full read after every command, sync and repair (seed %i)", (seed) => {
    const { a, b, tabA, tabB, sync } = twoTabs()
    const random = seeded(seed)
    for (let i = 0; i < 200; i++) {
      randomCommand(tabA, a, random)
      expect(tabA.design()).toEqual(readDesign(a))
      randomCommand(tabB, b, random)
      expect(tabB.design()).toEqual(readDesign(b))
      if (random() < 0.3) {
        sync()
        expect(tabA.design()).toEqual(readDesign(a))
        expect(tabB.design()).toEqual(readDesign(b))
      }
    }
  })
})

function seeded(seed: number) {
  let s = seed
  return () => ((s = (s * 1664525 + 1013904223) % 2 ** 32) / 2 ** 32)
}

/** One plausible edit through the tab's commands; refused commands are part of the test too. */
function randomCommand(tab: Session, doc: DesignDoc, random: () => number) {
  const design = readDesign(doc)
  const ids = Object.keys(design.nodes)
  const pick = <T>(xs: T[]) => xs[Math.floor(random() * xs.length)] as T
  const containers = [...Object.keys(design.pages), ...ids.filter((id) => ['group', 'frame'].includes(design.nodes[id]?.type ?? ''))]
  const roll = random()
  try {
    if (roll < 0.2 || ids.length === 0) {
      tab.run('node.create', {
        parentId: pick(containers),
        layer: random() < 0.3
          ? { type: 'group', name: 'G', props: { x: 0, y: 0, width: 50, height: 50 } }
          : { type: 'graphic', name: 'R', props: { x: random() * 1000, y: random() * 1000, width: 40, height: 40, shape: { kind: 'rect' } } },
      })
    } else if (roll < 0.5) {
      tab.run('node.update', { ids: [pick(ids)], scope: random() < 0.5 ? 'base' : 'format:banner', patch: { x: Math.round(random() * 1000) } })
    } else if (roll < 0.65) {
      const parentId = pick(containers)
      const under = ids.filter((id) => design.nodes[id]?.parentId === parentId)
      tab.run('node.move', { id: pick(ids), parentId, ...(under.length && random() < 0.5 ? { before: pick(under) } : {}) })
    } else if (roll < 0.75) {
      tab.run('node.delete', { ids: [pick(ids)] })
    } else if (roll < 0.9 && design.nodes.headline?.type === 'text') {
      const length = design.nodes.headline.props.text.length
      tab.run('text.edit', random() < 0.6 || length < 2
        ? { id: 'headline', op: { kind: 'insert', at: Math.floor(random() * (length + 1)), text: pick(['a', 'ब', 'ع', '!']) } }
        : { id: 'headline', op: { kind: 'delete', at: Math.floor(random() * (length - 1)), length: 1 } })
    } else if (roll < 0.93) {
      if (random() < 0.5) tab.run('page.add', { name: 'P' })
      else tab.run('format.add', { name: 'F', width: 100 + Math.floor(random() * 900), height: 100 })
    } else if (roll < 0.96 && design.nodes.headline?.type === 'text' && design.nodes.headline.props.text.length > 1) {
      tab.run('text.edit', { id: 'headline', op: { kind: 'style', at: 0, length: 1, style: { fontWeight: pick([400, 700]) } } })
    } else if (random() < 0.5) {
      tab.undo()
    } else {
      tab.redo()
    }
  } catch (e) {
    if (!(e instanceof Error) || e.name !== 'CommandError') throw e
  }
}

describe('a text anchor', () => {
  it("keeps a caret on the same character while the other tab edits the text around it", () => {
    const { a, tabB, sync } = twoTabs()
    const anchor = textAnchor(a, 'headline', 6)
    tabB.run('text.edit', { id: 'headline', op: { kind: 'insert', at: 0, text: 'Big ' } })
    sync()
    expect(anchorOffset(a, anchor)).toBe(10)
    tabB.run('text.edit', { id: 'headline', op: { kind: 'delete', at: 0, length: 8 } })
    sync()
    expect(anchorOffset(a, anchor)).toBe(2)
  })

  it('is null for a layer that is gone or not text', () => {
    const { a, tabA } = twoTabs()
    expect(() => textAnchor(a, 'box', 0)).toThrow('"box" is not a text layer')
    const anchor = textAnchor(a, 'headline', 3)
    tabA.run('node.delete', { ids: ['headline'] })
    expect(anchorOffset(a, anchor)).toBeNull()
  })
})

describe("a session's design view", () => {
  it('is current inside a transaction: a command after a delete in the same transaction is refused', () => {
    const { a, tabA } = twoTabs()
    expect(() => a.transact(() => {
      tabA.run('node.delete', { ids: ['box'] })
      tabA.run('node.update', { ids: ['box'], patch: { x: 1 } })
    })).toThrow('no layer "box"')
  })

  it('is current for any observer of the document, called before or after its own', () => {
    const { a, tabA } = twoTabs()
    const seen: string[] = []
    const look = (who: string) => () => {
      const design = tabA.design()
      seen.push(`${who}: x ${design.nodes.box?.props.x}, ${design.nodes.c1 ? 'has' : 'no'} c1`)
    }
    a.getMap('nodes').observe(look('shallow'))
    a.getMap('nodes').observeDeep(look('deep'))
    tabA.design()
    tabA.run('node.update', { ids: ['box'], patch: { x: 7 } })
    tabA.run('node.create', { id: 'c1', parentId: 'p1', layer: { type: 'group', name: 'G', props: { x: 0, y: 0, width: 1, height: 1 } } })
    expect(seen).toEqual(['deep: x 7, no c1', 'shallow: x 7, has c1', 'deep: x 7, has c1'])
  })

  it('hands out a design that cannot be changed, so no caller can corrupt what later reads reuse', () => {
    const { tabA } = twoTabs()
    const design = tabA.design()
    expect(() => { (design.nodes.box as { props: { width: number } }).props.width = -50 }).toThrow()
    expect(() => { (design.nodes as Record<string, unknown>).ghost = {} }).toThrow()
    expect(tabA.design().nodes.box?.props.width).toBe(200)
  })
})
