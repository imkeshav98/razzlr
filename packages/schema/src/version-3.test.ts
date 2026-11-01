// Schema version 3 (#219): every paint has an opacity of its own and can be hidden, and a version 2
// design comes up as it is.
import { describe, expect, it } from 'vitest'
import { migrateDesign, parseDesign, SCHEMA_VERSION } from './index.ts'

type Json = Record<string, unknown>

const designWith = (fills: unknown[], version = SCHEMA_VERSION, overrides: Json = {}) => ({
  meta: { schemaVersion: version, designId: 'd1', name: 'D', kind: 'single', primaryFormatId: 'sq' },
  formats: { sq: { name: 'Square', width: 1080, height: 1080, order: 'a0' } },
  pages: { p1: { name: 'Page 1', order: 'a0', fills } },
  nodes: { r: { type: 'graphic', parentId: 'p1', index: 'a0', name: 'Box', props: { x: 0, y: 0, width: 100, height: 100, shape: { kind: 'rect' }, fills, strokes: [{ paint: fills[0], width: 2 }] } } },
  overrides,
})
const stops = [{ offset: 0, color: '#FF0000FF' }, { offset: 1, color: '#0000FFFF' }]
const paints = [
  { type: 'solid', color: '#FF0000FF', opacity: 0.5, visible: false },
  { type: 'linear', from: { x: 0, y: 0 }, to: { x: 1, y: 1 }, stops, opacity: 0.25 },
  { type: 'radial', center: { x: 0.5, y: 0.5 }, radius: 0.5, stops, visible: false },
  { type: 'angular', center: { x: 0.5, y: 0.5 }, angle: 30, stops, opacity: 0 },
  { type: 'image', assetId: 'a1', fit: 'fill', opacity: 0.8, visible: false },
]

describe('paint opacity and visibility', () => {
  it('every kind of paint keeps an opacity and a hidden flag, on layers, strokes, pages and in overrides', () => {
    const result = parseDesign(designWith(paints, SCHEMA_VERSION, { 'format:sq': { r: { fills: paints } } }))
    if (!result.success) throw new Error(result.errors.join('\n'))
    const { design } = result
    expect(design.pages.p1?.fills).toEqual(paints)
    expect(design.nodes.r?.props).toMatchObject({ fills: paints, strokes: [{ paint: paints[0] }] })
    expect(design.overrides['format:sq']?.r?.fills).toEqual(paints)
  })

  it('leaves both out when a paint has neither: it is opaque and shows', () => {
    const result = parseDesign(designWith([{ type: 'solid', color: '#FF0000FF' }]))
    if (!result.success) throw new Error(result.errors.join('\n'))
    expect(result.design.pages.p1?.fills).toEqual([{ type: 'solid', color: '#FF0000FF' }])
  })

  it('refuses an opacity outside 0 to 1', () => {
    const result = parseDesign(designWith([{ type: 'solid', color: '#FF0000FF', opacity: 1.5 }]))
    expect(result.success ? [] : result.errors).toContain('pages.p1.fills.0.opacity: Too big: expected number to be <=1')
  })
})

describe('migration from version 2', () => {
  it('brings a version 2 design up as it is, at version 3', () => {
    const v2 = designWith([{ type: 'solid', color: '#FF0000FF' }], 2)
    const migrated = migrateDesign(v2) as ReturnType<typeof designWith>
    expect(migrated.meta.schemaVersion).toBe(3)
    expect({ ...migrated, meta: { ...migrated.meta, schemaVersion: 2 } }).toEqual(v2)
    expect(parseDesign(v2).success).toBe(true)
  })
})
