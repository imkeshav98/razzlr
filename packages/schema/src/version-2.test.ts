// Schema version 2 (#43): angular gradients, stroke dashes, caps and joins, inner shadow, glow,
// background blur and pass-through groups, and the migration that brings version 1 designs up.
import { describe, expect, it } from 'vitest'
import { migrateDesign, parseDesign, parseDesignIncrementally, SCHEMA_VERSION } from './index.ts'

type Json = Record<string, unknown>

/** Both parsers, which must agree. */
const parse = (input: unknown) => {
  const full = parseDesign(input)
  expect(parseDesignIncrementally(structuredClone(input))).toEqual(full)
  return full
}

/** One page holding `nodes`, at `version`. */
const designWith = (nodes: Json, version = SCHEMA_VERSION, overrides: Json = {}) => ({
  meta: { schemaVersion: version, designId: 'd1', name: 'D', kind: 'single', primaryFormatId: 'sq' },
  formats: { sq: { name: 'Square', width: 1080, height: 1080, order: 'a0' }, wide: { name: 'Wide', width: 1200, height: 628, order: 'a1' } },
  pages: { p1: { name: 'Page 1', order: 'a0' } },
  nodes,
  overrides,
})
const rect = (props: Json = {}, index = 'a0', parentId = 'p1') =>
  ({ type: 'graphic', parentId, index, name: 'Box', props: { x: 0, y: 0, width: 100, height: 100, shape: { kind: 'rect' }, ...props } })
const group = (props: Json = {}, type = 'group') =>
  ({ type, parentId: 'p1', index: 'a0', name: 'Group', props: { x: 0, y: 0, width: 100, height: 100, ...props } })

const props = (input: unknown, id = 'r') => {
  const result = parse(input)
  if (!result.success) throw new Error(result.errors.join('\n'))
  return result.design.nodes[id]?.props as Json
}
const errors = (input: unknown) => {
  const result = parse(input)
  return result.success ? [] : result.errors
}

const stops = [{ offset: 0, color: '#FF0000FF' }, { offset: 1, color: '#0000FFFF' }]

describe('angular gradients', () => {
  it('take a centre, stops and a start angle that defaults to 0', () => {
    const fill = props(designWith({ r: rect({ fills: [{ type: 'angular', center: { x: 0.5, y: 0.5 }, stops }] }) })).fills
    expect(fill).toEqual([{ type: 'angular', center: { x: 0.5, y: 0.5 }, angle: 0, stops }])
    // On a stroke too, turned.
    const stroke = props(designWith({ r: rect({ strokes: [{ paint: { type: 'angular', center: { x: 0, y: 1 }, angle: -90, stops }, width: 2 }] }) })).strokes as Json[]
    expect(stroke[0]?.paint).toMatchObject({ type: 'angular', angle: -90 })
  })

  it('need two stops and a centre', () => {
    expect(errors(designWith({ r: rect({ fills: [{ type: 'angular', center: { x: 0.5, y: 0.5 }, stops: stops.slice(1) }] }) })))
      .toEqual(['nodes.r.props.fills.0.stops: Too small: expected array to have >=2 items'])
    expect(errors(designWith({ r: rect({ fills: [{ type: 'angular', stops }] }) })))
      .toEqual(['nodes.r.props.fills.0.center: Invalid input: expected object, received undefined'])
  })
})

describe('strokes', () => {
  it('default to solid, butt-capped and mitred at 4, as before', () => {
    const [stroke] = props(designWith({ r: rect({ strokes: [{ paint: { type: 'solid', color: '#000000FF' }, width: 4 }] }) })).strokes as Json[]
    expect(stroke).toEqual({ paint: { type: 'solid', color: '#000000FF' }, width: 4, align: 'center', dashes: [], dashOffset: 0, cap: 'butt', join: 'miter', miterLimit: 4 })
  })

  it('take dashes, an offset, caps, joins and a miter limit', () => {
    const stroke = { paint: { type: 'solid', color: '#000000FF' }, width: 4, dashes: [10, 0, 5], dashOffset: -3, cap: 'round', join: 'bevel', miterLimit: 1 }
    expect((props(designWith({ r: rect({ strokes: [stroke] }) })).strokes as Json[])[0]).toMatchObject(stroke)
  })

  it('refuse negative or all-zero dashes, unknown caps and joins, and a miter limit under 1', () => {
    const bad = (extra: Json) => errors(designWith({ r: rect({ strokes: [{ paint: { type: 'solid', color: '#000000FF' }, width: 4, ...extra }] }) }))
    expect(bad({ dashes: [4, -1] })).toEqual(['nodes.r.props.strokes.0.dashes.1: Too small: expected number to be >=0'])
    expect(bad({ dashes: [0, 0] })).toEqual(['nodes.r.props.strokes.0.dashes: dashes need a length above 0'])
    expect(bad({ cap: 'pointy' })).toEqual(['nodes.r.props.strokes.0.cap: Invalid option: expected one of "butt"|"round"|"square"'])
    expect(bad({ join: 'mitre' })).toEqual(['nodes.r.props.strokes.0.join: Invalid option: expected one of "miter"|"round"|"bevel"'])
    expect(bad({ miterLimit: 0.5 })).toEqual(['nodes.r.props.strokes.0.miterLimit: Too small: expected number to be >=1'])
  })
})

describe('effects', () => {
  it('add inner shadow, glow and background blur, with spreads defaulting to 0', () => {
    const effects = props(designWith({ r: rect({ effects: [
      { type: 'innerShadow', x: 2, y: 3, blur: 4, color: '#00000080' },
      { type: 'glow', blur: 10, color: '#FF00FFFF' },
      { type: 'backgroundBlur', radius: 20 },
    ] }) })).effects
    expect(effects).toEqual([
      { type: 'innerShadow', x: 2, y: 3, blur: 4, spread: 0, color: '#00000080' },
      { type: 'glow', blur: 10, spread: 0, color: '#FF00FFFF' },
      { type: 'backgroundBlur', radius: 20 },
    ])
  })

  it('refuse negative blurs and spreads, and unknown effects', () => {
    const bad = (effect: Json) => errors(designWith({ r: rect({ effects: [effect] }) }))
    expect(bad({ type: 'innerShadow', x: 0, y: 0, blur: 1, spread: -1, color: '#000000FF' })).toEqual(['nodes.r.props.effects.0.spread: Too small: expected number to be >=0'])
    expect(bad({ type: 'glow', blur: -1, color: '#000000FF' })).toEqual(['nodes.r.props.effects.0.blur: Too small: expected number to be >=0'])
    expect(bad({ type: 'backgroundBlur', radius: -2 })).toEqual(['nodes.r.props.effects.0.radius: Too small: expected number to be >=0'])
    expect(bad({ type: 'outerGlow', blur: 1, color: '#000000FF' })).toHaveLength(1)
  })
})

describe('pass-through', () => {
  it('is what groups and frames blend with unless they say otherwise', () => {
    expect(props(designWith({ r: group() })).blendMode).toBe('pass-through')
    expect(props(designWith({ r: group({}, 'frame') })).blendMode).toBe('pass-through')
    expect(props(designWith({ r: group({ blendMode: 'normal' }) })).blendMode).toBe('normal')
    expect(props(designWith({ r: group({ blendMode: 'multiply' }, 'frame') })).blendMode).toBe('multiply')
  })

  it('belongs to containers only', () => {
    expect(errors(designWith({ r: rect({ blendMode: 'pass-through' }) }))).toHaveLength(1)
    expect(props(designWith({ r: rect() })).blendMode).toBe('normal')
  })
})

describe('migration from version 1', () => {
  const v1 = () => designWith({
    g: group({ blendMode: 'normal', opacity: 0.5 }),
    f: { ...group({}, 'frame'), index: 'a1' },
    m: { ...group({ blendMode: 'multiply' }), index: 'a2' },
    r: rect({ blendMode: 'normal' }, 'a0', 'g'),
  }, 1, {
    'format:wide': { g: { blendMode: 'normal', x: 4 }, m: { blendMode: 'normal' }, r: { blendMode: 'normal' } },
  })

  it('turns normal and unset container blending into pass-through, which drew the same', () => {
    const input = v1()
    const before = structuredClone(input)
    const result = parse(input)
    if (!result.success) throw new Error(result.errors.join('\n'))
    const { design } = result
    expect(design.meta.schemaVersion).toBe(2)
    expect(design.nodes.g?.props).toMatchObject({ blendMode: 'pass-through', opacity: 0.5 })
    expect(design.nodes.f?.props.blendMode).toBe('pass-through')
    // Other modes, and layers that aren't containers, stay as they were.
    expect(design.nodes.m?.props.blendMode).toBe('multiply')
    expect(design.nodes.r?.props.blendMode).toBe('normal')
    // Format overrides too.
    expect(design.overrides['format:wide']).toEqual({ g: { blendMode: 'pass-through', x: 4 }, m: { blendMode: 'pass-through' }, r: { blendMode: 'normal' } })
    // The input is not changed.
    expect(input).toEqual(before)
  })

  it('leaves a design already at this version, a newer one and non-designs alone', () => {
    const current = designWith({ g: group({ blendMode: 'normal' }) })
    expect(migrateDesign(current)).toBe(current)
    expect(props(current, 'g').blendMode).toBe('normal')
    const newer = designWith({}, SCHEMA_VERSION + 1)
    expect(migrateDesign(newer)).toBe(newer)
    expect(errors(newer)).toEqual(['meta.schemaVersion: Invalid input: expected 2'])
    for (const junk of [null, 'design', [], { meta: { schemaVersion: 1 } }]) expect(() => migrateDesign(junk)).not.toThrow()
  })

  it('still reports a broken version 1 design, at the paths it was saved with', () => {
    const broken = designWith({ r: rect({ fills: [{ type: 'solid', color: 'red' }] }) }, 1)
    expect(errors(broken)).toEqual(['nodes.r.props.fills.0.color: colours are #RRGGBBAA'])
  })
})
