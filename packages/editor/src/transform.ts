// The geometry of moving, resizing and rotating layers (#40), kept free of the editor so it can be
// tested on its own. Boxes are in one page's design pixels; a box's rotation turns it about its
// centre, as the renderer draws it.
import type { Point } from './hit-test.ts'

export interface Box { x: number; y: number; width: number; height: number; rotation: number }
export type Handle = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw'
export const HANDLES: readonly Handle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']

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

/** Where a handle sits on a box, as a fraction of its width and height. */
export function handleAt(h: Handle): Point {
  return { x: h.includes('w') ? 0 : h.includes('e') ? 1 : 0.5, y: h.includes('n') ? 0 : h.includes('s') ? 1 : 0.5 }
}

export interface ResizeOptions {
  /** Shift: keep the box's proportions. */
  keepRatio?: boolean
  /** Alt: grow and shrink about the centre instead of the opposite handle. */
  fromCentre?: boolean
}

/**
 * The box after dragging one of its handles to a point on the page. The opposite edge or corner
 * stays where it is on the page (the centre does with `fromCentre`), the rotation is kept, and a
 * drag past the opposite edge just meets it there: the box never turns inside out.
 */
export function resize(box: Box, handle: Handle, to: Point, options: ResizeOptions = {}): Box {
  const c = centreOf(box)
  // In the box's own unturned space, centred on its centre.
  const p = turn(to, c, -box.rotation)
  const local = { x: p.x - c.x, y: p.y - c.y }
  let left = -box.width / 2
  let right = box.width / 2
  let top = -box.height / 2
  let bottom = box.height / 2
  const at = handleAt(handle)
  const sideX = at.x === 0.5 ? 0 : at.x === 0 ? -1 : 1
  const sideY = at.y === 0.5 ? 0 : at.y === 0 ? -1 : 1
  if (sideX === 1) right = Math.max(left, local.x)
  if (sideX === -1) left = Math.min(right, local.x)
  if (sideY === 1) bottom = Math.max(top, local.y)
  if (sideY === -1) top = Math.min(bottom, local.y)
  if (options.fromCentre) {
    if (sideX === 1) left = -Math.max(0, right)
    if (sideX === -1) right = Math.max(0, -left)
    if (sideY === 1) top = -Math.max(0, bottom)
    if (sideY === -1) bottom = Math.max(0, -top)
  }
  if (options.keepRatio && box.width > 0 && box.height > 0) {
    const sx = (right - left) / box.width
    const sy = (bottom - top) / box.height
    // A corner follows whichever side moved more; an edge handle grows the other side about its middle.
    const s = sideX && sideY ? Math.max(sx, sy) : sideX ? sx : sy
    const width = box.width * s
    const height = box.height * s
    const anchorX = options.fromCentre || !sideX ? 0 : sideX === 1 ? left : right
    const anchorY = options.fromCentre || !sideY ? 0 : sideY === 1 ? top : bottom
    if (sideX === 1) right = anchorX + width
    else if (sideX === -1) left = anchorX - width
    else [left, right] = [-width / 2, width / 2]
    if (sideY === 1) bottom = anchorY + height
    else if (sideY === -1) top = anchorY - height
    else [top, bottom] = [-height / 2, height / 2]
    if (options.fromCentre) {
      if (sideX) [left, right] = [-width / 2, width / 2]
      if (sideY) [top, bottom] = [-height / 2, height / 2]
    }
  }
  const width = right - left
  const height = bottom - top
  const centre = turn({ x: c.x + (left + right) / 2, y: c.y + (top + bottom) / 2 }, c, box.rotation)
  return { x: centre.x - width / 2, y: centre.y - height / 2, width, height, rotation: box.rotation }
}

/**
 * A box carried along when the box around it changes from `from` to `to` (same rotation): its
 * place and size scale with the outer box's, in the outer box's own unturned space. This is how a
 * layer inside a resized group follows it.
 */
export function carry(inner: Box, from: Box, to: Box): Box {
  const sx = from.width > 0 ? to.width / from.width : 1
  const sy = from.height > 0 ? to.height / from.height : 1
  return {
    x: to.x + (inner.x - from.x) * sx,
    y: to.y + (inner.y - from.y) * sy,
    width: inner.width * sx,
    height: inner.height * sy,
    rotation: inner.rotation,
  }
}

/**
 * A layer's box when an unturned selection box around several layers is scaled from `from` to
 * `to`: its centre scales with the selection, and its size by how much the scale stretches it
 * along its own turned sides.
 */
export function scaleWithin(box: Box, from: Box, to: Box): Box {
  const sx = from.width > 0 ? to.width / from.width : 1
  const sy = from.height > 0 ? to.height / from.height : 1
  const c = centreOf(box)
  const centre = { x: to.x + (c.x - from.x) * sx, y: to.y + (c.y - from.y) * sy }
  const a = rad(box.rotation)
  const width = box.width * Math.hypot(sx * Math.cos(a), sy * Math.sin(a))
  const height = box.height * Math.hypot(sx * Math.sin(a), sy * Math.cos(a))
  return { x: centre.x - width / 2, y: centre.y - height / 2, width, height, rotation: box.rotation }
}

/** An angle in degrees as the schema keeps it, in (-180, 180]. */
export function normalAngle(deg: number) {
  const a = ((deg % 360) + 360) % 360
  return a > 180 ? a - 360 : a
}

/** Shift while rotating: the angle snaps to steps of 15°. */
export const ANGLE_STEP = 15
export const snapAngle = (deg: number) => Math.round(deg / ANGLE_STEP) * ANGLE_STEP

/** The angle of a point about a centre, in degrees. */
export const angleOf = (p: Point, about: Point) => (Math.atan2(p.y - about.y, p.x - about.x) * 180) / Math.PI

/** Rounds what goes into the document: whole pixels for a move, hundredths for the rest. */
export const round = (n: number, places = 2) => Math.round(n * 10 ** places) / 10 ** places
