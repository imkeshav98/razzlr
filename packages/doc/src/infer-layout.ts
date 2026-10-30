// Settings for a frame switched to auto layout (#46), read off where its children are, so that
// switching moves nothing when the children already sit in an even row or column.
import type { Box } from './geometry.ts'
import { round } from './geometry.ts'

type Rect = Pick<Box, 'x' | 'y' | 'width' | 'height'>
export interface Inferred {
  direction: 'row' | 'column'
  gap: number
  padding: { top: number; right: number; bottom: number; left: number }
  justify: 'start'
  align: 'start' | 'center' | 'end'
  wrap: false
  lineGap: number
}

const NEAR = 0.5
const same = (values: number[]) => values.every((v) => Math.abs(v - (values[0] ?? 0)) <= NEAR)

/**
 * Reads a row or column off the children's boxes: the axis along which they follow each other
 * without overlapping (the longer run if both), the gap between them (their average where they
 * differ), the paddings to the frame's edges, and how they line up across the flow.
 */
export function inferLayout(frame: Rect, kids: [string, Rect][]): { layout: Inferred; order: string[] } {
  const along = (row: boolean) => {
    const sorted = [...kids].sort(([, a], [, b]) => (row ? a.x - b.x : a.y - b.y))
    const gaps = sorted.slice(1).map(([, b], i) => {
      const a = (sorted[i] as [string, Rect])[1]
      return row ? b.x - (a.x + a.width) : b.y - (a.y + a.height)
    })
    return { sorted, gaps, clear: gaps.every((g) => g >= -NEAR) }
  }
  const asRow = along(true)
  const asColumn = along(false)
  const span = (row: boolean) => {
    const starts = kids.map(([, b]) => (row ? b.x : b.y))
    const ends = kids.map(([, b]) => (row ? b.x + b.width : b.y + b.height))
    return Math.max(...ends) - Math.min(...starts)
  }
  const row = asRow.clear && asColumn.clear ? span(true) >= span(false) : asRow.clear || !asColumn.clear
  const { sorted, gaps } = row ? asRow : asColumn
  const gap = gaps.length === 0 ? 0 : round(gaps.reduce((s, g) => s + g, 0) / gaps.length)
  const boxes = kids.map(([, b]) => b)
  const left = Math.min(...boxes.map((b) => b.x)) - frame.x
  const top = Math.min(...boxes.map((b) => b.y)) - frame.y
  const right = frame.x + frame.width - Math.max(...boxes.map((b) => b.x + b.width))
  const bottom = frame.y + frame.height - Math.max(...boxes.map((b) => b.y + b.height))
  const across = (part: 0 | 0.5 | 1) => boxes.map((b) => (row ? b.y + b.height * part : b.x + b.width * part))
  const align = same(across(0)) ? 'start' : same(across(0.5)) ? 'center' : same(across(1)) ? 'end' : 'start'
  const padding = kids.length === 0
    ? { top: 0, right: 0, bottom: 0, left: 0 }
    : { top: round(top), right: round(right), bottom: round(bottom), left: round(left) }
  // Centred across the flow, the paddings either side must differ by as much as the centre line
  // is off the frame's middle; at the start or end, the paddings read off already hold them there.
  if (align === 'center' && kids.length > 0) {
    const centre = (across(0.5)[0] ?? 0) - (row ? frame.y : frame.x)
    if (row) padding.bottom = round(padding.top + frame.height - 2 * centre)
    else padding.right = round(padding.left + frame.width - 2 * centre)
  }
  return {
    layout: { direction: row ? 'row' : 'column', gap, padding, justify: 'start', align, wrap: false, lineGap: 0 },
    // The children in the order the flow takes them.
    order: sorted.map(([id]) => id),
  }
}
