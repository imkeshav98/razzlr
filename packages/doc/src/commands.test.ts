import { parseDesign } from '@razzlr/schema'
import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { childrenOf, loadDesign, openSession, readDesign } from './index.ts'
import { testDesign } from './test-design.ts'

const freshDoc = () => {
  const result = parseDesign(testDesign())
  if (!result.success) throw new Error(result.errors.join('\n'))
  return loadDesign(result.design)
}

const badge = {
  type: 'graphic',
  name: 'Badge',
  props: { x: 900, y: 40, width: 120, height: 120, shape: { kind: 'ellipse' }, fills: [{ type: 'solid', color: '#FFC400FF' }] },
} as const

describe('commands', () => {
  it('node.create adds a layer on top of its siblings, and undo removes it', () => {
    const doc = freshDoc()
    const tab = openSession(doc)

    const id = tab.run('node.create', { parentId: 'p1', layer: badge })

    const design = readDesign(doc)
    expect(design.nodes[id]).toMatchObject({ type: 'graphic', parentId: 'p1', name: 'Badge' })
    const siblings = Object.values(design.nodes).filter((n) => n.parentId === 'p1').map((n) => n.index)
    expect(design.nodes[id]?.index).toBe(siblings.sort().at(-1))

    tab.undo()
    expect(readDesign(doc).nodes[id]).toBeUndefined()
  })

  it('rejects invalid input before touching the document', () => {
    const doc = freshDoc()
    const before = Y.encodeStateVector(doc)
    const tab = openSession(doc)

    expect(() => tab.run('node.create', { parentId: 'p1', layer: { ...badge, props: { ...badge.props, opacity: 3 } } }))
      .toThrow(/node.create: layer.props.opacity/)
    expect(() => tab.run('node.create', { parentId: 'nowhere', layer: badge }))
      .toThrow(/node.create: parent "nowhere" is neither a page nor a layer/)
    expect(Y.encodeStateVector(doc)).toEqual(before)
  })

  it('node.update sets base properties, or overrides them for one format only', () => {
    const doc = freshDoc()
    const tab = openSession(doc)

    tab.run('node.update', { ids: ['box'], patch: { x: 140, opacity: 0.5 } })
    tab.run('node.update', { ids: ['box'], scope: 'format:banner', patch: { x: 8, width: 40 } })

    const design = readDesign(doc)
    expect(design.nodes.box?.props).toMatchObject({ x: 140, opacity: 0.5, width: 200 })
    expect(design.overrides['format:banner']?.box).toEqual({ x: 8, width: 40 })
  })

  it('node.update refuses a patch that would make the layer invalid', () => {
    const tab = openSession(freshDoc())
    expect(() => tab.run('node.update', { ids: ['box'], patch: { opacity: 2 } })).toThrow(/node.update: box.opacity/)
    expect(() => tab.run('node.update', { ids: ['box'], patch: { text: 'x' } })).toThrow(/node.update: a graphic has no property "text"/)
  })

  it('node.move changes parent and order, and refuses to put a layer inside itself', () => {
    const doc = freshDoc()
    const tab = openSession(doc)
    const group = tab.run('node.create', { parentId: 'p1', layer: { type: 'group', name: 'G', props: { x: 0, y: 0, width: 10, height: 10 } } })

    tab.run('node.move', { id: 'box', parentId: group })
    expect(readDesign(doc).nodes.box?.parentId).toBe(group)

    tab.run('node.move', { id: group, parentId: 'p1', before: 'headline' })
    const order = childrenOf(readDesign(doc), 'p1').map(([id]) => id)
    expect(order).toEqual([group, 'headline'])

    expect(() => tab.run('node.move', { id: group, parentId: 'box' })).toThrow(/parent "box" is a graphic/)
    const inner = tab.run('node.create', { parentId: group, layer: { type: 'group', name: 'Inner', props: { x: 0, y: 0, width: 5, height: 5 } } })
    expect(() => tab.run('node.move', { id: group, parentId: inner })).toThrow(/node.move: can't move "\S+" inside itself/)
  })

  it('node.delete removes layers, their children and their overrides', () => {
    const doc = freshDoc()
    const tab = openSession(doc)
    const group = tab.run('node.create', { parentId: 'p1', layer: { type: 'group', name: 'G', props: { x: 0, y: 0, width: 10, height: 10 } } })
    tab.run('node.move', { id: 'headline', parentId: group })

    tab.run('node.delete', { ids: [group] })

    const design = readDesign(doc)
    expect(Object.keys(design.nodes)).toEqual(['box'])
    expect(design.overrides['format:banner']).toEqual({})

    tab.undo()
    expect(readDesign(doc).nodes.headline?.parentId).toBe(group)
  })

  it('text.edit inserts, deletes and styles ranges of a text layer', () => {
    const doc = freshDoc()
    const tab = openSession(doc)

    tab.run('text.edit', { id: 'headline', op: { kind: 'insert', at: 11, text: '!' } })
    tab.run('text.edit', { id: 'headline', op: { kind: 'delete', at: 0, length: 7 } })
    tab.run('text.edit', { id: 'headline', op: { kind: 'style', at: 0, length: 4, style: { color: '#FF0000FF' } } })

    const text = readDesign(doc).nodes.headline
    if (text?.type !== 'text') throw new Error('not text')
    expect(text.props.text).toBe('sale!')
    // Typed text takes the style of the character before it, as in any editor.
    expect(text.props.runs).toEqual([
      { start: 0, end: 4, style: { fontWeight: 800, color: '#FF0000FF' } },
      { start: 4, end: 5, style: { fontWeight: 800 } },
    ])

    expect(() => tab.run('text.edit', { id: 'box', op: { kind: 'delete', at: 0, length: 1 } })).toThrow(/"box" is a graphic, not a text layer/)
    expect(() => tab.run('text.edit', { id: 'headline', op: { kind: 'delete', at: 3, length: 9 } })).toThrow(/runs past the end/)
  })

  it('page.add and format.add extend the design', () => {
    const doc = freshDoc()
    const tab = openSession(doc)

    const page = tab.run('page.add', { name: 'Card 2' })
    const format = tab.run('format.add', { name: 'Story', width: 1080, height: 1920 })

    const design = readDesign(doc)
    expect(design.pages[page]).toMatchObject({ name: 'Card 2' })
    expect(String(design.pages[page]?.order) > String(design.pages.p1?.order)).toBe(true)
    expect(design.formats[format]).toMatchObject({ name: 'Story', width: 1080, height: 1920 })
    expect(() => tab.run('format.add', { name: 'Bad', width: 0, height: 10 })).toThrow(/format.add: width/)
  })

  it('node.create refuses the id of a deleted layer, so undoing that delete still works', () => {
    const doc = freshDoc()
    const tab = openSession(doc)
    tab.run('node.delete', { ids: ['box'] })
    expect(() => tab.run('node.create', { id: 'box', parentId: 'p1', layer: badge })).toThrow(/id "box" is taken/)
    tab.undo()
    expect(readDesign(doc).nodes.box?.name).toBe('Box')
  })

  it('node.move refuses to place a layer before itself', () => {
    const tab = openSession(freshDoc())
    expect(() => tab.run('node.move', { id: 'box', parentId: 'p1', before: 'box' })).toThrow(/node.move: can't place "box" before itself/)
  })

  it('node.move and node.create work among siblings with tied or non-canonical indexes', () => {
    const result = parseDesign(testDesign())
    if (!result.success) throw new Error(result.errors.join('\n'))
    const design = result.design
    // Two tabs creating at once can tie; hand-written fixtures use keys like a000 that fractional-indexing rejects.
    Object.assign(design.nodes.box ?? {}, { index: 'a000' })
    Object.assign(design.nodes.headline ?? {}, { index: 'a000' })
    const doc = loadDesign(design)
    const tab = openSession(doc)

    const id = tab.run('node.create', { parentId: 'p1', layer: badge })
    tab.run('node.move', { id, parentId: 'p1', before: 'headline' })

    expect(childrenOf(readDesign(doc), 'p1').map(([n]) => n).at(-1)).not.toBe(id)
  })
})
