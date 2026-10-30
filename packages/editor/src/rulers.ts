// Rulers along the stage's top and start edges (#42): positions in one frame's design pixels, with
// the selection's extent marked on both. Built as overlay elements each time the overlay is drawn;
// numbered ticks are elements, the small ticks between them a repeating background.
import { toScreen, toWorld, type Camera, type Viewport } from './camera.ts'
import type { Frame, Rect } from './grid.ts'

/** The rulers' thickness, in CSS pixels. */
export const RULER_SIZE = 20
/** Numbered ticks stay at least this far apart on screen. */
const MIN_SPACING = 64
/** Small ticks between numbered ones. */
const MINOR = 5

/** The smallest of 1, 2, 5, 10, 20, 50 … design pixels that keeps numbered ticks MIN_SPACING apart at a zoom. */
export function rulerStep(zoom: number) {
  const want = MIN_SPACING / zoom
  const power = 10 ** Math.floor(Math.log10(want))
  return [1, 2, 5, 10].map((m) => m * power).find((step) => step >= want) ?? 10 * power
}

const px = (n: number) => `${n}px`
const label = (n: number) => String(Math.round(n * 100) / 100)

/**
 * Both rulers for a frame: numbers count design pixels from the frame's corner, and `band`, the
 * selection's box as drawn in that frame, is marked with its two ends.
 */
export function rulerParts(camera: Camera, viewport: Viewport, frame: Frame, band: Rect | null): HTMLElement[] {
  const step = rulerStep(camera.zoom)
  const origin = toScreen(camera, { x: frame.x, y: frame.y })
  const parts = (['x', 'y'] as const).map((axis) => {
    const across = axis === 'x'
    const el = document.createElement('div')
    el.className = 'ruler'
    el.dataset.axis = axis
    Object.assign(el.style, across
      ? { left: px(RULER_SIZE), top: '0', width: px(Math.max(0, viewport.width - RULER_SIZE)), height: px(RULER_SIZE) }
      : { left: '0', top: px(RULER_SIZE), width: px(RULER_SIZE), height: px(Math.max(0, viewport.height - RULER_SIZE)) })
    const zero = (across ? origin.x : origin.y) - RULER_SIZE
    const minor = (step / MINOR) * camera.zoom
    el.style.backgroundSize = across ? `${px(minor)} 5px` : `5px ${px(minor)}`
    el.style.backgroundPosition = across ? `${px(((zero % minor) + minor) % minor)} 100%` : `100% ${px(((zero % minor) + minor) % minor)}`

    // The selection's extent, and its two ends as numbers; numbered ticks too close to them give way.
    const ends: number[] = []
    if (band) {
      const start = (across ? band.x : band.y)
      const size = across ? band.width : band.height
      const mark = document.createElement('div')
      mark.className = 'ruler-band'
      const at = zero + start * camera.zoom
      Object.assign(mark.style, across ? { left: px(at), width: px(size * camera.zoom) } : { top: px(at), height: px(size * camera.zoom) })
      el.append(mark)
      for (const value of [start, start + size]) {
        const end = document.createElement('span')
        end.className = 'ruler-end'
        end.textContent = label(value)
        const where = zero + value * camera.zoom
        end.style[across ? 'left' : 'top'] = px(where)
        ends.push(where)
        el.append(end)
      }
    }

    const length = across ? viewport.width : viewport.height
    const world = (screen: number) => (across ? toWorld(camera, { x: screen, y: 0 }).x - frame.x : toWorld(camera, { x: 0, y: screen }).y - frame.y)
    for (let value = Math.ceil(world(RULER_SIZE) / step) * step; value <= world(length); value += step) {
      const where = zero + value * camera.zoom
      if (ends.some((end) => Math.abs(end - where) < MIN_SPACING * 0.6)) continue
      const tick = document.createElement('span')
      tick.className = 'ruler-tick'
      tick.textContent = label(value)
      tick.style[across ? 'left' : 'top'] = px(where)
      el.prepend(tick)
    }
    return el
  })
  const corner = document.createElement('div')
  corner.className = 'ruler-corner'
  Object.assign(corner.style, { left: '0', top: '0', width: px(RULER_SIZE), height: px(RULER_SIZE) })
  return [...parts, corner]
}
