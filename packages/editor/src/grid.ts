// Where each frame of the infinite canvas sits (#36): an auto grid with pages as rows and formats
// as columns, so nothing about placement is stored and a new page or format slots in by itself.
import type { Design } from '@razzlr/schema'

/** One page in one format, placed on the canvas in world units (design pixels at 100%). */
export interface Frame {
  key: string
  pageId: string
  formatId: string
  row: number
  column: number
  x: number
  y: number
  width: number
  height: number
}

export interface Rect { x: number; y: number; width: number; height: number }

/** Space between formats, and between pages, which also holds the frame labels. */
export const COLUMN_GAP = 160
export const ROW_GAP = 240

const byOrder = <T extends { order: string }>(entries: [string, T][]) =>
  entries.sort(([a, x], [b, y]) => (x.order < y.order ? -1 : x.order > y.order ? 1 : a < b ? -1 : a > b ? 1 : 0))

export const frameKey = (pageId: string, formatId: string) => `${pageId}/${formatId}`

/** Every frame of the design, row by row, and the box around them all. */
export function frameGrid(design: Design): { frames: Frame[]; bounds: Rect } {
  const pages = byOrder(Object.entries(design.pages))
  const formats = byOrder(Object.entries(design.formats))
  const rowHeight = Math.max(0, ...formats.map(([, f]) => f.height))
  const columns: number[] = []
  let x = 0
  for (const [, format] of formats) {
    columns.push(x)
    x += format.width + COLUMN_GAP
  }
  const frames = pages.flatMap(([pageId], row) => formats.map(([formatId, format], column) => ({
    key: frameKey(pageId, formatId), pageId, formatId, row, column,
    x: columns[column] ?? 0, y: row * (rowHeight + ROW_GAP), width: format.width, height: format.height,
  })))
  const width = Math.max(0, x - COLUMN_GAP)
  const height = Math.max(0, pages.length * (rowHeight + ROW_GAP) - ROW_GAP)
  return { frames, bounds: { x: 0, y: 0, width, height } }
}

export const intersects = (a: Rect, b: Rect) =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height

/** The frame under a world point, if any. */
export const frameAt = (frames: Frame[], p: { x: number; y: number }) =>
  frames.find((f) => p.x >= f.x && p.x <= f.x + f.width && p.y >= f.y && p.y <= f.y + f.height)
