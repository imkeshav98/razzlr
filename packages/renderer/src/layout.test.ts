// The auto layout solver (#46), through scene building, with text measured by a stand-in: each
// character 10 wide, lines 20 tall, words wrapped at the width given.
import { parseDesign, type DesignInput } from '@razzlr/schema'
import { describe, expect, it } from 'vitest'
import type { MeasureText } from './layout.ts'
import { render, type SceneLayer } from './scene.ts'

const measure: MeasureText = (props, width) => {
  const natural = Math.max(...props.text.split('\n').map((l) => l.length * 10))
  if (width === null) return { width: natural, height: 20 * props.text.split('\n').length }
  let lines = 0
  for (const paragraph of props.text.split('\n')) {
    let line = 0
    lines++
    for (const word of paragraph.split(' ')) {
      const add = (line > 0 ? 1 : 0) * 10 + word.length * 10
      if (line > 0 && line + add > width) {
        lines++
        line = word.length * 10
      } else {
        line += add
      }
    }
  }
  return { width, height: 20 * lines }
}

type Node = DesignInput['nodes'][string]
const box = (x: number, y: number, width: number, height: number) => ({ x, y, width, height })
const rect = (parentId: string, index: string, props: Record<string, unknown>): Node =>
  ({ type: 'graphic', parentId, index, name: index, props: { ...box(0, 0, 10, 10), shape: { kind: 'rect' }, ...props } }) as Node
const text = (parentId: string, index: string, value: string, props: Record<string, unknown> = {}): Node =>
  ({ type: 'text', parentId, index, name: index, props: { ...box(0, 0, 10, 10), text: value, style: { fontFamily: 'Noto Sans', fontSize: 16, color: '#000000FF' }, boxMode: 'autoWidth', ...props } }) as Node
const frame = (parentId: string, index: string, props: Record<string, unknown>): Node =>
  ({ type: 'frame', parentId, index, name: index, props: { ...box(0, 0, 100, 100), ...props } }) as Node

function scene(nodes: Record<string, Node>) {
  const result = parseDesign({
    meta: { schemaVersion: 2, designId: 'd', name: 'Layout', kind: 'single', primaryFormatId: 'sq' },
    formats: { sq: { name: 'Square', width: 1080, height: 1080, order: 'a0' } },
    pages: { p1: { name: 'Page 1', order: 'a0' } },
    nodes,
    overrides: {},
  })
  if (!result.success) throw new Error(result.errors.join('\n'))
  const all = new Map<string, SceneLayer>()
  const walk = (layers: SceneLayer[]) => layers.forEach((l) => { all.set(l.id, l); walk(l.children) })
  walk(render(result.design, 'p1', 'sq', undefined, measure).layers)
  return (id: string) => {
    const l = all.get(id)
    if (!l) throw new Error(`no ${id}`)
    return box(l.props.x, l.props.y, l.props.width, l.props.height)
  }
}

const layout = (props: Record<string, unknown>) => ({ direction: 'row', ...props })

describe('auto layout (#46)', () => {
  it('runs children along a row or down a column, gap apart inside the paddings', () => {
    const padding = { top: 10, right: 20, bottom: 30, left: 40 }
    const row = scene({
      f: frame('p1', 'a0', { ...box(100, 100, 400, 200), layout: layout({ gap: 12, padding }) }),
      a: rect('f', 'a0', box(0, 0, 50, 20)),
      b: rect('f', 'a1', box(999, 999, 60, 40)),
    })
    expect(row('a')).toEqual(box(140, 110, 50, 20))
    expect(row('b')).toEqual(box(202, 110, 60, 40))
    const column = scene({
      f: frame('p1', 'a0', { ...box(100, 100, 400, 200), layout: layout({ direction: 'column', gap: 12, padding }) }),
      a: rect('f', 'a0', box(0, 0, 50, 20)),
      b: rect('f', 'a1', box(0, 0, 60, 40)),
    })
    expect(column('a')).toEqual(box(140, 110, 50, 20))
    expect(column('b')).toEqual(box(140, 142, 60, 40))
  })

  it('sizes children fixed, hugging their text or filling what is left, and the frame hugging them', () => {
    const get = scene({
      f: frame('p1', 'a0', { ...box(0, 0, 500, 100), layout: layout({ gap: 10, padding: { top: 5, right: 5, bottom: 5, left: 5 } }) }),
      fixed: rect('f', 'a0', box(0, 0, 50, 30)),
      label: text('f', 'a1', 'Buy now'),
      grow: rect('f', 'a2', { ...box(0, 0, 10, 10), sizing: { width: 'fill', height: 'fill' } }),
      grow2: rect('f', 'a3', { ...box(0, 0, 10, 10), sizing: { width: 'fill', height: 'fixed' } }),
      btn: frame('p1', 'a1', { ...box(0, 200, 10, 10), sizing: { width: 'hug', height: 'hug' }, layout: layout({ padding: { top: 8, right: 16, bottom: 8, left: 16 } }) }),
      btnLabel: text('btn', 'a0', 'Shop the sale'),
    })
    expect(get('label')).toEqual(box(65, 5, 70, 20))
    // 490 inside, less 50, 70 and three gaps, shared by the two that fill.
    expect(get('grow')).toEqual(box(145, 5, 170, 90))
    expect(get('grow2')).toEqual(box(325, 5, 170, 10))
    expect(get('btn')).toEqual(box(0, 200, 162, 36))
    expect(get('btnLabel')).toEqual(box(16, 208, 130, 20))
  })

  it('lines children up along the flow and across it', () => {
    const at = (justify: string, align: string) => scene({
      f: frame('p1', 'a0', { ...box(0, 0, 300, 100), layout: layout({ gap: 10, justify, align }) }),
      a: rect('f', 'a0', box(0, 0, 50, 20)),
      b: rect('f', 'a1', box(0, 0, 50, 40)),
    })
    expect([at('center', 'center')('a'), at('center', 'center')('b')]).toEqual([box(95, 40, 50, 20), box(155, 30, 50, 40)])
    expect([at('end', 'end')('a'), at('end', 'end')('b')]).toEqual([box(190, 80, 50, 20), box(250, 60, 50, 40)])
    expect([at('space-between', 'start')('a'), at('space-between', 'start')('b')]).toEqual([box(0, 0, 50, 20), box(250, 0, 50, 40)])
  })

  it('takes negative gaps and paddings, so children overlap and spill out', () => {
    const get = scene({
      f: frame('p1', 'a0', { ...box(100, 100, 10, 10), sizing: { width: 'hug', height: 'hug' }, layout: layout({ gap: -20, padding: { top: -5, right: 0, bottom: 0, left: -10 } }) }),
      a: rect('f', 'a0', box(0, 0, 50, 50)),
      b: rect('f', 'a1', box(0, 0, 50, 50)),
    })
    expect(get('a')).toEqual(box(90, 95, 50, 50))
    expect(get('b')).toEqual(box(120, 95, 50, 50))
    expect(get('f')).toEqual(box(100, 100, 70, 45))
  })

  it('wraps onto more lines, lineGap apart, and a hugging frame grows to hold them', () => {
    const get = scene({
      f: frame('p1', 'a0', { ...box(0, 0, 130, 10), sizing: { width: 'fixed', height: 'hug' }, layout: layout({ gap: 10, wrap: true, lineGap: 5 }) }),
      a: rect('f', 'a0', box(0, 0, 60, 20)),
      b: rect('f', 'a1', box(0, 0, 60, 30)),
      c: rect('f', 'a2', box(0, 0, 60, 20)),
    })
    expect(get('a')).toEqual(box(0, 0, 60, 20))
    expect(get('b')).toEqual(box(70, 0, 60, 30))
    expect(get('c')).toEqual(box(0, 35, 60, 20))
    expect(get('f')).toEqual(box(0, 0, 130, 55))
  })

  it('nests: a card hugs a column of a title that wraps at the card\'s width and a button that hugs its label', () => {
    const get = scene({
      card: frame('p1', 'a0', { ...box(100, 100, 200, 10), sizing: { width: 'fixed', height: 'hug' }, layout: layout({ direction: 'column', gap: 12, padding: { top: 20, right: 20, bottom: 20, left: 20 } }) }),
      title: text('card', 'a0', 'Fresh roast every morning', { boxMode: 'autoHeight', sizing: { width: 'fill', height: 'hug' } }),
      btn: frame('card', 'a1', { ...box(0, 0, 10, 10), sizing: { width: 'hug', height: 'hug' }, layout: layout({ padding: { top: 8, right: 16, bottom: 8, left: 16 } }) }),
      label: text('btn', 'a0', 'Order'),
      badge: rect('card', 'a2', { ...box(280, 90, 30, 30), absolute: true }),
    })
    // 160 wide: "Fresh roast every" (170) doesn't fit, so two lines.
    expect(get('title')).toEqual(box(120, 120, 160, 40))
    expect(get('btn')).toEqual(box(120, 172, 82, 36))
    expect(get('label')).toEqual(box(136, 180, 50, 20))
    expect(get('card')).toEqual(box(100, 100, 200, 128))
    // Absolute children stay put.
    expect(get('badge')).toEqual(box(280, 90, 30, 30))
  })

  it('moves what a group holds with it, and leaves frames without auto layout alone', () => {
    const get = scene({
      f: frame('p1', 'a0', { ...box(0, 0, 500, 100), layout: layout({ gap: 10 }) }),
      g: { type: 'group', parentId: 'f', index: 'a0', name: 'g', props: box(300, 300, 40, 40) } as Node,
      inG: rect('g', 'a0', box(310, 310, 20, 20)),
      plain: frame('p1', 'a1', box(600, 600, 100, 100)),
      inPlain: rect('plain', 'a0', box(650, 650, 10, 10)),
    })
    expect(get('g')).toEqual(box(0, 0, 40, 40))
    expect(get('inG')).toEqual(box(10, 10, 20, 20))
    expect(get('inPlain')).toEqual(box(650, 650, 10, 10))
  })
})
