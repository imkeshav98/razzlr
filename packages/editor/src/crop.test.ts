import { describe, expect, it } from 'vitest'
import { coverCrop, cropOf, imageRect, panned, scaled } from './crop.ts'

const image = { width: 2000, height: 1000 }
const box = { x: 100, y: 100, width: 400, height: 400 }

describe('crop', () => {
  it('starts from the crop fill shows, and goes between crop and image rect both ways', () => {
    const crop = coverCrop(image, box)
    expect(crop).toEqual({ x: 500, y: 0, width: 1000, height: 1000 })
    const rect = imageRect(crop, image, box)
    expect(rect).toEqual({ x: -100, y: 100, width: 800, height: 400 })
    expect(cropOf(rect, image, box)).toEqual(crop)
  })

  it('pans the image, stopping where an edge would come into the box', () => {
    const rect = imageRect(coverCrop(image, box), image, box)
    expect(panned(rect, box, 50, 0).x).toBe(-50)
    expect(panned(rect, box, 500, 0).x).toBe(100)
    expect(panned(rect, box, -500, 0).x).toBe(-300)
    // It is exactly as tall as the box: it can't move up or down.
    expect(panned(rect, box, 0, 30).y).toBe(100)
  })

  it('scales from a corner about the opposite one, keeping its aspect and covering the box', () => {
    const rect = imageRect(coverCrop(image, box), image, box)
    // Bottom end corner dragged out by half again: the top start corner stays.
    const bigger = scaled(rect, box, 2, { x: -100 + 1200, y: 100 + 600 })
    expect(bigger).toEqual({ x: -100, y: 100, width: 1200, height: 600 })
    const crop = cropOf(bigger, image, box)
    expect([crop.x, crop.y, crop.width, crop.height].map((v) => v.toFixed(6))).toEqual([1000 / 3, 0, 2000 / 3, 2000 / 3].map((v) => v.toFixed(6)))
    // Dragged in past the box, it stops at the least size that still covers it.
    expect(scaled(rect, box, 2, { x: 0, y: 0 })).toEqual(rect)
    // The top start corner, dragged out: the bottom end corner stays.
    const fromStart = scaled(bigger, box, 0, { x: -400, y: -50 })
    expect(fromStart.x + fromStart.width).toBe(1100)
    expect(fromStart.y + fromStart.height).toBe(700)
    expect(fromStart.width / fromStart.height).toBe(2)
  })
})
