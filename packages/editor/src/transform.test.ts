import { describe, expect, it } from 'vitest'
import { boundsOf, carry, centreOf, cornersOf, normalAngle, resize, scaleWithin, snapAngle, type Box } from './transform.ts'

const box: Box = { x: 100, y: 100, width: 200, height: 100, rotation: 0 }
const near = (b: Box) => Object.fromEntries(Object.entries(b).map(([k, v]) => [k, Math.round(v * 1000) / 1000]))

describe('resize', () => {
  it('moves only the dragged edge or corner, keeping the opposite one', () => {
    expect(resize(box, 'se', { x: 400, y: 250 })).toEqual({ x: 100, y: 100, width: 300, height: 150, rotation: 0 })
    expect(resize(box, 'w', { x: 50, y: 999 })).toEqual({ x: 50, y: 100, width: 250, height: 100, rotation: 0 })
    expect(resize(box, 'n', { x: 0, y: 150 })).toEqual({ x: 100, y: 150, width: 200, height: 50, rotation: 0 })
  })

  it('stops at the opposite edge instead of turning the box inside out', () => {
    expect(resize(box, 'e', { x: 20, y: 0 })).toMatchObject({ x: 100, width: 0 })
  })

  it('keeps proportions with shift, following the side that moved more', () => {
    expect(resize(box, 'se', { x: 500, y: 210 }, { keepRatio: true })).toEqual({ x: 100, y: 100, width: 400, height: 200, rotation: 0 })
    // An edge handle grows the other side about its middle.
    expect(resize(box, 'e', { x: 500, y: 0 }, { keepRatio: true })).toEqual({ x: 100, y: 50, width: 400, height: 200, rotation: 0 })
  })

  it('works from the centre with alt', () => {
    expect(resize(box, 'e', { x: 350, y: 0 }, { fromCentre: true })).toEqual({ x: 50, y: 100, width: 300, height: 100, rotation: 0 })
    expect(resize(box, 'se', { x: 400, y: 200 }, { fromCentre: true, keepRatio: true })).toEqual({ x: 0, y: 50, width: 400, height: 200, rotation: 0 })
  })

  it('resizes a turned box along its own sides, keeping the opposite corner where it is on the page', () => {
    const turned = { ...box, rotation: 90 }
    const [nw] = cornersOf(turned)
    // Turned a quarter, the box's east side faces down the page.
    const se = cornersOf(turned)[2] as { x: number; y: number }
    const out = resize(turned, 'se', { x: se.x - 50, y: se.y + 100 })
    expect(near(out)).toMatchObject({ width: 300, height: 150, rotation: 90 })
    expect(cornersOf(out)[0]?.x).toBeCloseTo(nw?.x ?? 0)
    expect(cornersOf(out)[0]?.y).toBeCloseTo(nw?.y ?? 0)
  })
})

describe('carrying layers along', () => {
  it('scales a layer inside a resized group with it', () => {
    const inner = { x: 150, y: 125, width: 50, height: 50, rotation: 30 }
    expect(carry(inner, box, { x: 100, y: 100, width: 400, height: 50, rotation: 0 })).toEqual({ x: 200, y: 112.5, width: 100, height: 25, rotation: 30 })
  })

  it('scales a layer within a selection about the selection, sized along its own sides', () => {
    const from = { x: 0, y: 0, width: 100, height: 100, rotation: 0 }
    const to = { x: 0, y: 0, width: 200, height: 100, rotation: 0 }
    expect(scaleWithin({ x: 10, y: 10, width: 20, height: 10, rotation: 0 }, from, to)).toEqual({ x: 20, y: 10, width: 40, height: 10, rotation: 0 })
    const quarter = scaleWithin({ x: 10, y: 10, width: 20, height: 10, rotation: 90 }, from, to)
    expect(near(quarter)).toMatchObject({ width: 20, height: 20, rotation: 90 })
    expect(centreOf(quarter)).toEqual({ x: 40, y: 15 })
  })
})

describe('angles and bounds', () => {
  it('keeps angles in (-180, 180] and snaps to 15° steps', () => {
    expect(normalAngle(190)).toBe(-170)
    expect(normalAngle(-180)).toBe(180)
    expect(snapAngle(37)).toBe(30)
    expect(snapAngle(-8)).toBe(-15)
  })

  it('bounds turned boxes as they are drawn', () => {
    const b = boundsOf([{ x: 0, y: 0, width: 100, height: 100, rotation: 45 }, { x: 200, y: 0, width: 10, height: 10, rotation: 0 }])
    expect(near(b)).toEqual({ x: -20.711, y: -20.711, width: 230.711, height: 141.421, rotation: 0 })
  })
})
