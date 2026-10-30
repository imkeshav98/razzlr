import { describe, expect, it } from 'vitest'
import {
  constrain, cubicOf, deleteAnchors, formatPath, hitPath, isSmooth, moveAnchors, moveControl, nearestOnCubic, parsePath, pathBounds, pointAt, splitSegment, type Anchor, type PenPath,
} from './path.ts'

const drop = (path: PenPath) => JSON.parse(JSON.stringify(path)) as PenPath
const close = (a: { x: number; y: number }, b: { x: number; y: number }, digits = 6) => {
  expect(a.x).toBeCloseTo(b.x, digits)
  expect(a.y).toBeCloseTo(b.y, digits)
}

describe('path data (#45)', () => {
  it('reads every command and writes M, L, C and Z back', () => {
    const path = parsePath('M10 10 L110 10 C150 10 150 90 110 90 H10 Z')
    expect(drop(path)).toEqual([{ closed: true, anchors: [{ x: 10, y: 10 }, { x: 110, y: 10, out: { x: 150, y: 10 } }, { x: 110, y: 90, in: { x: 150, y: 90 } }, { x: 10, y: 90 }] }])
    expect(formatPath(path)).toBe('M10 10 L110 10 C150 10 150 90 110 90 L10 90 Z')
    // Relative commands, implicit lines after a move, smooth cubics and quadratics.
    const relative = parsePath('m0 0 10 0 v10 h-10 z m20 0 c0 -10 10 -10 10 0 s10 10 10 0 q5 -5 10 0 t10 0')
    expect(relative).toHaveLength(2)
    expect(formatPath(relative)).toBe('M0 0 L10 0 L10 10 L0 10 Z M20 0 C20 -10 30 -10 30 0 C30 10 40 10 40 0 C43.33 -3.33 46.67 -3.33 50 0 C53.33 3.33 56.67 3.33 60 0')
    // A curve ending on its start closes into it, keeping the last handle as the first anchor's in.
    const loop = parsePath('M0 0 C10 -10 20 -10 30 0 C20 10 10 10 0 0 Z')
    expect(loop[0]?.anchors).toHaveLength(2)
    expect(loop[0]?.anchors[0]?.in).toEqual({ x: 10, y: 10 })
    expect(formatPath(loop, { x: -5, y: -5 })).toBe('M5 5 C15 -5 25 -5 35 5 C25 15 15 15 5 5 Z')
    expect(() => parsePath('M0 0 L10')).toThrow(/expected a number/)
  })

  it('turns arcs into cubics that stay on the ellipse, compact flags included', () => {
    const path = parsePath('M0 100 A100 100 0 01 200 100')
    const anchors = path[0]?.anchors as Anchor[]
    expect(anchors).toHaveLength(3)
    close(anchors[1] as Anchor, { x: 100, y: 0 })
    close(anchors[2] as Anchor, { x: 200, y: 100 })
    // Every point of each cubic lies within a hair of the circle of radius 100 about (100, 100).
    for (let i = 0; i < 2; i++) {
      const cubic = cubicOf(anchors[i] as Anchor, anchors[i + 1] as Anchor)
      for (let t = 0; t <= 1; t += 0.125) {
        const p = pointAt(cubic, t)
        expect(Math.abs(Math.hypot(p.x - 100, p.y - 100) - 100)).toBeLessThan(0.03)
      }
    }
  })

  it('bounds the outline, curves and all, not the handles', () => {
    expect(pathBounds(parsePath('M0 0 C0 -100 100 -100 100 0'))).toEqual({ x: 0, y: -75, width: 100, height: 75 })
    expect(pathBounds(parsePath('M10 20 L50 20'))).toEqual({ x: 10, y: 20, width: 40, height: 0 })
    expect(pathBounds([])).toBeNull()
  })
})

describe('editing a path (#45)', () => {
  const path = () => parsePath('M0 0 C0 -50 100 -50 100 0 L100 100 L0 100 Z')

  it('hits shown handles first, then anchors, then segments, each within reach', () => {
    const p = path()
    // The handle at (100, -50) is only there to grab when its anchor shows its handles.
    expect(hitPath(p, { x: 101, y: -49 }, 5)).toBeNull()
    expect(hitPath(p, { x: 101, y: -49 }, 5, [{ contour: 0, index: 1 }])).toEqual({ kind: 'control', ref: { contour: 0, index: 1 }, side: 'in' })
    expect(hitPath(p, { x: 98, y: 3 }, 5)).toEqual({ kind: 'anchor', ref: { contour: 0, index: 1 } })
    const onCurve = hitPath(p, { x: 50, y: -36 }, 5)
    expect(onCurve).toMatchObject({ kind: 'segment', contour: 0, from: 0 })
    expect((onCurve as { t: number }).t).toBeCloseTo(0.5, 2)
    // The closing segment, from the last anchor back to the first.
    expect(hitPath(p, { x: 2, y: 50 }, 5)).toMatchObject({ kind: 'segment', from: 3 })
    expect(hitPath(p, { x: 50, y: 50 }, 5)).toBeNull()
  })

  it('finds the nearest point on a curve', () => {
    const cubic = cubicOf({ x: 0, y: 0, out: { x: 0, y: -50 } }, { x: 100, y: 0, in: { x: 100, y: -50 } })
    const near = nearestOnCubic(cubic, { x: 50, y: -60 })
    expect(near.t).toBeCloseTo(0.5, 4)
    close(near.point, { x: 50, y: -37.5 }, 4)
    expect(near.distance).toBeCloseTo(22.5, 4)
  })

  it('adds an anchor on a segment without changing the outline', () => {
    const before = path()
    const { path: after, ref } = splitSegment(before, 0, 0, 0.25)
    expect(ref).toEqual({ contour: 0, index: 1 })
    expect(after[0]?.anchors).toHaveLength(5)
    const whole = cubicOf(before[0]?.anchors[0] as Anchor, before[0]?.anchors[1] as Anchor)
    const left = cubicOf(after[0]?.anchors[0] as Anchor, after[0]?.anchors[1] as Anchor)
    const right = cubicOf(after[0]?.anchors[1] as Anchor, after[0]?.anchors[2] as Anchor)
    for (let t = 0; t <= 1; t += 0.1) {
      close(pointAt(left, t), pointAt(whole, t * 0.25))
      close(pointAt(right, t), pointAt(whole, 0.25 + t * 0.75))
    }
    expect(isSmooth(after[0]?.anchors[1] as Anchor)).toBe(true)
    // On a straight segment, a plain corner; on the closing one, it goes at the end.
    const straight = splitSegment(before, 0, 3, 0.5)
    expect(straight.ref).toEqual({ contour: 0, index: 4 })
    expect(straight.path[0]?.anchors[4]).toEqual({ x: 0, y: 50 })
    // The input is left as it was.
    expect(before[0]?.anchors).toHaveLength(4)
  })

  it('moves anchors with their handles, and handles mirrored or alone', () => {
    const moved = moveAnchors(path(), [{ contour: 0, index: 0 }], 10, 5)
    expect(moved[0]?.anchors[0]).toEqual({ x: 10, y: 5, out: { x: 10, y: -45 } })
    const smooth = splitSegment(path(), 0, 0, 0.5)
    const at = smooth.path[0]?.anchors[1] as Anchor
    expect(isSmooth(at)).toBe(true)
    const mirrored = moveControl(smooth.path, smooth.ref, 'out', { x: at.x + 30, y: at.y + 30 }, true)
    const a = mirrored[0]?.anchors[1] as Anchor
    expect(isSmooth(a)).toBe(true)
    // The other handle keeps its length.
    expect(Math.hypot((a.in?.x ?? 0) - a.x, (a.in?.y ?? 0) - a.y)).toBeCloseTo(Math.hypot((at.in?.x ?? 0) - at.x, (at.in?.y ?? 0) - at.y), 6)
    const broken = moveControl(smooth.path, smooth.ref, 'out', { x: at.x + 30, y: at.y + 30 }, false)
    expect(broken[0]?.anchors[1]?.in).toEqual(at.in)
    expect(isSmooth(broken[0]?.anchors[1] as Anchor)).toBe(false)
    // A handle dragged onto its anchor is gone.
    expect(moveControl(path(), { contour: 0, index: 0 }, 'out', { x: 0, y: 0 }, false)[0]?.anchors[0]).toEqual({ x: 0, y: 0 })
  })

  it('deletes anchors, and a contour left with one', () => {
    const after = deleteAnchors(path(), [{ contour: 0, index: 2 }])
    expect(formatPath(after)).toBe('M0 0 C0 -50 100 -50 100 0 L0 100 Z')
    expect(deleteAnchors(parsePath('M0 0 L10 0'), [{ contour: 0, index: 0 }])).toEqual([])
  })

  it('turns a point to the nearest 45° about another, keeping its distance', () => {
    const p = constrain({ x: 0, y: 0 }, { x: 100, y: 70 })
    expect(Math.hypot(p.x, p.y)).toBeCloseTo(Math.hypot(100, 70), 6)
    expect(p.x).toBeCloseTo(p.y, 6)
    close(constrain({ x: 10, y: 10 }, { x: 60, y: 14 }), { x: 10 + Math.hypot(50, 4), y: 10 })
  })
})
