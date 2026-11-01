// Switching a frame to auto layout at the commands seam (#46): node.autoLayout reads the settings
// off where the children are, so every child is where it was, in every format, once laid out.
import { loadDesign, openSession, readDesign } from '@dazbee/doc'
import { parseDesign, type DesignInput } from '@dazbee/schema'
import { describe, expect, it } from 'vitest'
import type { MeasureText } from './layout.ts'
import { render, type SceneLayer } from './scene.ts'

// Each character 10 wide, one line 20 tall.
const measure: MeasureText = (props, width) => ({ width: width ?? props.text.length * 10, height: 20 })

type Node = DesignInput['nodes'][string]
const rect = (parentId: string, index: string, x: number, y: number, width: number, height: number, more: Record<string, unknown> = {}): Node =>
  ({ type: 'graphic', parentId, index, name: index, props: { x, y, width, height, shape: { kind: 'rect' }, ...more } }) as Node
const label = (parentId: string, index: string, x: number, y: number, text: string): Node =>
  ({ type: 'text', parentId, index, name: text, props: { x, y, width: text.length * 10, height: 20, text, boxMode: 'autoWidth', style: { fontFamily: 'Noto Sans', fontSize: 16, color: '#000000FF' } } }) as Node

const design = (): DesignInput => ({
  meta: { schemaVersion: 2, designId: 'd', name: 'Switch', kind: 'single', primaryFormatId: 'sq' },
  formats: { sq: { name: 'Square', width: 1080, height: 1080, order: 'a0' }, wide: { name: 'Wide', width: 1200, height: 628, order: 'a1' } },
  pages: { p1: { name: 'Page 1', order: 'a0' } },
  nodes: {
    // A row centred across, 20 apart, its children out of order in the layer list.
    bar: { type: 'frame', parentId: 'p1', index: 'a0', name: 'Bar', props: { x: 100, y: 100, width: 600, height: 200 } },
    big: rect('bar', 'a0', 300, 120, 100, 100),
    small: rect('bar', 'a1', 120, 140, 100, 60),
    word: label('bar', 'a2', 240, 160, 'Sale'),
    badge: rect('bar', 'a3', 650, 90, 30, 30, { absolute: true }),
    // A column lined up at the end, 8 apart.
    list: { type: 'frame', parentId: 'p1', index: 'a1', name: 'List', props: { x: 100, y: 400, width: 300, height: 300 } },
    one: rect('list', 'a0', 180, 420, 200, 40),
    two: rect('list', 'a1', 280, 468, 100, 40),
  },
  // In the wide format the bar sits elsewhere and its children are spread wider.
  overrides: { 'format:wide': { bar: { x: 500, y: 300 }, big: { x: 740, y: 320 }, small: { x: 520, y: 340 }, word: { x: 660, y: 360 }, badge: { x: 1050, y: 290 } } },
})

function boxes(json: unknown, formatId: string) {
  const parsed = parseDesign(json)
  if (!parsed.success) throw new Error(parsed.errors.join('\n'))
  const all = new Map<string, { x: number; y: number; width: number; height: number }>()
  const walk = (layers: SceneLayer[]) => layers.forEach((l) => {
    all.set(l.id, { x: l.props.x, y: l.props.y, width: l.props.width, height: l.props.height })
    walk(l.children)
  })
  walk(render(parsed.design, 'p1', formatId, undefined, measure).layers)
  return all
}

describe('node.autoLayout', () => {
  it('lays the children out where they already were, in every format, within half a pixel', () => {
    const parsed = parseDesign(design())
    if (!parsed.success) throw new Error(parsed.errors.join('\n'))
    const doc = loadDesign(parsed.design)
    const tab = openSession(doc)
    const before = { sq: boxes(readDesign(doc), 'sq'), wide: boxes(readDesign(doc), 'wide') }
    tab.gesture(() => {
      tab.run('node.autoLayout', { id: 'bar', on: true })
      tab.run('node.autoLayout', { id: 'list', on: true })
    })
    const d = readDesign(doc)
    expect(d.nodes.bar?.props).toMatchObject({ layout: { direction: 'row', gap: 20, align: 'center', padding: { left: 20, top: 20 } } })
    expect(d.nodes.list?.props).toMatchObject({ layout: { direction: 'column', gap: 8, align: 'end', padding: { right: 20, top: 20 } } })
    // The wide format's children are 40 apart there, so it gets its own gap.
    expect(d.overrides['format:wide']?.bar?.layout).toMatchObject({ direction: 'row', gap: 40 })
    // The flow's order is the children's order on the page; the absolute badge keeps its place.
    const order = Object.entries(d.nodes).filter(([, n]) => n.parentId === 'bar').sort(([, a], [, b]) => (a.index < b.index ? -1 : 1)).map(([id]) => id)
    expect(order).toEqual(['small', 'word', 'big', 'badge'])
    for (const formatId of ['sq', 'wide'] as const) {
      const after = boxes(d, formatId)
      for (const [id, was] of before[formatId]) {
        const now = after.get(id)
        for (const key of ['x', 'y', 'width', 'height'] as const) expect(Math.abs((now?.[key] ?? NaN) - was[key]), `${formatId} ${id}.${key}`).toBeLessThanOrEqual(0.5)
      }
    }
    // One undo step takes it off again; off removes it everywhere.
    tab.undo()
    expect(readDesign(doc).nodes.bar?.props).not.toHaveProperty('layout')
    tab.redo()
    tab.run('node.autoLayout', { id: 'bar', on: false })
    expect(readDesign(doc).nodes.bar?.props).not.toHaveProperty('layout')
    expect(readDesign(doc).overrides['format:wide']?.bar).not.toHaveProperty('layout')
    expect(() => tab.run('node.autoLayout', { id: 'big', on: true })).toThrow(/"big" is a graphic; only frames have auto layout/)
  })
})
