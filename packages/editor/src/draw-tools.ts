// Drawing shapes with a drag (#44): what each shape tool makes, and the box a drag gives it. Kept
// free of the editor so the geometry can be tested on its own. Points are a page's design pixels.
import { normalAngle, round } from './transform.ts'
import type { Point } from './hit-test.ts'

export const SHAPE_TOOLS = ['rect', 'ellipse', 'polygon', 'star', 'line', 'arrow'] as const
export type ShapeTool = (typeof SHAPE_TOOLS)[number]
export const isShapeTool = (tool: string): tool is ShapeTool => (SHAPE_TOOLS as readonly string[]).includes(tool)
/** What a drag draws: a shape, or a frame. */
export type DrawTool = ShapeTool | 'frame'
export const isDrawTool = (tool: string): tool is DrawTool => tool === 'frame' || isShapeTool(tool)

/** The size a click without a drag draws, in design pixels. */
export const CLICK_SIZE = 100
/** A frame clicked without a drag is bigger: room for what goes in it. */
export const FRAME_CLICK_SIZE = 200
/** New shapes are a neutral grey until a style is picked; lines a near-black stroke. */
const FILL = '#C9CED6FF'
const INK = '#1F2329FF'

/** A layer as node.create takes it. */
export interface NewLayer { type: 'graphic' | 'frame'; name: string; props: Record<string, unknown> }

/** A new frame for the frame tool, at no size yet: white, as frames start in most design tools. */
export const newFrame = (): NewLayer => ({ type: 'frame', name: 'Frame', props: { x: 0, y: 0, width: 0, height: 0, fills: [{ type: 'solid', color: '#FFFFFFFF' }] } })

/** A new layer for a drawing tool, at no size yet. */
export const newDrawn = (tool: DrawTool): NewLayer => (tool === 'frame' ? newFrame() : newShape(tool))

/** A new layer for a shape tool, at no size yet. */
export function newShape(tool: ShapeTool): NewLayer {
  const at = { x: 0, y: 0, width: 0, height: 0 }
  const filled = (name: string, shape: Record<string, unknown>): NewLayer => ({ type: 'graphic', name, props: { ...at, shape, fills: [{ type: 'solid', color: FILL }] } })
  switch (tool) {
    case 'rect': return filled('Rectangle', { kind: 'rect' })
    case 'ellipse': return filled('Ellipse', { kind: 'ellipse' })
    case 'polygon': return filled('Polygon', { kind: 'polygon' })
    case 'star': return filled('Star', { kind: 'star' })
    case 'line':
    case 'arrow':
      return {
        type: 'graphic',
        name: tool === 'line' ? 'Line' : 'Arrow',
        props: {
          ...at,
          shape: { kind: 'line', end: tool === 'arrow' ? 'arrow' : 'none' },
          strokes: [{ paint: { type: 'solid', color: INK }, width: 4, cap: 'round', join: 'round' }],
        },
      }
  }
}

export type Drawn = { x: number; y: number; width: number; height: number; rotation: number }

/**
 * The box a drag from `from` to `to` draws. Shift keeps a shape's sides equal and turns a line in
 * steps of 45°; Alt draws a shape out from its centre. A line runs along its box's middle, so its
 * box is as long as the line, no taller than nothing, and turned to the line's angle.
 */
export function drawnBox(tool: DrawTool, from: Point, to: Point, shift: boolean, alt: boolean): Drawn {
  let dx = to.x - from.x
  let dy = to.y - from.y
  if (tool === 'line' || tool === 'arrow') {
    let length = Math.hypot(dx, dy)
    let angle = Math.atan2(dy, dx)
    if (shift) angle = Math.round(angle / (Math.PI / 4)) * (Math.PI / 4)
    if (alt) length *= 2
    const start = alt ? { x: from.x - (Math.cos(angle) * length) / 2, y: from.y - (Math.sin(angle) * length) / 2 } : from
    const mid = { x: start.x + (Math.cos(angle) * length) / 2, y: start.y + (Math.sin(angle) * length) / 2 }
    return { x: round(mid.x - length / 2), y: round(mid.y), width: round(length), height: 0, rotation: round(normalAngle((angle * 180) / Math.PI)) }
  }
  if (shift) {
    const side = Math.max(Math.abs(dx), Math.abs(dy))
    dx = Math.sign(dx || 1) * side
    dy = Math.sign(dy || 1) * side
  }
  const x0 = alt ? from.x - dx : from.x
  const y0 = alt ? from.y - dy : from.y
  const x1 = from.x + dx
  const y1 = from.y + dy
  return { x: round(Math.min(x0, x1)), y: round(Math.min(y0, y1)), width: round(Math.abs(x1 - x0)), height: round(Math.abs(y1 - y0)), rotation: 0 }
}

/** What a click without a drag draws: CLICK_SIZE across (a frame FRAME_CLICK_SIZE), centred where it landed. */
export function clickedBox(tool: DrawTool, at: Point): Drawn {
  if (tool === 'line' || tool === 'arrow') return { x: round(at.x - CLICK_SIZE / 2), y: round(at.y), width: CLICK_SIZE, height: 0, rotation: 0 }
  const size = tool === 'frame' ? FRAME_CLICK_SIZE : CLICK_SIZE
  return { x: round(at.x - size / 2), y: round(at.y - size / 2), width: size, height: size, rotation: 0 }
}

/** New text is near-black Noto Sans until a style is picked: the family every script falls back to. */
const NEW_TEXT_STYLE = { fontFamily: 'Noto Sans', fontSize: 48, fontWeight: 400, color: INK }

/**
 * A new, empty text layer for the text tool (#47): at the point clicked, growing as it is typed,
 * or in the box dragged, wrapping inside it and keeping its size.
 */
export function newText(x: number, y: number, box: { x: number; y: number; width: number; height: number } | null) {
  return {
    type: 'text' as const,
    name: 'Text',
    props: box
      ? { ...box, text: '', boxMode: 'fixed', style: NEW_TEXT_STYLE }
      : { x, y, width: 0, height: 0, text: '', boxMode: 'autoWidth', style: NEW_TEXT_STYLE },
  }
}

/** The most of a frame's width or height an image placed from the asset library takes at first (#52). */
export const PLACED_SHARE = 0.5

/**
 * A graphic filled with an image asset (#52), centred on `at` in a frame of `frame` size: the
 * image's own size, or smaller to take at most half the frame's width and height, its shape kept.
 */
export function newImage(asset: { id: string; name: string; width: number; height: number }, at: Point, frame: { width: number; height: number }): NewLayer {
  const scale = Math.min(1, (frame.width * PLACED_SHARE) / asset.width, (frame.height * PLACED_SHARE) / asset.height)
  // Whole pixels, so the image starts sharp.
  const width = Math.max(1, Math.round(asset.width * scale))
  const height = Math.max(1, Math.round(asset.height * scale))
  return imageIn(asset, { x: Math.round(at.x - width / 2), y: Math.round(at.y - height / 2), width, height })
}

/** A graphic filled with an image asset in a box, such as one the image tool dragged: the image covers it. */
export function imageIn(asset: { id: string; name: string }, box: { x: number; y: number; width: number; height: number }): NewLayer {
  return {
    type: 'graphic',
    name: asset.name.trim() || 'Image',
    props: {
      ...box,
      shape: { kind: 'rect' },
      fills: [{ type: 'image', assetId: asset.id, fit: 'fill' }],
    },
  }
}
