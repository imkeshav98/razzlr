// Boxes on a page as the renderer draws them: in one page's design pixels, a box's rotation turns
// it about its centre, and a container's rotation turns what is inside it about the container's
// centre. Commands that keep layers where they are on screen (group, ungroup, hug) and the
// editor's transforms share it.

export interface Point { x: number; y: number }
export interface Box { x: number; y: number; width: number; height: number; rotation: number }

const rad = (deg: number) => (deg * Math.PI) / 180
export const centreOf = (b: Box): Point => ({ x: b.x + b.width / 2, y: b.y + b.height / 2 })

/** Turns a point about a centre. */
export function turn(p: Point, about: Point, deg: number): Point {
  if (deg === 0) return p
  const a = rad(deg)
  const dx = p.x - about.x
  const dy = p.y - about.y
  return { x: about.x + dx * Math.cos(a) - dy * Math.sin(a), y: about.y + dx * Math.sin(a) + dy * Math.cos(a) }
}

/** A box's four corners on the page, as drawn: nw, ne, se, sw. */
export function cornersOf(b: Box): Point[] {
  const c = centreOf(b)
  return [
    { x: b.x, y: b.y }, { x: b.x + b.width, y: b.y }, { x: b.x + b.width, y: b.y + b.height }, { x: b.x, y: b.y + b.height },
  ].map((p) => turn(p, c, b.rotation))
}

/** The unturned box around boxes as they are drawn. */
export function boundsOf(boxes: Box[]): Box {
  const points = boxes.flatMap(cornersOf)
  const xs = points.map((p) => p.x)
  const ys = points.map((p) => p.y)
  const x = Math.min(...xs)
  const y = Math.min(...ys)
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y, rotation: 0 }
}

/** An angle in degrees as the schema keeps it, in (-180, 180]. */
export function normalAngle(deg: number) {
  const a = ((deg % 360) + 360) % 360
  return a > 180 ? a - 360 : a
}

/** Rounds what goes into the document: hundredths of a pixel or degree. */
export const round = (n: number, places = 2) => Math.round(n * 10 ** places) / 10 ** places
