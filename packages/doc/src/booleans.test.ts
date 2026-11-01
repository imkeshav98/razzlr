// Live booleans and preset shapes at the commands seam (#44).
import { parseDesign, type DesignInput, type Shape } from '@dazbee/schema'
import { describe, expect, it } from 'vitest'
import type { z } from 'zod'
import { childrenOf, loadDesign, openSession, readDesign } from './index.ts'
import { root } from './design-doc.ts'

const shape = (index: string, x: number, kind: z.input<typeof Shape>, color: string) => ({
  type: 'graphic' as const, parentId: 'p1', index, name: `Shape ${index}`,
  props: { x, y: 100, width: 100, height: 100, shape: kind, fills: [{ type: 'solid' as const, color }] },
})

const design = (): DesignInput => ({
  meta: { schemaVersion: 3, designId: 'd1', name: 'Booleans', kind: 'single', primaryFormatId: 'sq' },
  formats: { sq: { name: 'Square', width: 1080, height: 1080, order: 'a0' }, wide: { name: 'Wide', width: 1200, height: 628, order: 'a1' } },
  pages: { p1: { name: 'Page 1', order: 'a0' } },
  nodes: {
    a: shape('a0', 100, { kind: 'rect', corners: [0, 10, 20, 30] }, '#FF0000FF'),
    b: shape('a1', 150, { kind: 'star', points: 6 }, '#00FF00FF'),
    c: shape('a2', 400, { kind: 'polygon', sides: 3 }, '#0000FFFF'),
    t: { type: 'text', parentId: 'p1', index: 'a3', name: 'Text', props: { x: 0, y: 0, width: 100, height: 40, text: 'Hi', style: { fontFamily: 'Noto Sans', fontSize: 20, color: '#000000FF' } } },
  },
  overrides: { 'format:wide': { b: { x: 300 } } },
})

const open = () => {
  const result = parseDesign(design())
  if (!result.success) throw new Error(result.errors.join('\n'))
  const doc = loadDesign(result.design)
  return { doc, tab: openSession(doc) }
}

describe('node.boolean', () => {
  it('combines shapes where the top one was, painted like the bottom one, hugging them in every format', () => {
    const { doc, tab } = open()
    const id = tab.run('node.boolean', { ids: ['b', 'a'], op: 'subtract' })
    const d = readDesign(doc)
    expect(d.nodes[id]).toMatchObject({ type: 'boolean', name: 'Subtract', parentId: 'p1', index: 'a1' })
    expect(d.nodes[id]?.props).toMatchObject({ op: 'subtract', x: 100, y: 100, width: 150, height: 100, fills: [{ type: 'solid', color: '#FF0000FF' }] })
    expect(d.overrides['format:wide']?.[id]).toEqual({ width: 300 })
    expect(childrenOf(d, id).map(([child]) => child)).toEqual(['a', 'b'])
    // One undo step takes it all back.
    tab.undo()
    expect(readDesign(doc).nodes[id]).toBeUndefined()
    expect(readDesign(doc).nodes.a?.parentId).toBe('p1')
  })

  it('combines only two or more shapes or booleans that share a parent', () => {
    const { tab } = open()
    expect(() => tab.run('node.boolean', { ids: ['a'], op: 'union' })).toThrow(/ids/)
    expect(() => tab.run('node.boolean', { ids: ['a', 't'], op: 'union' })).toThrow(/"t" is a text; only shapes and booleans combine/)
    const group = tab.run('node.group', { ids: ['c'] })
    expect(() => tab.run('node.boolean', { ids: ['a', group], op: 'union' })).toThrow(/is a group; only shapes and booleans combine/)
    expect(() => tab.run('node.boolean', { ids: ['a', 'c'], op: 'union' })).toThrow(/must share a parent/)
    // A boolean of booleans nests.
    const inner = tab.run('node.boolean', { ids: ['a', 'b'], op: 'union' })
    tab.run('node.move', { id: 'c', parentId: 'p1' })
    const outer = tab.run('node.boolean', { ids: [inner, 'c'], op: 'exclude' })
    expect(tab.design().nodes[inner]?.parentId).toBe(outer)
  })

  it('holds only shapes and booleans, however a layer gets there', () => {
    const { doc, tab } = open()
    const id = tab.run('node.boolean', { ids: ['a', 'b'], op: 'intersect' })
    expect(() => tab.run('node.move', { id: 't', parentId: id })).toThrow(/parent "\S+" is a boolean, which holds only shapes and booleans/)
    expect(() => tab.run('node.create', { parentId: id, layer: { type: 'group', name: 'G', props: { x: 0, y: 0, width: 1, height: 1 } } })).toThrow(/holds only shapes/)
    const drawn = tab.run('node.create', { parentId: id, layer: { type: 'graphic', name: 'Cut', props: { x: 120, y: 120, width: 20, height: 20, shape: { kind: 'ellipse' } } } })
    expect(readDesign(doc).nodes[drawn]?.parentId).toBe(id)
    expect(() => tab.run('node.group', { ids: ['a', 'b'] })).toThrow(/holds only shapes/)
    // Another tab's write that puts a text inside it anyway is repaired on read, the same everywhere.
    const repairs: string[] = []
    doc.transact(() => root(doc).nodes.get('t')?.set('parentId', id))
    expect(readDesign(doc, (r) => repairs.push(...r)).nodes.t?.parentId).toBe('p1')
    expect(repairs).toEqual([`"t" lost its parent "${id}"; moved to page "p1"`])
  })

  it('stays live: an edited shape changes it, hug refits it, and ungroup lets the shapes go', () => {
    const { doc, tab } = open()
    const id = tab.run('node.boolean', { ids: ['a', 'b'], op: 'union' })
    tab.run('node.update', { ids: ['b'], patch: { x: 300, shape: { kind: 'star', points: 8, innerRadius: 0.6, cornerRadius: 4 } } })
    tab.run('node.hug', { ids: ['b'] })
    expect(readDesign(doc).nodes[id]?.props).toMatchObject({ x: 100, width: 300 })
    expect(readDesign(doc).nodes.b?.props).toHaveProperty('shape', { kind: 'star', points: 8, innerRadius: 0.6, cornerRadius: 4 })
    tab.run('node.update', { ids: [id], patch: { op: 'exclude' } })
    expect(readDesign(doc).nodes[id]?.props).toMatchObject({ op: 'exclude' })
    const freed = tab.run('node.ungroup', { ids: [id] })
    expect(freed).toEqual(['a', 'b'])
    expect(readDesign(doc).nodes[id]).toBeUndefined()
    expect(readDesign(doc).nodes.a?.parentId).toBe('p1')
  })
})

describe('preset shapes', () => {
  it('keep their parameters through node.update, per format too', () => {
    const { doc, tab } = open()
    tab.run('node.update', { ids: ['c'], patch: { shape: { kind: 'polygon', sides: 8, cornerRadius: 12 } } })
    tab.run('node.update', { ids: ['a'], scope: 'format:wide', patch: { shape: { kind: 'rect', corners: [40, 0, 40, 0] } } })
    tab.run('node.create', { parentId: 'p1', layer: { type: 'graphic', name: 'Arrow', props: { x: 0, y: 500, width: 300, height: 0, rotation: 30, shape: { kind: 'line', end: 'arrow' }, strokes: [{ paint: { type: 'solid', color: '#000000FF' }, width: 4 }] } } })
    const d = readDesign(doc)
    expect(d.nodes.c?.props).toHaveProperty('shape', { kind: 'polygon', sides: 8, cornerRadius: 12 })
    expect(d.overrides['format:wide']?.a?.shape).toEqual({ kind: 'rect', cornerRadius: 0, corners: [40, 0, 40, 0] })
    expect(Object.values(d.nodes).find((n) => n.name === 'Arrow')?.props).toMatchObject({ height: 0, shape: { kind: 'line', start: 'none', end: 'arrow' } })
    expect(() => tab.run('node.update', { ids: ['c'], patch: { shape: { kind: 'polygon', sides: 2 } } })).toThrow(/c.shape.sides/)
    expect(() => tab.run('node.update', { ids: ['b'], patch: { shape: { kind: 'star', innerRadius: 1.5 } } })).toThrow(/b.shape.innerRadius/)
  })
})
