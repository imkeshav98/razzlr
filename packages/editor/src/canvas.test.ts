import { parseDesign } from '@razzlr/schema'
import { describe, expect, it } from 'vitest'
import { fit, toScreen, toWorld, visibleRect, zoomAt } from './camera.ts'
import { COLUMN_GAP, frameAt, frameGrid, intersects, ROW_GAP } from './grid.ts'

const design = (() => {
  const parsed = parseDesign({
    meta: { schemaVersion: 1, designId: 'd', name: 'D', kind: 'carousel', primaryFormatId: 'sq' },
    formats: {
      story: { name: 'Story', width: 1080, height: 1920, order: 'a1' },
      sq: { name: 'Square', width: 1080, height: 1080, order: 'a0' },
      mpu: { name: 'MPU', width: 300, height: 250, order: 'a2' },
    },
    pages: { two: { name: 'Two', order: 'a1' }, one: { name: 'One', order: 'a0' } },
    nodes: {},
  })
  if (!parsed.success) throw new Error(parsed.errors.join('\n'))
  return parsed.design
})()

describe('frame grid', () => {
  it('puts pages in rows and formats in columns, in their order, with nothing stored', () => {
    const { frames, bounds } = frameGrid(design)
    expect(frames.map((f) => f.key)).toEqual(['one/sq', 'one/story', 'one/mpu', 'two/sq', 'two/story', 'two/mpu'])
    expect(frames.find((f) => f.key === 'one/story')).toMatchObject({ x: 1080 + COLUMN_GAP, y: 0 })
    expect(frames.find((f) => f.key === 'two/mpu')).toMatchObject({ x: 2160 + 2 * COLUMN_GAP, y: 1920 + ROW_GAP, width: 300 })
    expect(bounds).toEqual({ x: 0, y: 0, width: 2160 + 300 + 2 * COLUMN_GAP, height: 2 * 1920 + ROW_GAP })
    expect(frameAt(frames, { x: 1080 + COLUMN_GAP + 5, y: 1920 + ROW_GAP + 5 })?.key).toBe('two/story')
    expect(frameAt(frames, { x: 1080 + 5, y: 5 })).toBeUndefined()
  })
})

describe('camera', () => {
  it('keeps the world point under the cursor fixed while zooming', () => {
    const camera = { x: 40, y: -12, zoom: 0.3 }
    const at = { x: 517, y: 233 }
    const before = toWorld(camera, at)
    for (const zoom of [0.05, 1, 7.5]) {
      const after = toWorld(zoomAt(camera, at, zoom), at)
      expect(after.x).toBeCloseTo(before.x, 9)
      expect(after.y).toBeCloseTo(before.y, 9)
    }
  })

  it('fits a rect inside the viewport, centred, and sees what it fits', () => {
    const { bounds } = frameGrid(design)
    const viewport = { width: 1280, height: 800 }
    const camera = fit(bounds, viewport, 48)
    const topLeft = toScreen(camera, bounds)
    const bottomRight = toScreen(camera, { x: bounds.width, y: bounds.height })
    expect(topLeft.x).toBeGreaterThanOrEqual(48 - 1e-9)
    expect(topLeft.y).toBeGreaterThanOrEqual(48 - 1e-9)
    expect(bottomRight.x).toBeLessThanOrEqual(1280 - 48 + 1e-9)
    expect(bottomRight.y).toBeLessThanOrEqual(800 - 48 + 1e-9)
    expect((topLeft.x + bottomRight.x) / 2).toBeCloseTo(640)
    for (const frame of frameGrid(design).frames) expect(intersects(frame, visibleRect(camera, viewport))).toBe(true)
  })
})
