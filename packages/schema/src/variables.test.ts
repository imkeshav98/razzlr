import { describe, expect, it } from 'vitest'
import { parseDesign, fontFamilies, type Design } from './design.ts'
import { bindProps, BrandToken, VariableRef } from './variables.ts'

const red = '#E0262BFF'
const navy = '#14213DFF'

describe('brand kit bindings (#53)', () => {
  it('names tokens as lowercase words and refs as brand:<token>', () => {
    expect(BrandToken.safeParse('sale-red').success).toBe(true)
    expect(BrandToken.safeParse('Sale Red').success).toBe(false)
    expect(VariableRef.safeParse('brand:primary').success).toBe(true)
    expect(VariableRef.safeParse('brand:').success).toBe(false)
    expect(VariableRef.safeParse('feed:primary').success).toBe(false)
  })

  it('sets the topmost solid fill from the brand colour, and keeps the stored one without a value', () => {
    const props = { fills: [{ type: 'solid', color: navy }, { type: 'linear' }, { type: 'solid', color: '#FFFFFFFF' }] }
    const bound = bindProps('graphic', props, { fill: 'brand:primary' }, { 'brand:primary': red })
    expect(bound.fills).toEqual([{ type: 'solid', color: navy }, { type: 'linear' }, { type: 'solid', color: red }])
    // No value for the token, no variables at all, or a value that isn't a colour: as stored.
    expect(bindProps('graphic', props, { fill: 'brand:primary' }, { 'brand:accent': red })).toBe(props)
    expect(bindProps('graphic', props, { fill: 'brand:primary' }, undefined)).toBe(props)
    expect(bindProps('graphic', props, { fill: 'brand:primary' }, { 'brand:primary': 'Inter' })).toBe(props)
  })

  it('sets text colour and font family on the base style only', () => {
    const props = { style: { fontFamily: 'Noto Sans', color: navy, fontSize: 40 }, runs: [{ start: 0, end: 2, style: { color: '#00FF00FF' } }] }
    const bound = bindProps('text', props, { textColor: 'brand:primary', fontFamily: 'brand:heading' }, { 'brand:primary': red, 'brand:heading': 'Playfair Display' })
    expect(bound.style).toEqual({ fontFamily: 'Playfair Display', color: red, fontSize: 40 })
    expect(bound.runs).toBe(props.runs)
    // A text layer has no fill to bind, a graphic no text.
    expect(bindProps('text', props, { fill: 'brand:primary' }, { 'brand:primary': red })).toBe(props)
  })

  it('stores bindings on a layer, and fontFamilies adds the bound brand family', () => {
    const json = {
      meta: { schemaVersion: 3, designId: 'd', name: 'Kit', kind: 'single', primaryFormatId: 'sq' },
      formats: { sq: { name: 'Square', width: 100, height: 100, order: 'a0' } },
      pages: { p1: { name: 'Page 1', order: 'a0' } },
      nodes: {
        t: { type: 'text', parentId: 'p1', index: 'a0', name: 'T', bindings: { fontFamily: 'brand:heading' }, props: { x: 0, y: 0, width: 10, height: 10, text: 'Hi', style: { fontFamily: 'Noto Sans', fontSize: 10, color: navy } } },
      },
      overrides: {},
    }
    const parsed = parseDesign(json)
    if (!parsed.success) throw new Error(parsed.errors.join('\n'))
    const design: Design = parsed.design
    expect(design.nodes.t?.bindings).toEqual({ fontFamily: 'brand:heading' })
    expect(fontFamilies(design)).toEqual(['Noto Sans'])
    expect(fontFamilies(design, { 'brand:heading': 'Playfair Display' })).toEqual(['Noto Sans', 'Playfair Display'])
    expect(parseDesign({ ...json, nodes: { t: { ...json.nodes.t, bindings: { fontFamily: 'brand:Heading' } } } }).success).toBe(false)
  })
})
