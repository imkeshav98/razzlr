import { parseDesign, type Design, type DesignInput } from '@dazbee/schema'
import { describe, expect, it } from 'vitest'
import { render, sceneMemo } from './scene.ts'

const input = (): DesignInput => ({
  meta: { schemaVersion: 2, designId: 'd1', name: 'Test', kind: 'single', primaryFormatId: 'sq' },
  formats: {
    sq: { name: 'Square', width: 1080, height: 1080, order: 'a0' },
    banner: { name: 'Banner', width: 320, height: 50, order: 'a1' },
  },
  pages: {
    p1: { name: 'Page 1', order: 'a0', fills: [{ type: 'solid', color: '#FFFFFFFF' }] },
    p2: { name: 'Page 2', order: 'a1' },
  },
  nodes: {
    frame: { type: 'frame', parentId: 'p1', index: 'a1', name: 'Frame', props: { x: 0, y: 0, width: 500, height: 500 } },
    box: {
      type: 'graphic', parentId: 'frame', index: 'a0', name: 'Box',
      props: { x: 100, y: 100, width: 200, height: 100, shape: { kind: 'rect' }, fills: [{ type: 'solid', color: '#FF5A36FF' }] },
    },
    hidden: {
      type: 'graphic', parentId: 'frame', index: 'a1', name: 'Hidden',
      props: { x: 0, y: 0, width: 10, height: 10, visible: false, shape: { kind: 'ellipse' } },
    },
    headline: {
      type: 'text', parentId: 'p1', index: 'a0', name: 'Headline',
      props: { x: 60, y: 600, width: 960, height: 100, text: 'Summer sale', style: { fontFamily: 'Noto Sans', fontSize: 84, color: '#111111FF' } },
    },
    other: {
      type: 'graphic', parentId: 'p2', index: 'a0', name: 'Other page',
      props: { x: 0, y: 0, width: 10, height: 10, shape: { kind: 'rect' } },
    },
  },
  overrides: { 'format:banner': { headline: { text: 'Sale', x: 4 }, hidden: { visible: true } } },
})

const design = (): Design => {
  const parsed = parseDesign(input())
  if (!parsed.success) throw new Error(parsed.errors.join('\n'))
  return parsed.design
}

describe('render', () => {
  it('builds the page tree in index order, with the format size and the page fills', () => {
    const scene = render(design(), 'p1', 'sq')
    expect(scene).toMatchObject({ width: 1080, height: 1080, fills: [{ type: 'solid', color: '#FFFFFFFF' }] })
    expect(scene.layers.map((l) => l.id)).toEqual(['headline', 'frame'])
    expect(scene.layers[1]?.children.map((l) => l.id)).toEqual(['box'])
  })

  it('leaves out hidden layers', () => {
    const ids = render(design(), 'p1', 'sq').layers.flatMap((l) => [l.id, ...l.children.map((c) => c.id)])
    expect(ids).not.toContain('hidden')
  })

  it("applies the format's overrides on top of the base props", () => {
    const scene = render(design(), 'p1', 'banner')
    expect(scene).toMatchObject({ width: 320, height: 50 })
    expect(scene.layers[0]).toMatchObject({ id: 'headline', props: { text: 'Sale', x: 4, y: 600 } })
    expect(scene.layers[1]?.children.map((l) => l.id)).toEqual(['box', 'hidden'])
  })

  it('only takes layers from the page asked for', () => {
    expect(render(design(), 'p2', 'sq').layers.map((l) => l.id)).toEqual(['other'])
  })

  it('does not change the design', () => {
    const d = design()
    const before = structuredClone(d)
    render(d, 'p1', 'banner')
    expect(d).toEqual(before)
  })

  it('refuses a page or format the design does not have', () => {
    expect(() => render(design(), 'nope', 'sq')).toThrow('no page "nope"')
    expect(() => render(design(), 'p1', 'nope')).toThrow('no format "nope"')
  })

  it('with a memo, keeps a layer object while its node, override and children are the same objects', () => {
    const memo = sceneMemo()
    const d = design()
    const first = render(d, 'p1', 'sq', memo)
    const [headline, frame] = first.layers
    // A new snapshot that changes only the box, the way the editor's design does.
    const box = d.nodes['box']
    if (box?.type !== 'graphic') throw new Error('no box')
    const next: Design = { ...d, nodes: { ...d.nodes, box: { ...box, props: { ...box.props, x: 140 } } } }
    const second = render(next, 'p1', 'sq', memo)
    expect(second.layers[0]).toBe(headline)
    expect(second.layers[1]).not.toBe(frame)
    expect(second.layers[1]?.children[0]?.props.x).toBe(140)
    // An override in another format changes nothing here, and the same snapshot gives the same layers.
    const third = render({ ...next, overrides: { 'format:banner': { headline: { x: 1 } } } }, 'p1', 'sq', memo)
    expect(third.layers[0]).toBe(headline)
    expect(third.layers[1]).toBe(second.layers[1])
    expect(render(next, 'p1', 'banner', memo).layers[0]).not.toBe(headline)
  })
})
