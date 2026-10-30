// Snapping while moving or resizing (#42): to other layers' edges and centres, to equal spacing
// between layers, and to the format's edges and centre, with the guides that show why. Kept free
// of the editor so the maths can be tested on its own. Everything is in one page's design pixels;
// turned layers snap by the box around them as drawn.
import type { Rect } from './grid.ts'
import type { Handle } from './transform.ts'

/** How close a line has to come to snap, in screen pixels: the same reach at any zoom. */
export const SNAP_DISTANCE = 6

/** A line the moving box lines up with: `axis: 'x'` is a vertical line at x = `at`, drawn from `from` to `to` down the page. */
export interface Guide { axis: 'x' | 'y'; at: number; from: number; to: number }
/** One of the equal gaps a box snapped to: along `axis` from `from` to `to`, drawn across at `at`. */
export interface Gap { axis: 'x' | 'y'; from: number; to: number; at: number }
export interface Snapped { dx: number; dy: number; guides: Guide[]; gaps: Gap[] }

interface Line { at: number; box: number }
/** What a drag can snap to, worked out once when it starts. */
export interface Targets { boxes: Rect[]; xs: Line[]; ys: Line[] }

const lines = (boxes: Rect[], axis: 'x' | 'y'): Line[] => boxes.flatMap((b, box) => {
  const start = axis === 'x' ? b.x : b.y
  const size = axis === 'x' ? b.width : b.height
  return [{ at: start, box }, { at: start + size / 2, box }, { at: start + size, box }]
})

/** The lines and boxes to snap to: other layers' boxes as drawn, and the format itself. */
export function snapTargets(others: Rect[], format: Rect): Targets {
  const boxes = [...others, format]
  return { boxes, xs: lines(boxes, 'x'), ys: lines(boxes, 'y') }
}

const EXACT = 0.01
type Axis = 'x' | 'y'
const startOf = (b: Rect, axis: Axis) => (axis === 'x' ? b.x : b.y)
const sizeOf = (b: Rect, axis: Axis) => (axis === 'x' ? b.width : b.height)
const endOf = (b: Rect, axis: Axis) => startOf(b, axis) + sizeOf(b, axis)
const across = (axis: Axis): Axis => (axis === 'x' ? 'y' : 'x')
const overlaps = (a: Rect, b: Rect, axis: Axis) => startOf(a, axis) < endOf(b, axis) && startOf(b, axis) < endOf(a, axis)
const moved = (b: Rect, axis: Axis, d: number): Rect => (axis === 'x' ? { ...b, x: b.x + d } : { ...b, y: b.y + d })

/** The nearest snap of some of the moving box's lines to the targets' lines, as the offset it needs. */
function nearestLine(moving: number[], targets: Line[], reach: number) {
  let best: number | null = null
  for (const t of targets) {
    for (const m of moving) {
      const d = t.at - m
      if (Math.abs(d) <= reach && (best === null || Math.abs(d) < Math.abs(best))) best = d
    }
  }
  return best
}

/**
 * The nearest equal-spacing snap along one axis: boxes level with the moving one (overlapping it
 * across the axis) form a row. The moving box can sit centred between its two neighbours, or
 * as far from one of them as two other boxes in the row are from each other.
 */
function nearestGap(moving: Rect, boxes: Rect[], axis: Axis, reach: number) {
  const row = boxes.filter((b) => overlaps(b, moving, across(axis)) && !overlaps(b, moving, axis)).sort((a, b) => startOf(a, axis) - startOf(b, axis))
  const before = row.filter((b) => endOf(b, axis) <= startOf(moving, axis)).sort((a, b) => endOf(b, axis) - endOf(a, axis))[0]
  const after = row.find((b) => startOf(b, axis) >= endOf(moving, axis))
  const gaps: number[] = []
  for (let i = 1; i < row.length; i++) {
    const gap = startOf(row[i] as Rect, axis) - endOf(row[i - 1] as Rect, axis)
    if (gap > 0) gaps.push(gap)
  }
  const size = sizeOf(moving, axis)
  const options: number[] = []
  if (before && after) options.push((endOf(before, axis) + startOf(after, axis) - size) / 2)
  for (const gap of gaps) {
    if (before) options.push(endOf(before, axis) + gap)
    if (after) options.push(startOf(after, axis) - gap - size)
  }
  let best: number | null = null
  for (const start of options) {
    const d = start - startOf(moving, axis)
    if (Math.abs(d) <= reach && (best === null || Math.abs(d) < Math.abs(best))) best = d
  }
  return best
}

/** The guides for every target line a box now lines up with, spanning it and the boxes the lines belong to. */
function guidesFor(box: Rect, targets: Targets, axis: Axis): Guide[] {
  const mine = [startOf(box, axis), startOf(box, axis) + sizeOf(box, axis) / 2, endOf(box, axis)]
  const found = new Map<number, Rect[]>()
  for (const t of axis === 'x' ? targets.xs : targets.ys) {
    if (!mine.some((m) => Math.abs(m - t.at) < EXACT)) continue
    const key = Math.round(t.at * 100) / 100
    found.set(key, [...found.get(key) ?? [], targets.boxes[t.box] as Rect])
  }
  const other = across(axis)
  return [...found].map(([at, boxes]) => ({
    axis,
    at,
    from: Math.min(startOf(box, other), ...boxes.map((b) => startOf(b, other))),
    to: Math.max(endOf(box, other), ...boxes.map((b) => endOf(b, other))),
  }))
}

/** The gaps to mark when a box sits at equal spacing in its row: its own, and every equal one. */
function gapsFor(box: Rect, boxes: Rect[], axis: Axis): Gap[] {
  const row = [...boxes.filter((b) => overlaps(b, box, across(axis)) && !overlaps(b, box, axis)), box].sort((a, b) => startOf(a, axis) - startOf(b, axis))
  const at = row.indexOf(box)
  const pairs: [Rect, Rect][] = []
  for (let i = 1; i < row.length; i++) pairs.push([row[i - 1] as Rect, row[i] as Rect])
  const gapOf = ([a, b]: [Rect, Rect]) => startOf(b, axis) - endOf(a, axis)
  const mine = pairs.filter(([a, b]) => a === row[at] || b === row[at]).map(gapOf).filter((g) => g > 0)
  const marked = pairs.filter((pair) => gapOf(pair) > 0 && mine.some((g) => Math.abs(g - gapOf(pair)) < EXACT))
  if (marked.length < 2) return []
  return marked.map(([a, b]) => {
    const other = across(axis)
    const top = Math.max(startOf(a, other), startOf(b, other))
    const bottom = Math.min(endOf(a, other), endOf(b, other))
    return { axis, from: endOf(a, axis), to: startOf(b, axis), at: (top + bottom) / 2 }
  })
}

/**
 * Snaps a moving box: the offset to add to its move on each axis, each the nearest within
 * `reach` design pixels (SNAP_DISTANCE over the zoom), and the guides and gaps that show why.
 * An axis kept still (shift-dragging along the other one) doesn't snap.
 */
export function snapMove(moving: Rect, targets: Targets, reach: number, still: { x?: boolean; y?: boolean } = {}): Snapped {
  const offset = (axis: Axis) => {
    if (still[axis]) return 0
    const start = startOf(moving, axis)
    const size = sizeOf(moving, axis)
    const line = nearestLine([start, start + size / 2, start + size], axis === 'x' ? targets.xs : targets.ys, reach)
    const gap = nearestGap(moving, targets.boxes.slice(0, -1), axis, reach)
    if (line === null) return gap ?? 0
    return gap !== null && Math.abs(gap) < Math.abs(line) ? gap : line
  }
  const dx = offset('x')
  const dy = offset('y')
  const box = moved(moved(moving, 'x', dx), 'y', dy)
  const others = targets.boxes.slice(0, -1)
  return {
    dx, dy,
    guides: [...guidesFor(box, targets, 'x'), ...guidesFor(box, targets, 'y')],
    gaps: [...gapsFor(box, others, 'x'), ...gapsFor(box, others, 'y')],
  }
}

/**
 * Snaps the edges a resize handle moves: the offset to add to the pointer on each axis, and the
 * guides. Only the dragged edges snap; the others stay where the resize puts them.
 */
export function snapResize(box: Rect, handle: Handle, targets: Targets, reach: number): Snapped {
  const edge = (axis: Axis, low: string, high: string) => {
    const moves = handle.includes(high) ? endOf(box, axis) : handle.includes(low) ? startOf(box, axis) : null
    return moves === null ? 0 : nearestLine([moves], axis === 'x' ? targets.xs : targets.ys, reach) ?? 0
  }
  const dx = edge('x', 'w', 'e')
  const dy = edge('y', 'n', 's')
  const after: Rect = {
    x: handle.includes('w') ? box.x + dx : box.x,
    y: handle.includes('n') ? box.y + dy : box.y,
    width: box.width + (handle.includes('e') ? dx : handle.includes('w') ? -dx : 0),
    height: box.height + (handle.includes('s') ? dy : handle.includes('n') ? -dy : 0),
  }
  const only = (guides: Guide[], axis: Axis, edges: number[]) => guides.filter((g) => g.axis !== axis || edges.some((e) => Math.abs(e - g.at) < EXACT))
  let guides = [...guidesFor(after, targets, 'x'), ...guidesFor(after, targets, 'y')]
  guides = only(guides, 'x', [handle.includes('e') ? endOf(after, 'x') : handle.includes('w') ? after.x : Number.NaN])
  guides = only(guides, 'y', [handle.includes('s') ? endOf(after, 'y') : handle.includes('n') ? after.y : Number.NaN])
  return { dx, dy, guides, gaps: [] }
}
