import { describe, expect, it } from 'vitest'
import { align, distribute } from './arrange.ts'
import { boundsOf } from './transform.ts'
import { rulerStep } from './rulers.ts'
import { SNAP_DISTANCE, snapMove, snapResize, snapTargets } from './snap.ts'

const format = { x: 0, y: 0, width: 1080, height: 1080 }
const a = { x: 100, y: 100, width: 200, height: 100 }
const b = { x: 600, y: 400, width: 100, height: 100 }

describe('snapping a move', () => {
  it('lines up edges and centres with other layers and the format, showing why', () => {
    const targets = snapTargets([a, b], format)
    // Its left edge 4 px past A's: it snaps back onto it, and a guide spans both.
    const s = snapMove({ x: 104, y: 300, width: 80, height: 80 }, targets, 6)
    expect(s.dx).toBe(-4)
    expect(s.guides).toContainEqual({ axis: 'x', at: 100, from: 100, to: 380 })
    // Its centre near the format's centre lines up with it.
    const c = snapMove({ x: 497, y: 700, width: 80, height: 80 }, targets, 6)
    expect(c.dx).toBe(3)
    expect(c.guides.some((g) => g.axis === 'x' && g.at === 540)).toBe(true)
  })

  it('reaches as many screen pixels at any zoom', () => {
    const targets = snapTargets([a], format)
    const moving = { x: 112, y: 600, width: 60, height: 60 }
    // 12 design pixels away: out of reach at 100%, in reach at 50% where they are 6 on screen.
    expect(snapMove(moving, targets, SNAP_DISTANCE / 1).dx).toBe(0)
    expect(snapMove(moving, targets, SNAP_DISTANCE / 0.5).dx).toBe(-12)
    expect(snapMove(moving, targets, SNAP_DISTANCE / 4).dx).toBe(0)
  })

  it('snaps a turned layer by the box around it as drawn', () => {
    const turned = boundsOf([{ x: 300, y: 600, width: 100, height: 100, rotation: 45 }])
    const s = snapMove(turned, snapTargets([a], format), 6)
    // Its drawn left edge is at 279.3: 20.7 from A's right edge, so out of reach; its centre 350
    // is not near A's lines either. Moved so its drawn left edge is 3 past A's right, it snaps.
    expect(s.dx).toBe(0)
    const near = { ...turned, x: 303 }
    expect(snapMove(near, snapTargets([a], format), 6).dx).toBeCloseTo(-3)
  })

  it('keeps an axis held still by shift', () => {
    const s = snapMove({ x: 104, y: 103, width: 80, height: 80 }, snapTargets([a], format), 6, { y: true })
    expect(s).toMatchObject({ dx: -4, dy: 0 })
  })

  it('snaps to equal spacing: centred between neighbours, or as far as two others are apart', () => {
    const left = { x: 100, y: 500, width: 100, height: 100 }
    const right = { x: 500, y: 500, width: 100, height: 100 }
    const targets = snapTargets([left, right], format)
    // Centred between them, 100 from each.
    const centred = snapMove({ x: 297, y: 520, width: 100, height: 60 }, targets, 6)
    expect(centred.dx).toBe(3)
    expect(centred.gaps.map((g) => [g.from, g.to])).toEqual([[200, 300], [400, 500]])
    // Past the right one at the same 300 gap the other two have.
    const after = snapMove({ x: 896, y: 520, width: 100, height: 60 }, targets, 6)
    expect(after.dx).toBe(4)
    expect(after.gaps.map((g) => [g.from, g.to])).toEqual([[200, 500], [600, 900]])
  })

  it('stays put with nothing in reach', () => {
    expect(snapMove({ x: 830, y: 820, width: 50, height: 50 }, snapTargets([a, b], format), 6)).toEqual({ dx: 0, dy: 0, guides: [], gaps: [] })
  })
})

describe('snapping a resize', () => {
  it('snaps only the edges the handle moves', () => {
    const targets = snapTargets([a], format)
    // Dragging the east edge to 297: it snaps to A's right edge at 300.
    const s = snapResize({ x: 200, y: 400, width: 97, height: 103 }, 'e', targets, 6)
    expect(s).toMatchObject({ dx: 3, dy: 0 })
    expect(s.guides.every((g) => g.axis === 'x' && g.at === 300)).toBe(true)
    // The south-west corner moves the west and south edges: west to A's left, south to the format's centre.
    const sw = snapResize({ x: 98, y: 400, width: 200, height: 138 }, 'sw', targets, 6)
    expect(sw).toMatchObject({ dx: 2, dy: 2 })
  })
})

describe('align and distribute', () => {
  const boxes = [{ x: 100, y: 100, width: 100, height: 50 }, { x: 300, y: 220, width: 50, height: 100 }, { x: 600, y: 160, width: 80, height: 80 }]

  it('lines several layers up with the box around them', () => {
    expect(align(boxes, 'left', format).map((o) => o.dx)).toEqual([0, -200, -500])
    expect(align(boxes, 'right', format).map((o) => o.dx)).toEqual([480, 330, 0])
    expect(align(boxes, 'centre', format).map((o) => o.dx)).toEqual([240, 65, -250])
    expect(align(boxes, 'bottom', format).map((o) => o.dy)).toEqual([170, 0, 80])
    expect(align(boxes, 'middle', format).map((o) => o.dy)).toEqual([85, -60, 10])
  })

  it('lines one layer up with what holds it', () => {
    expect(align([boxes[0] as never], 'centre', format)).toEqual([{ dx: 390, dy: 0 }])
    expect(align([boxes[0] as never], 'bottom', { x: 0, y: 0, width: 500, height: 400 })).toEqual([{ dx: 0, dy: 250 }])
  })

  it('spaces three or more out evenly between the first and the last', () => {
    // 680 - 100 = 580 across, 230 of it boxes: gaps of 175.
    expect(distribute(boxes, 'horizontal')).toEqual([{ dx: 0, dy: 0 }, { dx: 75, dy: 0 }, { dx: 0, dy: 0 }])
    expect(distribute(boxes.slice(0, 2), 'vertical')).toEqual([{ dx: 0, dy: 0 }, { dx: 0, dy: 0 }])
  })
})

describe('rulers', () => {
  it('number every 1, 2 or 5 times a power of ten that keeps numbers 64 screen pixels apart', () => {
    expect(rulerStep(0.8)).toBe(100)
    expect(rulerStep(1)).toBe(100)
    expect(rulerStep(4)).toBe(20)
    expect(rulerStep(0.1)).toBe(1000)
    expect(rulerStep(32)).toBe(2)
  })
})
