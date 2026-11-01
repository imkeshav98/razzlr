// Brand kits (#53) at the render seam: a layer bound to a brand colour or font draws with the
// brand's value, so changing the brand colour changes the drawn design; without a value it draws
// as stored. Exports pass through the same seam, in Node and in the browser alike.
import { renderDesign } from '@dazbee/renderer'
import { loadCanvasKit } from '@dazbee/renderer/node'
import { describe, expect, it } from 'vitest'
import { fixtureResources } from './pixels.ts'

const ck = await loadCanvasKit()
const design = {
  meta: { schemaVersion: 2, designId: 'd', name: 'Brand kit', kind: 'single', primaryFormatId: 'f' },
  formats: { f: { name: 'F', width: 200, height: 100, order: 'a0' }, wide: { name: 'Wide', width: 400, height: 100, order: 'a1' } },
  pages: { p1: { name: 'Page', order: 'a0', fills: [{ type: 'solid', color: '#FFFFFFFF' }] } },
  nodes: {
    box: {
      type: 'graphic', parentId: 'p1', index: 'a0', name: 'Box', bindings: { fill: 'brand:primary' },
      props: { x: 0, y: 0, width: 100, height: 100, shape: { kind: 'rect' }, fills: [{ type: 'solid', color: '#14213DFF' }] },
    },
    word: {
      type: 'text', parentId: 'p1', index: 'a1', name: 'Word', bindings: { textColor: 'brand:primary', fontFamily: 'brand:heading' },
      props: { x: 100, y: 0, width: 100, height: 100, text: '■■', style: { fontFamily: 'Noto Sans', fontSize: 60, color: '#14213DFF' } },
    },
  },
  // A format that moves the box keeps it bound.
  overrides: { 'format:wide': { box: { x: 300 } } },
}
const draw = (variables?: Record<string, string>, formatId = 'f') => renderDesign(ck, design, 'p1', formatId, { ...fixtureResources(), ...(variables ? { variables } : {}) })
const at = (r: { pixels: Uint8Array; width: number }, x: number, y: number) => [...r.pixels.slice((y * r.width + x) * 4, (y * r.width + x) * 4 + 3)]
/** Every distinct opaque colour in a region, so text's anti-aliased edges don't count. */
const inked = (r: { pixels: Uint8Array; width: number }, x0: number, x1: number) => {
  const seen = new Set<string>()
  for (let y = 0; y < 100; y++) for (let x = x0; x < x1; x++) if (r.pixels[(y * r.width + x) * 4 + 3] === 255 && at(r, x, y).join() !== '255,255,255') seen.add(at(r, x, y).join())
  return seen
}

describe('brand kit bindings at the render seam (#53)', () => {
  it('draws a bound fill and text in the brand colour, and in the new one after it changes', () => {
    const red = draw({ 'brand:primary': '#E0262BFF', 'brand:heading': 'Noto Sans' })
    expect(at(red, 50, 50)).toEqual([224, 38, 43])
    expect(inked(red, 100, 200).has('224,38,43')).toBe(true)
    const green = draw({ 'brand:primary': '#1F9D55FF', 'brand:heading': 'Noto Sans' })
    expect(at(green, 50, 50)).toEqual([31, 157, 85])
    expect(inked(green, 100, 200).has('31,157,85')).toBe(true)
    expect(inked(green, 100, 200).has('224,38,43')).toBe(false)
    // In every format, overrides and all.
    expect(at(draw({ 'brand:primary': '#1F9D55FF' }, 'wide'), 350, 50)).toEqual([31, 157, 85])
  })

  it('draws the stored values without a brand value', () => {
    expect(at(draw(), 50, 50)).toEqual([20, 33, 61])
    expect(at(draw({ 'brand:accent': '#E0262BFF' }), 50, 50)).toEqual([20, 33, 61])
  })

  it('sets bound text in the brand font', () => {
    const word = (family: string) => draw({ 'brand:primary': '#14213DFF', 'brand:heading': family }).png
    expect(Buffer.from(word('Noto Sans')).equals(Buffer.from(word('Noto Sans')))).toBe(true)
    expect(Buffer.from(word('Noto Naskh Arabic')).equals(Buffer.from(word('Noto Sans')))).toBe(false)
  })
})
