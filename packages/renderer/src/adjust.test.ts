import { describe, expect, it } from 'vitest'
import { after, imageColorMatrix, type ColorMatrix } from './adjust.ts'

const none = { exposure: 0, contrast: 0, saturation: 0, temperature: 0, tint: 0 }
/** A colour in 0…1 through a matrix, alpha 1. */
const apply = (m: ColorMatrix, [r, g, b]: [number, number, number]) =>
  [0, 1, 2].map((row) => (m[row * 5] ?? 0) * r + (m[row * 5 + 1] ?? 0) * g + (m[row * 5 + 2] ?? 0) * b + (m[row * 5 + 3] ?? 0) + (m[row * 5 + 4] ?? 0))

describe('image colour matrix', () => {
  it('is null when nothing is pushed and no filter is set', () => {
    expect(imageColorMatrix(undefined, undefined)).toBeNull()
    expect(imageColorMatrix(none, 'none')).toBeNull()
  })

  it('pushes each adjustment the way its name says', () => {
    const at = (adjust: Partial<typeof none>, c: [number, number, number] = [0.6, 0.4, 0.2]) =>
      apply(imageColorMatrix({ ...none, ...adjust }, undefined) ?? [], c)
    expect(at({ exposure: 100 })).toEqual([1.2, 0.8, 0.4])
    expect(at({ exposure: -100 })[0]).toBeCloseTo(0.3, 10)
    // Contrast about mid grey: grey stays, the rest spreads or flattens.
    expect(at({ contrast: 100 }, [0.5, 0.5, 0.5])).toEqual([0.5, 0.5, 0.5])
    expect(at({ contrast: 100 })[0]).toBeCloseTo(0.7, 10)
    expect(at({ contrast: -100 }).map((v) => +v.toFixed(10))).toEqual([0.5, 0.5, 0.5])
    // No saturation is grey at the same luma.
    const grey = at({ saturation: -100 })
    expect(grey[0]).toBeCloseTo(grey[1] ?? 0, 10)
    expect(grey[0]).toBeCloseTo(0.2126 * 0.6 + 0.7152 * 0.4 + 0.0722 * 0.2, 10)
    const warm = at({ temperature: 50 })
    expect(warm[0]).toBeGreaterThan(0.6)
    expect(warm[2]).toBeLessThan(0.2)
    expect(at({ tint: 50 })[1]).toBeLessThan(0.4)
  })

  it('runs the adjustments in order, then the filter', () => {
    const exposure = imageColorMatrix({ ...none, exposure: 50 }, undefined) ?? []
    const mono = imageColorMatrix(undefined, 'mono') ?? []
    const both = imageColorMatrix({ ...none, exposure: 50 }, 'mono') ?? []
    expect(both).toEqual(after(mono, exposure))
    const c: [number, number, number] = [0.3, 0.6, 0.9]
    expect(apply(both, c)).toEqual(apply(mono, apply(exposure, c) as [number, number, number]))
  })

  it('keeps alpha as it is', () => {
    for (const filter of ['mono', 'sepia', 'vivid', 'fade', 'warm', 'cool'] as const) {
      expect(imageColorMatrix({ exposure: 40, contrast: -20, saturation: 30, temperature: 10, tint: -10 }, filter)?.slice(15)).toEqual([0, 0, 0, 1, 0])
    }
  })
})
