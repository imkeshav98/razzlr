import { parseDesign } from '@razzlr/schema'
import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { loadDesign, openSession, readDesign, type DesignDoc, type Session } from './index.ts'
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

      tab.a.undo()
      tabs.sync()

      // Tab b's value if it won the merge, otherwise the value before tab a's edit.
      const bValue = first === 'b' ? 1 : 2
      const x = readDesign(tabs.a).nodes.box?.props.x
      expect([100, bValue]).toContain(x)
      expect(readDesign(tabs.b).nodes.box?.props.x).toBe(x)
    }
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
      tab.run('node.move', { id: pick(ids), parentId: pick(containers) })
    } else if (roll < 0.75) {
      tab.run('node.delete', { ids: [pick(ids)] })
    } else if (roll < 0.9 && design.nodes.headline?.type === 'text') {
      const length = design.nodes.headline.props.text.length
      tab.run('text.edit', random() < 0.6 || length < 2
        ? { id: 'headline', op: { kind: 'insert', at: Math.floor(random() * (length + 1)), text: pick(['a', 'ब', 'ع', '!']) } }
        : { id: 'headline', op: { kind: 'delete', at: Math.floor(random() * (length - 1)), length: 1 } })
    } else if (tab.canUndo()) {
      tab.undo()
    }
  } catch (e) {
    if (!(e instanceof Error) || e.name !== 'CommandError') throw e
  }
}
