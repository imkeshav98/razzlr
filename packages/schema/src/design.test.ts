import { describe, expect, it } from 'vitest'
import { parseDesign, parseDesignIncrementally } from './index.ts'

/**
 * Parses with the full parser, checking on the way that the incremental one agrees exactly,
 * on a fresh input and again on the same one (the second time from its cache).
 */
const parse = (input: unknown) => {
  const full = parseDesign(input)
  expect(parseDesignIncrementally(structuredClone(input))).toEqual(full)
  expect(parseDesignIncrementally(input)).toEqual(full)
  expect(parseDesignIncrementally(input)).toEqual(full)
  return full
}

/** The smallest valid design: one page, one format, one rectangle. */
const minimal = () => ({
  meta: { schemaVersion: 1, designId: 'd1', name: 'Minimal', kind: 'single', primaryFormatId: 'sq' },
  formats: { sq: { name: 'Square', width: 1080, height: 1080, order: 'a0' } },
  pages: { p1: { name: 'Page 1', order: 'a0', fills: [{ type: 'solid', color: '#FFFFFFFF' }] } },
  nodes: {
    r1: {
      type: 'graphic',
      parentId: 'p1',
      index: 'a0',
      name: 'Box',
      props: {
        x: 100, y: 100, width: 200, height: 100,
        shape: { kind: 'rect' },
        fills: [{ type: 'solid', color: '#FF5A36FF' }],
      },
    },
  },
  overrides: {},
})

describe('parseDesign', () => {
  it('accepts a minimal design and fills in defaults', () => {
    const result = parse(minimal())
    expect(result.success).toBe(true)
    if (!result.success) return
    const box = result.design.nodes.r1
    expect(box?.props.opacity).toBe(1)
    expect(box?.props.rotation).toBe(0)
    expect(box?.props.visible).toBe(true)
  })

  const errorsFor = (mutate: (d: ReturnType<typeof minimal>) => void) => {
    const d = minimal()
    mutate(d)
    const result = parse(d)
    return result.success ? [] : result.errors
  }

  const withBanner = (d: ReturnType<typeof minimal>) =>
    Object.assign(d.formats, { banner: { name: 'Banner', width: 320, height: 50, order: 'a1' } })

  it('accepts format overrides of per-format and shared properties, and fills in their defaults', () => {
    const d = minimal()
    withBanner(d)
    Object.assign(d.overrides, {
      'format:banner': {
        r1: { x: 4, width: 60, visible: false, effects: [{ type: 'dropShadow', x: 0, y: 2, blur: 4, color: '#00000080' }] },
      },
    })
    const result = parse(d)
    if (!result.success) throw new Error(result.errors.join('\n'))
    expect(result.design.overrides['format:banner']?.r1?.effects).toEqual([
      { type: 'dropShadow', x: 0, y: 2, blur: 4, spread: 0, color: '#00000080' },
    ])
  })

  it('rejects colours that are not #RRGGBBAA', () => {
    expect(errorsFor((d) => { d.nodes.r1.props.fills = [{ type: 'solid', color: '#FF5A36' }] }))
      .toEqual(['nodes.r1.props.fills.0.color: colours are #RRGGBBAA'])
  })

  it('rejects a layer whose parent does not exist', () => {
    expect(errorsFor((d) => { d.nodes.r1.parentId = 'ghost' }))
      .toEqual(['nodes.r1.parentId: parent "ghost" is neither a page nor a layer'])
  })

  it('rejects a layer inside a graphic', () => {
    expect(errorsFor((d) => {
      Object.assign(d.nodes, { r2: { ...d.nodes.r1, parentId: 'r1' } })
    })).toEqual(['nodes.r2.parentId: parent "r1" is a graphic, which can\'t hold layers'])
  })

  const group = (parentId: string) => ({ type: 'group', parentId, index: 'a0', name: 'G', props: { x: 0, y: 0, width: 10, height: 10 } })

  it('rejects groups that contain each other', () => {
    expect(errorsFor((d) => { Object.assign(d.nodes, { g1: group('g2'), g2: group('g1') }) }))
      .toEqual(['nodes.g1.parentId: "g1" is inside itself', 'nodes.g2.parentId: "g2" is inside itself'])
  })

  it('names only the layers in a cycle, not a layer hanging below it', () => {
    expect(errorsFor((d) => { Object.assign(d.nodes, { g0: group('g1'), g1: group('g2'), g2: group('g1') }) }))
      .toEqual(['nodes.g1.parentId: "g1" is inside itself', 'nodes.g2.parentId: "g2" is inside itself'])
  })

  it('rejects a text run that ends past the text', () => {
    expect(errorsFor((d) => {
      Object.assign(d.nodes, {
        t1: {
          type: 'text', parentId: 'p1', index: 'a1', name: 'Headline',
          props: {
            x: 0, y: 0, width: 500, height: 80, text: 'Sale',
            style: { fontFamily: 'Noto Sans', fontSize: 64, color: '#000000FF' },
            runs: [{ start: 0, end: 9, style: { fontWeight: 700 } }],
          },
        },
      })
    })).toEqual(['nodes.t1.props.runs.0.end: run ends at 9 but the text is 4 UTF-16 units long'])
  })

  it('rejects a format override of text that leaves a style run past its end', () => {
    expect(errorsFor((d) => {
      withBanner(d)
      Object.assign(d.nodes, {
        t1: {
          type: 'text', parentId: 'p1', index: 'a1', name: 'Headline',
          props: {
            x: 0, y: 0, width: 500, height: 80, text: 'Summer sale',
            style: { fontFamily: 'Noto Sans', fontSize: 64, color: '#000000FF' },
            runs: [{ start: 7, end: 11, style: { fontWeight: 700 } }],
          },
        },
      })
      Object.assign(d.overrides, { 'format:banner': { t1: { text: 'Sale' } } })
    })).toEqual(['overrides.format:banner.t1.runs.0.end: run ends at 11 but the text is 4 UTF-16 units long'])
  })

  it('rejects overrides for unknown formats, layers and properties, and invalid values', () => {
    expect(errorsFor((d) => {
      Object.assign(d.overrides, {
        'format:nope': { r1: { x: 1 } },
        'format:sq': { ghost: { x: 1 }, r1: { text: 'hi', opacity: 2 } },
      })
    })).toEqual([
      'overrides.format:nope: no format "nope"',
      'overrides.format:sq.ghost: no layer "ghost"',
      'overrides.format:sq.r1.text: a graphic has no property "text"',
      'overrides.format:sq.r1.opacity: Too big: expected number to be <=1',
    ])
  })
})

describe('text runs', () => {
  it('keep only the style keys they set, so the rest come from the base style', () => {
    const d = minimal() as ReturnType<typeof minimal> & { nodes: Record<string, unknown> }
    d.nodes.t1 = {
      type: 'text', parentId: 'p1', index: 'a1', name: 'Headline',
      props: {
        x: 0, y: 0, width: 500, height: 80, text: 'Sale', style: { fontFamily: 'Noto Sans', fontSize: 64, color: '#000000FF', fontWeight: 700 },
        runs: [{ start: 0, end: 2, style: { color: '#FF0000FF' } }],
      },
    }
    const result = parse(d)
    if (!result.success) throw new Error(result.errors.join('\n'))
    const t1 = result.design.nodes.t1
    expect(t1?.type === 'text' && t1.props.runs).toEqual([{ start: 0, end: 2, style: { color: '#FF0000FF' } }])
  })
})

describe('parseDesignIncrementally', () => {
  it('reuses the validated layer for an unchanged layer object, and validates a replaced one again', () => {
    const d = minimal()
    const r2 = { ...d.nodes.r1, name: 'Second' }
    const nodes = { ...d.nodes, r2 }
    const first = parseDesignIncrementally({ ...d, nodes })
    const changed = { ...d, nodes: { ...nodes, r2: { ...r2, props: { ...r2.props, x: 5 } } } }
    const second = parseDesignIncrementally(changed)
    if (!first.success || !second.success) throw new Error('expected both to parse')
    expect(second.design.nodes.r1).toBe(first.design.nodes.r1)
    expect(second.design.nodes.r2).not.toBe(first.design.nodes.r2)
    expect(second.design.nodes.r2?.props.x).toBe(5)
  })

  it('accepts its own output as input and returns the same layers', () => {
    const first = parseDesignIncrementally(minimal())
    if (!first.success) throw new Error('expected a design')
    const again = parseDesignIncrementally(first.design)
    if (!again.success) throw new Error('expected a design')
    expect(again.design.nodes.r1).toBe(first.design.nodes.r1)
    expect(again.design).toEqual(first.design)
  })
})
