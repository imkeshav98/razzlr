// Align and distribute (#42): where each selected layer moves to, by the box around it as drawn.
// Several layers line up with the box around them all; one layer lines up with what holds it,
// the format or the group or frame it is in.
import type { Rect } from './grid.ts'

export const ALIGNMENTS = ['left', 'centre', 'right', 'top', 'middle', 'bottom'] as const
export type Alignment = (typeof ALIGNMENTS)[number]
export type Distribution = 'horizontal' | 'vertical'

export interface Offset { dx: number; dy: number }

const around = (boxes: Rect[]): Rect => {
  const x = Math.min(...boxes.map((b) => b.x))
  const y = Math.min(...boxes.map((b) => b.y))
  return { x, y, width: Math.max(...boxes.map((b) => b.x + b.width)) - x, height: Math.max(...boxes.map((b) => b.y + b.height)) - y }
}

/** How far each box moves to line up; with one box, it lines up with `within`. */
export function align(boxes: Rect[], to: Alignment, within: Rect): Offset[] {
  const target = boxes.length === 1 ? within : around(boxes)
  return boxes.map((b) => {
    switch (to) {
      case 'left': return { dx: target.x - b.x, dy: 0 }
      case 'centre': return { dx: target.x + target.width / 2 - (b.x + b.width / 2), dy: 0 }
      case 'right': return { dx: target.x + target.width - (b.x + b.width), dy: 0 }
      case 'top': return { dx: 0, dy: target.y - b.y }
      case 'middle': return { dx: 0, dy: target.y + target.height / 2 - (b.y + b.height / 2) }
      case 'bottom': return { dx: 0, dy: target.y + target.height - (b.y + b.height) }
    }
  })
}

/**
 * How far each box moves to space three or more out evenly: the first and last along the axis
 * stay, and the gaps between neighbours become equal. Fewer than three don't move.
 */
export function distribute(boxes: Rect[], axis: Distribution): Offset[] {
  const offsets = boxes.map(() => ({ dx: 0, dy: 0 }))
  if (boxes.length < 3) return offsets
  const x = axis === 'horizontal'
  const start = (b: Rect) => (x ? b.x : b.y)
  const size = (b: Rect) => (x ? b.width : b.height)
  const order = boxes.map((b, i) => i).sort((a, b) => start(boxes[a] as Rect) - start(boxes[b] as Rect) || a - b)
  const first = boxes[order[0] as number] as Rect
  const last = boxes[order.at(-1) as number] as Rect
  const span = start(last) + size(last) - start(first)
  const gap = (span - boxes.reduce((sum, b) => sum + size(b), 0)) / (boxes.length - 1)
  let at = start(first)
  for (const i of order) {
    const b = boxes[i] as Rect
    const d = at - start(b)
    offsets[i] = x ? { dx: d, dy: 0 } : { dx: 0, dy: d }
    at += size(b) + gap
  }
  return offsets
}
