// The view onto the infinite canvas (#36). A screen point, in CSS pixels from the stage's corner,
// is world × zoom + (x, y); world units are design pixels.
import type { Rect } from './grid.ts'
import type { Point } from './hit-test.ts'

export interface Camera { x: number; y: number; zoom: number }
export interface Viewport { width: number; height: number }

export const MIN_ZOOM = 0.01
export const MAX_ZOOM = 64
/** Fitting never zooms in past this, so a 320×50 banner doesn't fill the screen. */
const MAX_FIT_ZOOM = 4

const clampZoom = (zoom: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom))

export const toWorld = (c: Camera, p: Point): Point => ({ x: (p.x - c.x) / c.zoom, y: (p.y - c.y) / c.zoom })
export const toScreen = (c: Camera, p: Point): Point => ({ x: p.x * c.zoom + c.x, y: p.y * c.zoom + c.y })

/** The camera at a new zoom with the world point under `at` (a screen point) still under it. */
export function zoomAt(c: Camera, at: Point, zoom: number): Camera {
  const next = clampZoom(zoom)
  const world = toWorld(c, at)
  return { zoom: next, x: at.x - world.x * next, y: at.y - world.y * next }
}

/** Screen pixels at each edge of the stage that floating chrome covers (#83). */
export interface Insets { top: number; right: number; bottom: number; left: number }
export const NO_INSETS: Insets = { top: 0, right: 0, bottom: 0, left: 0 }

/**
 * The camera that shows the whole rect, centred in the part of the viewport the insets leave
 * clear, with `padding` screen pixels around it.
 */
export function fit(rect: Rect, viewport: Viewport, padding = 48, insets: Insets = NO_INSETS): Camera {
  const clear = { width: viewport.width - insets.left - insets.right, height: viewport.height - insets.top - insets.bottom }
  const room = { width: Math.max(1, clear.width - 2 * padding), height: Math.max(1, clear.height - 2 * padding) }
  const zoom = clampZoom(Math.min(MAX_FIT_ZOOM, room.width / Math.max(1, rect.width), room.height / Math.max(1, rect.height)))
  return {
    zoom,
    x: insets.left + clear.width / 2 - (rect.x + rect.width / 2) * zoom,
    y: insets.top + clear.height / 2 - (rect.y + rect.height / 2) * zoom,
  }
}

/** The part of the world the viewport shows. */
export function visibleRect(c: Camera, viewport: Viewport): Rect {
  const corner = toWorld(c, { x: 0, y: 0 })
  return { x: corner.x, y: corner.y, width: viewport.width / c.zoom, height: viewport.height / c.zoom }
}
