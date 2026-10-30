// Image fills (#48) drawn on the CPU surface: each adjustment and filter turns a flat colour into
// what its colour matrix says, so the matrix's added column is in the units Skia reads; and masks
// keep what follows them only where they are opaque or bright, up to the next mask.
import { imageColorMatrix, renderDesign } from '@razzlr/renderer'
import { loadCanvasKit } from '@razzlr/renderer/node'
import type { ImageAdjust, ImageFilter } from '@razzlr/schema'
import { describe, expect, it } from 'vitest'
import { fixtureResources } from './pixels.ts'

const ck = await loadCanvasKit()
const SIZE = 40
const BASE = [150, 100, 60] as const

/** A flat SIZE×SIZE PNG of one colour, as bytes we made. */
function flat([r, g, b]: readonly number[]): Uint8Array {
  const pixels = new Uint8Array(SIZE * SIZE * 4)
  for (let i = 0; i < pixels.length; i += 4) pixels.set([r ?? 0, g ?? 0, b ?? 0, 255], i)
  const image = ck.MakeImage({ width: SIZE, height: SIZE, colorType: ck.ColorType.RGBA_8888, alphaType: ck.AlphaType.Unpremul, colorSpace: ck.ColorSpace.SRGB }, pixels, SIZE * 4)
  const png = image?.encodeToBytes()
  image?.delete()
  if (!png) throw new Error('could not make the flat image')
  return png
}

const bytes = { ...fixtureResources(), images: { flat: flat(BASE) } }
type Node = Record<string, unknown>
const rect = (index: string, props: Record<string, unknown>, parentId = 'p1'): Node =>
  ({ type: 'graphic', parentId, index, name: index, props: { x: 0, y: 0, width: 100, height: 100, shape: { kind: 'rect' }, ...props } })
const design = (nodes: Record<string, Node>) => ({
  meta: { schemaVersion: 2, designId: 'd', name: 'Image fills', kind: 'single', primaryFormatId: 'f' },
  formats: { f: { name: 'F', width: 100, height: 100, order: 'a0' } },
  pages: { p1: { name: 'Page', order: 'a0', fills: [{ type: 'solid', color: '#FFFFFFFF' }] } },
  nodes,
  overrides: {},
})
const draw = (nodes: Record<string, Node>) => renderDesign(ck, design(nodes), 'p1', 'f', bytes)
const at = (r: { pixels: Uint8Array; width: number }, x: number, y: number) => [...r.pixels.slice((y * r.width + x) * 4, (y * r.width + x) * 4 + 4)]
const solid = (color: string) => [{ type: 'solid', color }]

describe('image adjustments and filters', () => {
  type Case = { adjust?: Partial<ImageAdjust>; filter?: ImageFilter }
  const cases: Case[] = [
    ...(['exposure', 'contrast', 'saturation', 'temperature', 'tint'] as const).flatMap((key) => [-60, 60].map((v) => ({ adjust: { [key]: v } }))),
    ...(['mono', 'sepia', 'vivid', 'fade', 'warm', 'cool'] as const).map((filter) => ({ filter })),
    { adjust: { exposure: 30, contrast: 40, saturation: -50, temperature: 20, tint: -20 }, filter: 'vivid' },
  ]
  it.each(cases)('draws %j as its colour matrix says', (paint) => {
    const adjust = paint.adjust && { exposure: 0, contrast: 0, saturation: 0, temperature: 0, tint: 0, ...paint.adjust }
    const fill = { type: 'image', assetId: 'flat', fit: 'fill', ...(adjust && { adjust }), ...(paint.filter && { filter: paint.filter }) }
    const drawn = at(draw({ a: rect('a0', { fills: [fill] }) }), 50, 50)
    const m = imageColorMatrix(adjust, paint.filter) ?? []
    const [r, g, b] = BASE.map((v) => v / 255)
    const expected = [0, 1, 2].map((row) => Math.round(255 * Math.min(1, Math.max(0,
      (m[row * 5] ?? 0) * (r ?? 0) + (m[row * 5 + 1] ?? 0) * (g ?? 0) + (m[row * 5 + 2] ?? 0) * (b ?? 0) + (m[row * 5 + 3] ?? 0) + (m[row * 5 + 4] ?? 0)))))
    for (const [i, v] of expected.entries()) expect(Math.abs((drawn[i] ?? 0) - v)).toBeLessThanOrEqual(1)
    expect(drawn[3]).toBe(255)
    expect(drawn.slice(0, 3)).not.toEqual([...BASE])
  })
})

describe('masks', () => {
  const RED = [255, 0, 0, 255]
  const WHITE = [255, 255, 255, 255]

  it('an alpha mask keeps what follows it inside its shape, and is not drawn itself', () => {
    const r = draw({
      m: rect('a0', { x: 20, y: 20, width: 60, height: 60, shape: { kind: 'ellipse' }, fills: solid('#0000FFFF'), mask: 'alpha' }),
      a: rect('a1', { fills: solid('#FF0000FF') }),
    })
    expect(at(r, 50, 50)).toEqual(RED)
    expect(at(r, 5, 5)).toEqual(WHITE)
    // Just inside the ellipse's box but outside its curve.
    expect(at(r, 23, 23)).toEqual(WHITE)
  })

  it('a translucent mask lets through as much as it is opaque', () => {
    const r = draw({
      m: rect('a0', { fills: solid('#00000080'), mask: 'alpha' }),
      a: rect('a1', { fills: solid('#FF0000FF') }),
    })
    // Half red over white.
    const [red = 0, green = 0] = at(r, 50, 50)
    expect(red).toBe(255)
    expect(Math.abs(green - 127)).toBeLessThanOrEqual(1)
  })

  it('a luminance mask keeps what follows where it is bright, and hides where it draws nothing', () => {
    const r = draw({
      m: rect('a0', { width: 50, fills: [{ type: 'linear', from: { x: 0, y: 0 }, to: { x: 1, y: 0 }, stops: [{ offset: 0, color: '#000000FF' }, { offset: 1, color: '#FFFFFFFF' }] }], mask: 'luminance' }),
      a: rect('a1', { fills: solid('#FF0000FF') }),
    })
    // Near black lets little red through, near white nearly all.
    expect(at(r, 1, 50)[1]).toBeGreaterThan(240)
    expect(at(r, 48, 50)[1]).toBeLessThan(20)
    const [, mid = 0] = at(r, 25, 50)
    expect(mid).toBeGreaterThan(90)
    expect(mid).toBeLessThan(160)
    // Past the mask's box it is transparent, so dark.
    expect(at(r, 75, 50)).toEqual(WHITE)
  })

  it('masks only up to the next mask, inside its own parent; a hidden mask masks nothing', () => {
    const r = draw({
      g: { type: 'group', parentId: 'p1', index: 'a0', name: 'g', props: { x: 0, y: 0, width: 100, height: 100 } },
      m1: rect('a0', { width: 50, height: 100, fills: solid('#000000FF'), mask: 'alpha' }, 'g'),
      a: rect('a1', { fills: solid('#FF0000FF') }, 'g'),
      m2: rect('a2', { x: 50, width: 50, height: 50, fills: solid('#000000FF'), mask: 'alpha' }, 'g'),
      b: rect('a3', { y: 40, height: 20, fills: solid('#0000FFFF') }, 'g'),
      // After the group: not masked.
      c: rect('a1', { x: 90, y: 90, width: 10, height: 10, fills: solid('#00FF00FF') }),
      hidden: rect('a2', { width: 10, height: 10, fills: solid('#000000FF'), mask: 'alpha', visible: false }),
      d: rect('a3', { x: 60, y: 80, width: 10, height: 10, fills: solid('#FFFF00FF') }),
    })
    expect(at(r, 10, 10)).toEqual(RED)
    expect(at(r, 75, 75)).toEqual(WHITE)
    // The blue band shows only under the second mask, and over the red it is masked away.
    expect(at(r, 75, 45)).toEqual([0, 0, 255, 255])
    expect(at(r, 25, 45)).toEqual(RED)
    expect(at(r, 75, 55)).toEqual(WHITE)
    expect(at(r, 95, 95)).toEqual([0, 255, 0, 255])
    expect(at(r, 65, 85)).toEqual([255, 255, 0, 255])
  })
})
