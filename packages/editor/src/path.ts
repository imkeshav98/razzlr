// Paths as the pen draws and edits them (#45). A path is contours of anchors; each anchor may
// have a handle in (towards the anchor before it) and out (towards the one after). Any SVG path
// data reads in, with quadratics and arcs turned into cubics; it is written back as M, L, C and Z
// only. Points are in one coordinate space throughout; the editor picks which.
import type { Point } from './hit-test.ts'
import { round } from './transform.ts'

export interface Anchor { x: number; y: number; in?: Point; out?: Point }
export interface Contour { anchors: Anchor[]; closed: boolean }
export type PenPath = Contour[]
/** One anchor of a path. */
export interface AnchorRef { contour: number; index: number }
export type Side = 'in' | 'out'
/** The four points of a cubic Bézier segment. */
export type Cubic = [Point, Point, Point, Point]

const near = (a: Point, b: Point, within = 1e-6) => Math.abs(a.x - b.x) <= within && Math.abs(a.y - b.y) <= within
const lerp = (a: Point, b: Point, t: number): Point => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t })
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y)

/** A handle that sits on its anchor is no handle. */
function handle(anchor: Point, at: Point): Point | undefined {
  return near(anchor, at) ? undefined : { x: at.x, y: at.y }
}

/** Reads SVG path data, every command, absolute or relative. Throws on data it can't read. */
export function parsePath(d: string): PenPath {
  let i = 0
  const space = () => {
    while (i < d.length && /[\s,]/.test(d[i] as string)) i++
  }
  const number = () => {
    space()
    const m = /^[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/.exec(d.slice(i))
    if (!m) throw new Error(`path data: expected a number at ${i} in "${d}"`)
    i += m[0].length
    return Number(m[0])
  }
  // Arc flags are one digit each and may run together: "a5 5 0 01 10 10".
  const flag = () => {
    space()
    const c = d[i]
    if (c !== '0' && c !== '1') throw new Error(`path data: expected a flag at ${i} in "${d}"`)
    i++
    return c === '1'
  }
  const more = () => {
    space()
    return i < d.length && /[-+.\d]/.test(d[i] as string)
  }

  const path: PenPath = []
  let contour: Contour | null = null
  let at: Point = { x: 0, y: 0 }
  let start: Point = { x: 0, y: 0 }
  // The second control of the last cubic or the control of the last quadratic, for S and T.
  let lastCubic: Point | null = null
  let lastQuad: Point | null = null
  const begin = (p: Point) => {
    contour = { anchors: [{ x: p.x, y: p.y }], closed: false }
    path.push(contour)
    at = p
    start = p
  }
  const current = () => {
    if (!contour || contour.closed) begin(at)
    return contour as Contour
  }
  const cubicTo = (c1: Point, c2: Point, p: Point) => {
    const c = current()
    const last = c.anchors.at(-1) as Anchor
    const out = handle(last, c1)
    if (out) last.out = out
    else delete last.out
    const next: Anchor = { x: p.x, y: p.y }
    const into = handle(p, c2)
    if (into) next.in = into
    c.anchors.push(next)
    at = p
  }
  const lineTo = (p: Point) => {
    current().anchors.push({ x: p.x, y: p.y })
    at = p
  }

  let command = ''
  space()
  while (i < d.length) {
    const c = d[i] as string
    if (/[a-zA-Z]/.test(c)) {
      command = c
      i++
    } else if (!command || command === 'z' || command === 'Z') {
      throw new Error(`path data: expected a command at ${i} in "${d}"`)
    }
    if (command === 'z' || command === 'Z') {
      if (contour) close(contour)
      at = start
      lastCubic = null
      lastQuad = null
      space()
      continue
    }
    do {
      // A move's further pairs are lines, so the command can change within the loop.
      const rel = command === command.toLowerCase()
      const pt = (x: number, y: number): Point => (rel ? { x: at.x + x, y: at.y + y } : { x, y })
      const upper = command.toUpperCase()
      let cubic: Point | null = null
      let quad: Point | null = null
      switch (upper) {
        case 'M': {
          begin(pt(number(), number()))
          command = rel ? 'l' : 'L'
          break
        }
        case 'L': lineTo(pt(number(), number()))
          break
        case 'H': {
          const x = number()
          lineTo({ x: rel ? at.x + x : x, y: at.y })
          break
        }
        case 'V': {
          const y = number()
          lineTo({ x: at.x, y: rel ? at.y + y : y })
          break
        }
        case 'C': {
          const c1 = pt(number(), number())
          const c2 = pt(number(), number())
          cubicTo(c1, c2, pt(number(), number()))
          cubic = c2
          break
        }
        case 'S': {
          const c1 = lastCubic ? { x: 2 * at.x - lastCubic.x, y: 2 * at.y - lastCubic.y } : at
          const c2 = pt(number(), number())
          cubicTo(c1, c2, pt(number(), number()))
          cubic = c2
          break
        }
        case 'Q': case 'T': {
          const q: Point = upper === 'Q' ? pt(number(), number()) : lastQuad ? { x: 2 * at.x - lastQuad.x, y: 2 * at.y - lastQuad.y } : at
          const from = at
          const p = pt(number(), number())
          // A quadratic is the cubic with its controls two thirds of the way to the quadratic's.
          cubicTo(lerp(from, q, 2 / 3), lerp(p, q, 2 / 3), p)
          quad = q
          break
        }
        case 'A': {
          const rx = number()
          const ry = number()
          const rotation = number()
          const large = flag()
          const sweep = flag()
          const p = pt(number(), number())
          for (const [, c1, c2, to] of arcToCubics(at, rx, ry, rotation, large, sweep, p)) cubicTo(c1, c2, to)
          break
        }
        default: throw new Error(`path data: unknown command "${command}" in "${d}"`)
      }
      lastCubic = cubic
      lastQuad = quad
    } while (more())
  }
  return path
}

/** Closes a contour, joining an end anchor that lands on the start into it. */
function close(contour: Contour) {
  contour.closed = true
  const first = contour.anchors[0]
  const last = contour.anchors.at(-1)
  if (contour.anchors.length > 1 && first && last && near(first, last)) {
    if (last.in) first.in = last.in
    contour.anchors.pop()
  }
}

/** An SVG elliptical arc as cubics, each spanning at most a quarter turn. */
function arcToCubics(from: Point, rx: number, ry: number, degrees: number, large: boolean, sweep: boolean, to: Point): Cubic[] {
  if (near(from, to)) return []
  rx = Math.abs(rx)
  ry = Math.abs(ry)
  if (rx === 0 || ry === 0) return [[from, from, to, to]]
  const phi = (degrees * Math.PI) / 180
  const cos = Math.cos(phi)
  const sin = Math.sin(phi)
  // The endpoint form to the centre form, as in the SVG spec's implementation notes.
  const dx = (from.x - to.x) / 2
  const dy = (from.y - to.y) / 2
  const x1 = cos * dx + sin * dy
  const y1 = -sin * dx + cos * dy
  const scale = (x1 * x1) / (rx * rx) + (y1 * y1) / (ry * ry)
  if (scale > 1) {
    rx *= Math.sqrt(scale)
    ry *= Math.sqrt(scale)
  }
  const num = rx * rx * ry * ry - rx * rx * y1 * y1 - ry * ry * x1 * x1
  const den = rx * rx * y1 * y1 + ry * ry * x1 * x1
  const k = (large === sweep ? -1 : 1) * Math.sqrt(Math.max(0, num / den))
  const cx1 = (k * rx * y1) / ry
  const cy1 = (-k * ry * x1) / rx
  const cx = cos * cx1 - sin * cy1 + (from.x + to.x) / 2
  const cy = sin * cx1 + cos * cy1 + (from.y + to.y) / 2
  const angle = (ux: number, uy: number, vx: number, vy: number) => Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy)
  const start = angle(1, 0, (x1 - cx1) / rx, (y1 - cy1) / ry)
  let sweepAngle = angle((x1 - cx1) / rx, (y1 - cy1) / ry, (-x1 - cx1) / rx, (-y1 - cy1) / ry)
  if (!sweep && sweepAngle > 0) sweepAngle -= 2 * Math.PI
  if (sweep && sweepAngle < 0) sweepAngle += 2 * Math.PI
  const parts = Math.ceil(Math.abs(sweepAngle) / (Math.PI / 2) - 1e-9)
  const step = sweepAngle / parts
  const kappa = (4 / 3) * Math.tan(step / 4)
  const on = (t: number): Point => ({ x: cx + rx * Math.cos(t) * cos - ry * Math.sin(t) * sin, y: cy + rx * Math.cos(t) * sin + ry * Math.sin(t) * cos })
  const along = (t: number): Point => ({ x: -rx * Math.sin(t) * cos - ry * Math.cos(t) * sin, y: -rx * Math.sin(t) * sin + ry * Math.cos(t) * cos })
  const cubics: Cubic[] = []
  for (let n = 0; n < parts; n++) {
    const a = start + n * step
    const b = a + step
    const p0 = n === 0 ? from : on(a)
    const p3 = n === parts - 1 ? to : on(b)
    const da = along(a)
    const db = along(b)
    cubics.push([p0, { x: p0.x + kappa * da.x, y: p0.y + kappa * da.y }, { x: p3.x - kappa * db.x, y: p3.y - kappa * db.y }, p3])
  }
  return cubics
}

const num = (n: number) => {
  const r = round(n)
  return String(Object.is(r, -0) ? 0 : r)
}

/** Writes a path as SVG path data, its points less `origin`, to hundredths. */
export function formatPath(path: PenPath, origin: Point = { x: 0, y: 0 }): string {
  const pt = (p: Point) => `${num(p.x - origin.x)} ${num(p.y - origin.y)}`
  const parts: string[] = []
  for (const contour of path) {
    const [first] = contour.anchors
    if (!first) continue
    parts.push(`M${pt(first)}`)
    for (const [from, to] of segmentsOf(contour)) {
      const a = contour.anchors[from] as Anchor
      const b = contour.anchors[to] as Anchor
      const curved = a.out || b.in
      // The closing straight segment is the Z itself.
      if (!curved && to === 0) continue
      parts.push(curved ? `C${pt(a.out ?? a)} ${pt(b.in ?? b)} ${pt(b)}` : `L${pt(b)}`)
    }
    if (contour.closed) parts.push('Z')
  }
  return parts.join(' ')
}

/** A contour's segments as pairs of anchor indexes, the closing one last. */
export function segmentsOf(contour: Contour): [number, number][] {
  const n = contour.anchors.length
  const segments: [number, number][] = []
  for (let i = 0; i < n - 1; i++) segments.push([i, i + 1])
  if (contour.closed && n > 1) segments.push([n - 1, 0])
  return segments
}

/** The cubic from one anchor to the next. A straight segment is a cubic with its controls on its ends. */
export function cubicOf(a: Anchor, b: Anchor): Cubic {
  return [{ x: a.x, y: a.y }, a.out ?? { x: a.x, y: a.y }, b.in ?? { x: b.x, y: b.y }, { x: b.x, y: b.y }]
}

export function pointAt([p0, p1, p2, p3]: Cubic, t: number): Point {
  const u = 1 - t
  const a = u * u * u
  const b = 3 * u * u * t
  const c = 3 * u * t * t
  const d = t * t * t
  return { x: a * p0.x + b * p1.x + c * p2.x + d * p3.x, y: a * p0.y + b * p1.y + c * p2.y + d * p3.y }
}

/** Where along one axis a cubic turns back: the roots in (0, 1) of its derivative. */
function turningPoints(p0: number, p1: number, p2: number, p3: number): number[] {
  const a = -p0 + 3 * p1 - 3 * p2 + p3
  const b = 2 * (p0 - 2 * p1 + p2)
  const c = p1 - p0
  const roots: number[] = []
  if (Math.abs(a) < 1e-12) {
    if (Math.abs(b) > 1e-12) roots.push(-c / b)
  } else {
    const disc = b * b - 4 * a * c
    if (disc >= 0) roots.push((-b + Math.sqrt(disc)) / (2 * a), (-b - Math.sqrt(disc)) / (2 * a))
  }
  return roots.filter((t) => t > 0 && t < 1)
}

/** The box the path's outline fills, curves included, without its stroke; null for no anchors. */
export function pathBounds(path: PenPath): { x: number; y: number; width: number; height: number } | null {
  const points: Point[] = []
  for (const contour of path) {
    points.push(...contour.anchors)
    for (const [from, to] of segmentsOf(contour)) {
      const cubic = cubicOf(contour.anchors[from] as Anchor, contour.anchors[to] as Anchor)
      const [p0, p1, p2, p3] = cubic
      for (const t of [...turningPoints(p0.x, p1.x, p2.x, p3.x), ...turningPoints(p0.y, p1.y, p2.y, p3.y)]) points.push(pointAt(cubic, t))
    }
  }
  if (points.length === 0) return null
  const xs = points.map((p) => p.x)
  const ys = points.map((p) => p.y)
  const x = Math.min(...xs)
  const y = Math.min(...ys)
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y }
}

/** The point of a cubic nearest `p`: sampled, then narrowed down. */
export function nearestOnCubic(cubic: Cubic, p: Point): { t: number; point: Point; distance: number } {
  const SAMPLES = 32
  let best = 0
  let bestDistance = Number.POSITIVE_INFINITY
  for (let n = 0; n <= SAMPLES; n++) {
    const dist = distance(pointAt(cubic, n / SAMPLES), p)
    if (dist < bestDistance) {
      bestDistance = dist
      best = n / SAMPLES
    }
  }
  let span = 1 / SAMPLES
  for (let pass = 0; pass < 24; pass++) {
    span /= 2
    for (const t of [best - span, best + span]) {
      if (t < 0 || t > 1) continue
      const dist = distance(pointAt(cubic, t), p)
      if (dist < bestDistance) {
        bestDistance = dist
        best = t
      }
    }
  }
  return { t: best, point: pointAt(cubic, best), distance: bestDistance }
}

/** What a press at `p` is on: a shown handle first, then an anchor, then a segment; null for none. */
export type PathHit =
  | { kind: 'control'; ref: AnchorRef; side: Side }
  | { kind: 'anchor'; ref: AnchorRef }
  | { kind: 'segment'; contour: number; from: number; t: number }

/**
 * Hit tests a path within `reach`: the handles of `shown` anchors, then anchors, then segments.
 * The nearest of each kind wins.
 */
export function hitPath(path: PenPath, p: Point, reach: number, shown: AnchorRef[] = []): PathHit | null {
  let control: { hit: PathHit; dist: number } | null = null
  for (const ref of shown) {
    const anchor = anchorOf(path, ref)
    for (const side of ['in', 'out'] as const) {
      const h = anchor?.[side]
      const dist = h ? distance(h, p) : Number.POSITIVE_INFINITY
      if (dist <= reach && (!control || dist < control.dist)) control = { hit: { kind: 'control', ref, side }, dist }
    }
  }
  if (control) return control.hit
  let anchor: { hit: PathHit; dist: number } | null = null
  path.forEach((contour, c) => contour.anchors.forEach((a, index) => {
    const dist = distance(a, p)
    if (dist <= reach && (!anchor || dist < anchor.dist)) anchor = { hit: { kind: 'anchor', ref: { contour: c, index } }, dist }
  }))
  if (anchor) return (anchor as { hit: PathHit }).hit
  let segment: { hit: PathHit; dist: number } | null = null
  path.forEach((contour, c) => {
    for (const [from, to] of segmentsOf(contour)) {
      const near = nearestOnCubic(cubicOf(contour.anchors[from] as Anchor, contour.anchors[to] as Anchor), p)
      if (near.distance <= reach && (!segment || near.distance < segment.dist)) segment = { hit: { kind: 'segment', contour: c, from, t: near.t }, dist: near.distance }
    }
  })
  return segment ? (segment as { hit: PathHit }).hit : null
}

export const anchorOf = (path: PenPath, ref: AnchorRef): Anchor | undefined => path[ref.contour]?.anchors[ref.index]
export const sameRef = (a: AnchorRef, b: AnchorRef) => a.contour === b.contour && a.index === b.index

const copy = (path: PenPath): PenPath => path.map((c) => ({
  closed: c.closed,
  anchors: c.anchors.map((a) => ({ x: a.x, y: a.y, ...(a.in && { in: { ...a.in } }), ...(a.out && { out: { ...a.out } }) })),
}))

/**
 * Adds an anchor on a segment at `t` without changing the path's outline: the curve is split in
 * two (de Casteljau), and the anchors either side get the shorter handles that split gives.
 */
export function splitSegment(path: PenPath, contour: number, from: number, t: number): { path: PenPath; ref: AnchorRef } {
  const next = copy(path)
  const c = next[contour]
  if (!c) throw new Error(`no contour ${contour}`)
  const to = from === c.anchors.length - 1 ? 0 : from + 1
  const a = c.anchors[from] as Anchor
  const b = c.anchors[to] as Anchor
  const [p0, p1, p2, p3] = cubicOf(a, b)
  const p01 = lerp(p0, p1, t)
  const p12 = lerp(p1, p2, t)
  const p23 = lerp(p2, p3, t)
  const p012 = lerp(p01, p12, t)
  const p123 = lerp(p12, p23, t)
  const at = lerp(p012, p123, t)
  const added: Anchor = { x: at.x, y: at.y }
  if (a.out || b.in) {
    const out = handle(a, p01)
    if (out) a.out = out
    else delete a.out
    const into = handle(b, p23)
    if (into) b.in = into
    else delete b.in
    const addedIn = handle(at, p012)
    const addedOut = handle(at, p123)
    if (addedIn) added.in = addedIn
    if (addedOut) added.out = addedOut
  }
  const index = from + 1
  c.anchors.splice(index, 0, added)
  return { path: next, ref: { contour, index } }
}

/** Takes anchors out. A contour left with fewer than two anchors goes too. */
export function deleteAnchors(path: PenPath, refs: AnchorRef[]): PenPath {
  return copy(path)
    .map((c, contour) => ({ ...c, anchors: c.anchors.filter((_, index) => !refs.some((r) => sameRef(r, { contour, index }))) }))
    .filter((c) => c.anchors.length >= 2)
}

/** Moves anchors, with their handles, by an offset. */
export function moveAnchors(path: PenPath, refs: AnchorRef[], dx: number, dy: number): PenPath {
  const next = copy(path)
  const by = (p: Point) => ({ x: p.x + dx, y: p.y + dy })
  for (const ref of refs) {
    const a = anchorOf(next, ref)
    if (!a) continue
    Object.assign(a, by(a))
    if (a.in) a.in = by(a.in)
    if (a.out) a.out = by(a.out)
  }
  return next
}

/** Whether an anchor's handles point straight away from each other, so the curve runs smooth through it. */
export function isSmooth(anchor: Anchor): boolean {
  if (!anchor.in || !anchor.out) return false
  const a = Math.atan2(anchor.in.y - anchor.y, anchor.in.x - anchor.x)
  const b = Math.atan2(anchor.out.y - anchor.y, anchor.out.x - anchor.x)
  const apart = (b - a + 4 * Math.PI) % (2 * Math.PI)
  return Math.abs(apart - Math.PI) < (2 * Math.PI) / 180
}

/**
 * Moves one handle to `to`. With `mirror`, the other handle turns to stay straight opposite,
 * keeping its own length, so a smooth anchor stays smooth.
 */
export function moveControl(path: PenPath, ref: AnchorRef, side: Side, to: Point, mirror: boolean): PenPath {
  const next = copy(path)
  const a = anchorOf(next, ref)
  if (!a) return next
  const moved = handle(a, to)
  if (moved) a[side] = moved
  else if (side === 'in') delete a.in
  else delete a.out
  const other = side === 'in' ? 'out' : 'in'
  const keep = a[other]
  if (mirror && moved && keep) {
    const length = distance(keep, a)
    const away = distance(moved, a)
    a[other] = { x: a.x - ((moved.x - a.x) / away) * length, y: a.y - ((moved.y - a.y) / away) * length }
  }
  return next
}

/** The point `to` turned about `from` to the nearest 45°, as far from it as the pointer is. */
export function constrain(from: Point, to: Point): Point {
  const length = distance(from, to)
  const angle = Math.round(Math.atan2(to.y - from.y, to.x - from.x) / (Math.PI / 4)) * (Math.PI / 4)
  return { x: from.x + Math.cos(angle) * length, y: from.y + Math.sin(angle) * length }
}

/** The whole path moved by an offset. */
export function offsetPath(path: PenPath, dx: number, dy: number): PenPath {
  return moveAnchors(path, path.flatMap((c, contour) => c.anchors.map((_, index) => ({ contour, index }))), dx, dy)
}
