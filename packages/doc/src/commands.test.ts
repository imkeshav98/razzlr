import { LayerTree, parseDesign } from '@razzlr/schema'
import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import type { z } from 'zod'
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

  it('override.reset puts layers back to the base in one format, and undo brings the overrides back', () => {
    const doc = freshDoc()
    const tab = openSession(doc)
    tab.run('node.update', { ids: ['box'], scope: 'format:banner', patch: { x: 8, y: 4, width: 40 } })

    tab.run('override.reset', { ids: ['box'], scope: 'format:banner', paths: ['x', 'y'] })
    expect(readDesign(doc).overrides['format:banner']?.box).toEqual({ width: 40 })

    tab.run('override.reset', { ids: ['box'], scope: 'format:banner' })
    const design = readDesign(doc)
    expect(design.overrides['format:banner']?.box).toBeUndefined()
    expect(design.nodes.box?.props).toMatchObject({ x: 100, width: 200 })

    tab.undo()
    expect(readDesign(doc).overrides['format:banner']?.box).toEqual({ width: 40 })
    expect(() => tab.run('override.reset', { ids: ['box'], scope: 'format:nope' })).toThrow(/no format "nope"/)
    expect(() => tab.run('override.reset', { ids: ['gone'], scope: 'format:banner' })).toThrow(/no layer "gone"/)
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

  it('text.fit sizes a text box in each format, base from the primary, one undo step', () => {
    const doc = freshDoc()
    const tab = openSession(doc)
    tab.run('text.fit', { id: 'headline', sizes: { sq: { width: 300, height: 90 }, banner: { width: 120, height: 40 } } })
    const d = readDesign(doc)
    expect(d.nodes.headline?.props).toMatchObject({ width: 300, height: 90 })
    expect(d.overrides['format:banner']?.headline).toMatchObject({ width: 120, height: 40 })
    expect(d.overrides['format:sq']?.headline).toBeUndefined()
    tab.undo()
    expect(readDesign(doc).nodes.headline?.props).not.toMatchObject({ width: 300, height: 90 })
    expect(() => tab.run('text.fit', { id: 'box', sizes: {} })).toThrow(/"box" is a graphic, not a text layer/)
    expect(() => tab.run('text.fit', { id: 'headline', sizes: { story: { width: 1, height: 1 } } })).toThrow(/no format "story"/)
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

  it('format.add starts a format from the primary layout scaled to fit and centred, written as overrides', () => {
    const doc = freshDoc()
    const tab = openSession(doc)
    tab.run('node.update', { ids: ['box'], scope: 'format:sq', patch: { x: 140, rotation: 15 } })

    const story = tab.run('format.add', { id: 'story', name: 'Story', width: 1080, height: 1920 })

    const design = readDesign(doc)
    // 1080 wide either way, so scale 1 and the square's layout sits 420 px down, in the middle.
    expect(design.overrides['format:story']?.box).toEqual({ x: 140, y: 520, width: 200, height: 100, rotation: 15 })
    expect(design.overrides['format:story']?.headline).toEqual({ x: 60, y: 1020, width: 960, height: 100 })
    tab.undo()
    expect(readDesign(doc).formats[story]).toBeUndefined()
    expect(readDesign(doc).overrides['format:story']).toBeUndefined()

    // Half the square's size, with room to spare across: scale 0.5, centred both ways.
    tab.run('format.add', { id: 'small', name: 'Small', width: 600, height: 540 })
    expect(readDesign(doc).overrides['format:small']?.box).toEqual({ x: 100, y: 50, width: 100, height: 50, rotation: 15 })
  })

  it('format.add and format.update refuse sizes outside 1:3 to 3:1 or under the short side', () => {
    const tab = openSession(freshDoc())
    expect(() => tab.run('format.add', { name: 'Skyscraper', width: 160, height: 600 })).toThrow(/1:3 to 3:1/)
    expect(() => tab.run('format.add', { name: 'Strip', width: 1600, height: 500 })).toThrow(/1:3 to 3:1/)
    expect(() => tab.run('format.add', { name: 'Tiny', width: 90, height: 90 })).toThrow(/short side/)
    expect(tab.run('format.add', { name: 'Edge', width: 1500, height: 500 })).toBeTruthy()
    expect(() => tab.run('format.update', { id: 'sq', width: 4000 })).toThrow(/1:3 to 3:1/)
  })

  it('format.update renames, resizes and reorders a format', () => {
    const doc = freshDoc()
    const tab = openSession(doc)
    tab.run('format.add', { id: 'story', name: 'Story', width: 1080, height: 1920 })
    tab.run('format.update', { id: 'story', name: 'Reel', width: 1080, height: 1350 })
    tab.run('format.update', { id: 'story', before: 'sq' })
    const order = (d = readDesign(doc)) => Object.entries(d.formats).sort(([, a], [, b]) => (a.order < b.order ? -1 : 1)).map(([id]) => id)
    expect(readDesign(doc).formats.story).toMatchObject({ name: 'Reel', width: 1080, height: 1350 })
    expect(order()).toEqual(['story', 'sq', 'banner'])
    tab.run('format.update', { id: 'story', before: null })
    expect(order()).toEqual(['sq', 'banner', 'story'])
    tab.undo()
    expect(order()).toEqual(['story', 'sq', 'banner'])
    expect(() => tab.run('format.update', { id: 'story', before: 'story' })).toThrow(/no other format/)
  })

  it('format.remove drops the format and its overrides, keeps the primary and the last one, and undo brings both back', () => {
    const doc = freshDoc()
    const tab = openSession(doc)
    expect(readDesign(doc).overrides['format:banner']?.headline).toMatchObject({ x: 4 })

    tab.run('format.remove', { id: 'banner' })
    expect(readDesign(doc).formats.banner).toBeUndefined()
    expect(readDesign(doc).overrides['format:banner']).toBeUndefined()
    expect(() => tab.run('format.remove', { id: 'sq' })).toThrow(/at least one format/)

    tab.undo()
    expect(readDesign(doc).formats.banner).toMatchObject({ name: 'Banner' })
    expect(readDesign(doc).overrides['format:banner']?.headline).toMatchObject({ x: 4, text: 'Sale' })
    expect(() => tab.run('format.remove', { id: 'sq' })).toThrow(/another format primary/)

    tab.run('format.setPrimary', { id: 'banner' })
    expect(readDesign(doc).meta.primaryFormatId).toBe('banner')
    tab.run('format.remove', { id: 'sq' })
    expect(Object.keys(readDesign(doc).formats)).toEqual(['banner'])
  })

  it('page.duplicate copies the page after itself with fresh layer ids, their nesting and their overrides', () => {
    const doc = freshDoc()
    const tab = openSession(doc)
    tab.run('page.add', { id: 'p2', name: 'Card 2' })
    tab.run('node.create', { id: 'g', parentId: 'p1', layer: { type: 'group', name: 'G', props: { x: 0, y: 0, width: 10, height: 10 } } })
    tab.run('node.create', { id: 'dot', parentId: 'g', layer: badge })

    const copy = tab.run('page.duplicate', { id: 'p1', name: 'Card 1 copy' })

    const design = readDesign(doc)
    const order = Object.entries(design.pages).sort(([, a], [, b]) => (a.order < b.order ? -1 : 1)).map(([id]) => id)
    expect(order).toEqual(['p1', copy, 'p2'])
    expect(design.pages[copy]).toMatchObject({ name: 'Card 1 copy', fills: design.pages.p1?.fills })
    const copied = Object.entries(design.nodes).filter(([, n]) => n.parentId === copy).map(([id, n]) => ({ id, name: n.name }))
    expect(copied.map((c) => c.name).sort()).toEqual(['Box', 'G', 'Headline'])
    expect(copied.every((c) => !['box', 'headline', 'g'].includes(c.id))).toBe(true)
    const group = copied.find((c) => c.name === 'G')?.id ?? ''
    expect(Object.values(design.nodes).filter((n) => n.parentId === group).map((n) => n.name)).toEqual(['Badge'])
    const headline = copied.find((c) => c.name === 'Headline')?.id ?? ''
    expect(design.overrides['format:banner']?.[headline]).toEqual(design.overrides['format:banner']?.headline)
    expect(design.nodes[headline]).toMatchObject({ props: { text: 'Summer sale' } })

    tab.undo()
    expect(readDesign(doc).pages[copy]).toBeUndefined()
    expect(Object.keys(readDesign(doc).nodes).sort()).toEqual(['box', 'dot', 'g', 'headline'])
  })

  it('page.move reorders pages and page.update renames one', () => {
    const doc = freshDoc()
    const tab = openSession(doc)
    tab.run('page.add', { id: 'p2', name: 'Card 2' })
    tab.run('page.add', { id: 'p3', name: 'Card 3' })
    const order = () => Object.entries(readDesign(doc).pages).sort(([, a], [, b]) => (a.order < b.order ? -1 : 1)).map(([id]) => id)
    tab.run('page.move', { id: 'p3', before: 'p1' })
    expect(order()).toEqual(['p3', 'p1', 'p2'])
    tab.run('page.move', { id: 'p3', before: null })
    expect(order()).toEqual(['p1', 'p2', 'p3'])
    tab.undo()
    expect(order()).toEqual(['p3', 'p1', 'p2'])
    tab.run('page.update', { id: 'p2', name: 'Offer' })
    expect(readDesign(doc).pages.p2?.name).toBe('Offer')
    expect(() => tab.run('page.move', { id: 'p2', before: 'nope' })).toThrow(/no other page/)
  })

  it('page.delete removes a page with its layers, keeps the last page, and undo brings the layers back', () => {
    const doc = freshDoc()
    const tab = openSession(doc)
    expect(() => tab.run('page.delete', { id: 'p1' })).toThrow(/at least one page/)
    const copy = tab.run('page.duplicate', { id: 'p1' })
    const before = readDesign(doc)

    tab.run('page.delete', { id: 'p1' })
    const after = readDesign(doc)
    expect(after.pages.p1).toBeUndefined()
    expect(after.nodes.box).toBeUndefined()
    expect(after.nodes.headline).toBeUndefined()
    expect(Object.values(after.nodes).every((n) => n.parentId === copy)).toBe(true)

    tab.undo()
    expect(readDesign(doc)).toEqual(before)
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

  describe('z-order', () => {
    /** Five shapes on p1 above box and headline, as ids bottom to top. */
    const stacked = () => {
      const doc = freshDoc()
      const tab = openSession(doc)
      for (const id of ['a', 'b', 'c', 'd', 'e']) tab.run('node.create', { id, parentId: 'p1', layer: badge })
      const order = () => childrenOf(readDesign(doc), 'p1').map(([id]) => id)
      return { doc, tab, order }
    }

    it('node.reorder brings layers forward and back one step, keeping a moved block in order', () => {
      const { tab, order } = stacked()
      expect(order()).toEqual(['box', 'headline', 'a', 'b', 'c', 'd', 'e'])
      tab.run('node.reorder', { ids: ['b'], to: 'forward' })
      expect(order()).toEqual(['box', 'headline', 'a', 'c', 'b', 'd', 'e'])
      tab.run('node.reorder', { ids: ['a', 'c'], to: 'forward' })
      expect(order()).toEqual(['box', 'headline', 'b', 'a', 'c', 'd', 'e'])
      tab.run('node.reorder', { ids: ['d', 'e'], to: 'backward' })
      expect(order()).toEqual(['box', 'headline', 'b', 'a', 'd', 'e', 'c'])
      // Already on top: nothing to do, and nothing written.
      const tabUndo = tab.canUndo()
      tab.run('node.reorder', { ids: ['c'], to: 'forward' })
      expect(order()).toEqual(['box', 'headline', 'b', 'a', 'd', 'e', 'c'])
      expect(tab.canUndo()).toBe(tabUndo)
    })

    it('node.reorder brings layers to the front or back, and undo puts them back', () => {
      const { tab, order } = stacked()
      tab.run('node.reorder', { ids: ['box', 'c'], to: 'front' })
      expect(order()).toEqual(['headline', 'a', 'b', 'd', 'e', 'box', 'c'])
      tab.run('node.reorder', { ids: ['e', 'a'], to: 'back' })
      expect(order()).toEqual(['a', 'e', 'headline', 'b', 'd', 'box', 'c'])
      tab.undo()
      expect(order()).toEqual(['headline', 'a', 'b', 'd', 'e', 'box', 'c'])
      tab.undo()
      expect(order()).toEqual(['box', 'headline', 'a', 'b', 'c', 'd', 'e'])
    })

    it('node.reorder works within each parent', () => {
      const { doc, tab, order } = stacked()
      tab.run('node.create', { id: 'g', parentId: 'p1', layer: { type: 'group', name: 'G', props: { x: 0, y: 0, width: 10, height: 10 } } })
      tab.run('node.create', { id: 'in1', parentId: 'g', layer: badge })
      tab.run('node.create', { id: 'in2', parentId: 'g', layer: badge })
      tab.run('node.reorder', { ids: ['in1', 'a'], to: 'front' })
      expect(order()).toEqual(['box', 'headline', 'b', 'c', 'd', 'e', 'g', 'a'])
      expect(childrenOf(readDesign(doc), 'g').map(([id]) => id)).toEqual(['in2', 'in1'])
    })
  })

  it('node.duplicate copies layers right above themselves, with what is inside them and their overrides', () => {
    const doc = freshDoc()
    const tab = openSession(doc)
    tab.run('node.create', { id: 'g', parentId: 'p1', layer: { type: 'group', name: 'G', props: { x: 0, y: 0, width: 10, height: 10 } } })
    tab.run('node.create', { id: 'dot', parentId: 'g', layer: badge })
    tab.run('node.update', { ids: ['dot'], scope: 'format:banner', patch: { x: 3 } })

    const [box, group, ...rest] = tab.run('node.duplicate', { ids: ['box', 'g', 'dot'] })

    expect(rest).toEqual([])
    const design = readDesign(doc)
    expect(childrenOf(design, 'p1').map(([id]) => id)).toEqual(['box', box, 'headline', 'g', group])
    expect(design.nodes[box ?? '']?.props).toEqual(design.nodes.box?.props)
    const [[dot, copied] = []] = childrenOf(design, group ?? '')
    expect(dot).not.toBe('dot')
    expect(copied?.name).toBe('Badge')
    expect(design.overrides['format:banner']?.[dot ?? '']).toEqual({ x: 3 })
    tab.undo()
    expect(Object.keys(readDesign(doc).nodes).sort()).toEqual(['box', 'dot', 'g', 'headline'])
  })

  it('node.mask makes layers masks in every format and plain again, each one undo step', () => {
    const doc = freshDoc()
    const tab = openSession(doc)
    // A stray format override of the flag goes when the base one is set.
    tab.run('node.update', { ids: ['box'], scope: 'format:banner', patch: { mask: 'luminance' } })
    tab.run('node.mask', { ids: ['box'], mask: 'alpha' })
    let design = readDesign(doc)
    expect(design.nodes.box?.props.mask).toBe('alpha')
    expect(design.overrides['format:banner']?.box).toBeUndefined()
    tab.run('node.mask', { ids: ['box'], mask: null })
    design = readDesign(doc)
    expect(design.nodes.box?.props).not.toHaveProperty('mask')
    tab.undo()
    expect(readDesign(doc).nodes.box?.props.mask).toBe('alpha')
    tab.run('node.lock', { ids: ['box'], lock: { style: true } })
    expect(() => tab.run('node.mask', { ids: ['box'], mask: null })).toThrow(/locked \(style\)/)
  })

  it('node.bind binds a fill, text colour and font to brand tokens and unbinds them, each one undo step (#53)', () => {
    const doc = freshDoc()
    const tab = openSession(doc)
    tab.run('node.bind', { ids: ['box'], target: 'fill', ref: 'brand:primary', value: '#E0262BFF' })
    let design = readDesign(doc)
    expect(design.nodes.box?.bindings).toEqual({ fill: 'brand:primary' })
    // The token's value is stored too, for drawing without the brand kit.
    expect(design.nodes.box?.type === 'graphic' && design.nodes.box.props.fills.at(-1)).toMatchObject({ type: 'solid', color: '#E0262BFF' })
    tab.run('node.bind', { ids: ['headline'], target: 'fontFamily', ref: 'brand:heading', value: 'Playfair Display' })
    tab.run('node.bind', { ids: ['headline'], target: 'textColor', ref: 'brand:primary', value: '#E0262BFF' })
    design = readDesign(doc)
    expect(design.nodes.headline?.bindings).toEqual({ fontFamily: 'brand:heading', textColor: 'brand:primary' })
    expect(design.nodes.headline?.type === 'text' && design.nodes.headline.props.style).toMatchObject({ fontFamily: 'Playfair Display', color: '#E0262BFF' })
    // Unbinding keeps the value; the last binding gone, the key goes.
    tab.run('node.bind', { ids: ['box'], target: 'fill', ref: null })
    design = readDesign(doc)
    expect(design.nodes.box).not.toHaveProperty('bindings')
    expect(design.nodes.box?.type === 'graphic' && design.nodes.box.props.fills.at(-1)).toMatchObject({ color: '#E0262BFF' })
    tab.undo()
    expect(readDesign(doc).nodes.box?.bindings).toEqual({ fill: 'brand:primary' })
    tab.undo()
    tab.undo()
    expect(readDesign(doc).nodes.headline).not.toHaveProperty('bindings')
    // A text layer has no fill, a binding needs the value, and a locked style can't be bound.
    expect(() => tab.run('node.bind', { ids: ['headline'], target: 'fill', ref: 'brand:primary', value: '#E0262BFF' })).toThrow(/a text has no fill/)
    expect(() => tab.run('node.bind', { ids: ['box'], target: 'fill', ref: 'brand:primary' })).toThrow(/needs the value/)
    expect(() => tab.run('node.bind', { ids: ['box'], target: 'fill', ref: 'brand:primary', value: 'red' })).toThrow(/#RRGGBBAA/)
    tab.run('node.lock', { ids: ['box'], lock: { style: true } })
    expect(() => tab.run('node.bind', { ids: ['box'], target: 'fill', ref: null })).toThrow(/locked \(style\)/)
  })

  describe('design.place', () => {
    // A group holding a box and a text, as a copy puts it on the clipboard.
    const tree = () => ({
      roots: ['g'],
      nodes: {
        g: { type: 'group', parentId: 'elsewhere', index: 'a5', name: 'Card', props: { x: 10, y: 20, width: 300, height: 200 } },
        tile: { type: 'graphic', parentId: 'g', index: 'a0', name: 'Tile', props: { x: 10, y: 20, width: 300, height: 200, shape: { kind: 'rect' }, fills: [{ type: 'solid', color: '#2F6BFFFF' }] } },
        label: { type: 'text', parentId: 'g', index: 'a1', name: 'Label', props: { x: 30, y: 40, width: 200, height: 60, text: 'Hi', style: { fontFamily: 'Noto Sans', fontSize: 40, color: '#FFFFFFFF' } } },
      },
    }) satisfies z.input<typeof LayerTree>

    it('places a tree with fresh ids on top, moved by the offset, in one undo step', () => {
      const doc = freshDoc()
      const tab = openSession(doc)
      const [g] = tab.run('design.place', { parentId: 'p1', tree: tree(), dx: 100, dy: 5 })
      const design = readDesign(doc)
      expect(g).not.toBe('g')
      expect(childrenOf(design, 'p1').map(([id]) => id)).toEqual(['box', 'headline', g])
      const inside = childrenOf(design, g ?? '')
      expect(inside.map(([, n]) => n.name)).toEqual(['Tile', 'Label'])
      expect(inside.every(([id]) => !['tile', 'label'].includes(id))).toBe(true)
      expect(design.nodes[g ?? '']?.props).toMatchObject({ x: 110, y: 25 })
      expect(inside[1]?.[1].props).toMatchObject({ x: 130, y: 45, text: 'Hi' })
      tab.undo()
      expect(Object.keys(readDesign(doc).nodes).sort()).toEqual(['box', 'headline'])
    })

    it('placing the same tree twice gives two copies', () => {
      const doc = freshDoc()
      const tab = openSession(doc)
      const [a] = tab.run('design.place', { parentId: 'p1', tree: tree() })
      const [b] = tab.run('design.place', { parentId: 'p1', tree: tree() })
      const design = readDesign(doc)
      expect(a).not.toBe(b)
      expect(childrenOf(design, 'p1').map(([id]) => id)).toEqual(['box', 'headline', a, b])
      expect(Object.keys(design.nodes)).toHaveLength(2 + 6)
    })

    it('refuses a tree that is not whole, holds a layer its parent cannot, loops, or does not fit where it goes', () => {
      const tab = openSession(freshDoc())
      const t = tree()
      expect(() => tab.run('design.place', { parentId: 'p1', tree: { ...t, roots: ['nope'] } })).toThrow(/root "nope" is not in the tree/)
      expect(() => tab.run('design.place', { parentId: 'p1', tree: { ...t, nodes: { ...t.nodes, label: { ...t.nodes.label, parentId: 'gone' } } } })).toThrow(/"label" is neither a root nor inside one/)
      expect(() => tab.run('design.place', { parentId: 'p1', tree: { ...t, nodes: { ...t.nodes, label: { ...t.nodes.label, parentId: 'tile' } } } })).toThrow(/a graphic, which can't hold "label"/)
      const loop = { roots: ['tile'], nodes: { tile: t.nodes.tile, a: { ...t.nodes.g, parentId: 'b' }, b: { ...t.nodes.g, parentId: 'a' } } }
      expect(() => tab.run('design.place', { parentId: 'p1', tree: loop })).toThrow(/is inside itself/)
      expect(() => tab.run('design.place', { parentId: 'p1', tree: { ...t, nodes: { ...t.nodes, tile: { ...t.nodes.tile, props: { ...t.nodes.tile.props, width: -1 } } } } })).toThrow(/width/)
      expect(() => tab.run('design.place', { parentId: 'box', tree: t })).toThrow(/a graphic, which can't hold layers/)
      expect(() => tab.run('design.place', { parentId: 'nowhere', tree: t })).toThrow(/neither a page nor a layer/)
    })
  })

  describe('locks', () => {
    it('node.lock sets flags one by one, and clearing them all drops the field', () => {
      const doc = freshDoc()
      const tab = openSession(doc)
      tab.run('node.lock', { ids: ['box'], lock: { move: true } })
      expect(readDesign(doc).nodes.box?.lock).toEqual({ move: true, resize: false, content: false, style: false, delete: false })
      tab.run('node.lock', { ids: ['box'], lock: { delete: true } })
      expect(readDesign(doc).nodes.box?.lock).toMatchObject({ move: true, delete: true })
      tab.run('node.lock', { ids: ['box'], lock: { move: false, delete: false } })
      expect(readDesign(doc).nodes.box).not.toHaveProperty('lock')
      tab.undo()
      expect(readDesign(doc).nodes.box?.lock).toMatchObject({ move: true, delete: true })
    })

    it('each flag refuses only its own changes, in the base and in every format', () => {
      const doc = freshDoc()
      const tab = openSession(doc)
      const all = { move: true, resize: true, content: true, style: true, delete: true }
      tab.run('node.lock', { ids: ['box', 'headline'], lock: { move: true } })
      expect(() => tab.run('node.update', { ids: ['box'], patch: { x: 1 } })).toThrow(/"box" is locked \(move\)/)
      expect(() => tab.run('node.update', { ids: ['box'], scope: 'format:banner', patch: { y: 1 } })).toThrow(/locked \(move\)/)
      tab.run('node.update', { ids: ['box'], patch: { width: 50, opacity: 0.5 } })
      tab.run('node.update', { ids: ['box'], scope: 'format:banner', patch: { visible: false } })

      tab.run('node.lock', { ids: ['box', 'headline'], lock: all })
      expect(() => tab.run('node.update', { ids: ['box'], patch: { rotation: 15 } })).toThrow(/locked \(resize\)/)
      expect(() => tab.run('node.update', { ids: ['box'], patch: { opacity: 1 } })).toThrow(/locked \(style\)/)
      expect(() => tab.run('text.edit', { id: 'headline', op: { kind: 'insert', at: 0, text: 'Big ' } })).toThrow(/locked \(content\)/)
      expect(() => tab.run('text.edit', { id: 'headline', op: { kind: 'style', at: 0, length: 3, style: { fontWeight: 700 } } })).toThrow(/locked \(style\)/)
      expect(() => tab.run('node.delete', { ids: ['box'] })).toThrow(/locked \(delete\)/)
      // Hiding is not locked, z-order and copies aren't either.
      tab.run('node.update', { ids: ['box'], patch: { visible: false } })
      tab.run('node.reorder', { ids: ['box'], to: 'front' })
      tab.run('node.duplicate', { ids: ['box'] })
      expect(readDesign(doc).nodes.box?.props).toMatchObject({ width: 50, opacity: 0.5, visible: false })
    })

    it('a group with a delete-locked layer inside can\'t be deleted', () => {
      const doc = freshDoc()
      const tab = openSession(doc)
      tab.run('node.create', { id: 'g', parentId: 'p1', layer: { type: 'group', name: 'G', props: { x: 0, y: 0, width: 10, height: 10 } } })
      tab.run('node.create', { id: 'dot', parentId: 'g', layer: badge })
      tab.run('node.lock', { ids: ['dot'], lock: { delete: true } })
      expect(() => tab.run('node.delete', { ids: ['g'] })).toThrow(/"dot" is locked \(delete\)/)
      expect(readDesign(doc).nodes.g).toBeDefined()
    })
  })
})
