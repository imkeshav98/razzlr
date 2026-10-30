import type { Effect, Paint } from '@razzlr/schema'
import type {
  Canvas, CanvasKit, FontCollection, Image, ImageFilter, Paint as CkPaint, Path, Shader,
} from 'canvaskit-wasm'
import { color } from './color.ts'
import type { Scene, SceneLayer } from './scene.ts'
import { layoutText } from './text.ts'

/** What drawing needs besides the scene: fonts registered from our own files and images decoded by CanvasKit. */
export interface Resources {
  fonts: FontCollection
  /** Families tried, in order, for characters a layer's own font lacks. */
  fallbackFamilies: string[]
  images: ReadonlyMap<string, Image>
}

type Box = { x: number; y: number; width: number; height: number }
type TextLayer = Extract<SceneLayer, { type: 'text' }>
type GraphicLayer = Extract<SceneLayer, { type: 'graphic' }>

/** Blur radii in the schema are twice the Gaussian sigma, as in CSS box-shadow and design tools. */
const sigma = (radius: number) => radius / 2

/**
 * Draws a scene. The one drawing path for every surface: the same calls run on the CPU surface for
 * exports and on WebGL for the editor screen (ADR-0005), so only the surface differs.
 */
export function drawScene(ck: CanvasKit, canvas: Canvas, scene: Scene, resources: Resources) {
  const page = { x: 0, y: 0, width: scene.width, height: scene.height }
  canvas.clear(ck.TRANSPARENT)
  const pagePath = rectPath(ck, page)
  for (const fill of scene.fills) fillPath(ck, canvas, pagePath, fill, page, resources)
  pagePath.delete()
  for (const layer of scene.layers) drawLayer(ck, canvas, layer, resources)
}

function drawLayer(ck: CanvasKit, canvas: Canvas, layer: SceneLayer, resources: Resources) {
  const { props } = layer
  canvas.save()
  if (props.rotation !== 0) canvas.rotate(props.rotation, props.x + props.width / 2, props.y + props.height / 2)

  const content = () => drawContent(ck, canvas, layer, resources)
  const needsLayer = props.opacity < 1 || props.blendMode !== 'normal' || props.effects.length > 0
  if (!needsLayer) {
    content()
  } else {
    // An offscreen layer only as big as what the layer draws, effects included; a page-sized one
    // for every translucent layer made the 300-layer stress fixture take 15 s (#18).
    // One pixel more for anti-aliased edges.
    const reach = withEffects(drawnBounds(ck, layer), props.effects)
    const bounds = reach && ck.XYWHRect(reach.x - 1, reach.y - 1, reach.width + 2, reach.height + 2)
    const layerPaint = new ck.Paint()
    layerPaint.setAlphaf(props.opacity)
    layerPaint.setBlendMode(blendMode(ck, props.blendMode))
    canvas.saveLayer(layerPaint, bounds)
    layerPaint.delete()
    for (const effect of props.effects) {
      if (effect.type === 'dropShadow') withFilter(ck, canvas, dropShadow(ck, effect), bounds, content)
    }
    // The first blur that blurs; a zero-radius one before it no longer hides it.
    const blur = props.effects.find((e): e is Extract<Effect, { type: 'layerBlur' }> => e.type === 'layerBlur' && e.radius > 0)
    if (blur) {
      withFilter(ck, canvas, ck.ImageFilter.MakeBlur(sigma(blur.radius), sigma(blur.radius), ck.TileMode.Decal, null), bounds, content)
    } else {
      content()
    }
    canvas.restore()
  }
  canvas.restore()
}

function drawContent(ck: CanvasKit, canvas: Canvas, layer: SceneLayer, resources: Resources) {
  switch (layer.type) {
    case 'graphic':
      return drawGraphic(ck, canvas, layer, resources)
    case 'text':
      return drawText(ck, canvas, layer, resources)
    case 'frame': {
      const { props } = layer
      const path = rectPath(ck, props)
      for (const fill of props.fills) fillPath(ck, canvas, path, fill, props, resources)
      canvas.save()
      if (props.clip) canvas.clipPath(path, ck.ClipOp.Intersect, true)
      path.delete()
      for (const child of layer.children) drawLayer(ck, canvas, child, resources)
      canvas.restore()
      return
    }
    case 'group':
      for (const child of layer.children) drawLayer(ck, canvas, child, resources)
      return
  }
}

function withFilter(ck: CanvasKit, canvas: Canvas, filter: ImageFilter, bounds: Float32Array | null, draw: () => void) {
  const paint = new ck.Paint()
  paint.setImageFilter(filter)
  canvas.saveLayer(paint, bounds)
  draw()
  canvas.restore()
  paint.delete()
  filter.delete()
}

function dropShadow(ck: CanvasKit, effect: Extract<Effect, { type: 'dropShadow' }>) {
  const spread = effect.spread > 0 ? ck.ImageFilter.MakeDilate(effect.spread, effect.spread, null)
    : effect.spread < 0 ? ck.ImageFilter.MakeErode(-effect.spread, -effect.spread, null) : null
  const shadow = ck.ImageFilter.MakeDropShadowOnly(effect.x, effect.y, sigma(effect.blur), sigma(effect.blur), color(ck, effect.color), spread)
  spread?.delete()
  return shadow
}

/** Skia's default miter limit: a mitred corner reaches up to 4 × half the stroke width past the outline. */
const MITER_LIMIT = 4
/** A Gaussian blur's visible reach, in sigmas. */
const BLUR_REACH = 3

const union = (a: Box, b: Box): Box => {
  const x = Math.min(a.x, b.x)
  const y = Math.min(a.y, b.y)
  return { x, y, width: Math.max(a.x + a.width, b.x + b.width) - x, height: Math.max(a.y + a.height, b.y + b.height) - y }
}
const outset = (box: Box, by: number): Box => ({ x: box.x - by, y: box.y - by, width: box.width + 2 * by, height: box.height + 2 * by })

/** The box after turning it about its own centre, as the axis-aligned box around the result. */
function rotated(box: Box, about: Box, degrees: number): Box {
  if (degrees === 0) return box
  const a = (degrees * Math.PI) / 180
  const cx = about.x + about.width / 2
  const cy = about.y + about.height / 2
  const corners = [[box.x, box.y], [box.x + box.width, box.y], [box.x, box.y + box.height], [box.x + box.width, box.y + box.height]]
    .map(([px = 0, py = 0]) => [cx + (px - cx) * Math.cos(a) - (py - cy) * Math.sin(a), cy + (px - cx) * Math.sin(a) + (py - cy) * Math.cos(a)])
  const xs = corners.map(([x = 0]) => x)
  const ys = corners.map(([, y = 0]) => y)
  return { x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) }
}

/**
 * What a layer's content can touch, in its own unrotated coordinates; null when that isn't known
 * yet (text, groups, frames holding them), which draws into an unbounded layer as before.
 */
function drawnBounds(ck: CanvasKit, layer: SceneLayer): Box | null {
  switch (layer.type) {
    case 'graphic': {
      const path = shapePath(ck, layer)
      const [left = 0, top = 0, right = 0, bottom = 0] = path.computeTightBounds()
      path.delete()
      const reach = Math.max(0, ...layer.props.strokes.map((s) => (s.align === 'inside' ? 0 : s.align === 'center' ? s.width / 2 : s.width) * MITER_LIMIT))
      return outset({ x: left, y: top, width: right - left, height: bottom - top }, reach)
    }
    case 'frame': {
      if (layer.props.clip) return layer.props
      let box: Box = layer.props
      for (const child of layer.children) {
        const inner = withEffects(drawnBounds(ck, child), child.props.effects)
        if (!inner) return null
        box = union(box, rotated(inner, child.props, child.props.rotation))
      }
      return box
    }
    case 'text':
    case 'group':
      return null
  }
}

/** Grows a layer's drawn bounds by how far its shadows and blur reach. */
function withEffects(box: Box | null, effects: readonly Effect[]): Box | null {
  if (!box) return null
  let reach = box
  for (const effect of effects) {
    if (effect.type === 'dropShadow') {
      const shadow = outset(box, BLUR_REACH * sigma(effect.blur) + Math.max(0, effect.spread))
      reach = union(reach, { ...shadow, x: shadow.x + effect.x, y: shadow.y + effect.y })
    } else if (effect.type === 'layerBlur') {
      reach = outset(reach, BLUR_REACH * sigma(effect.radius))
    }
  }
  return reach
}

const rectPath = (ck: CanvasKit, box: Box) => new ck.PathBuilder().addRect(ck.XYWHRect(box.x, box.y, box.width, box.height)).detachAndDelete()

function shapePath(ck: CanvasKit, layer: GraphicLayer): Path {
  const { x, y, width, height, shape } = layer.props
  switch (shape.kind) {
    case 'rect': {
      const r = Math.min(shape.cornerRadius, width / 2, height / 2)
      return new ck.PathBuilder().addRRect(ck.RRectXY(ck.XYWHRect(x, y, width, height), r, r)).detachAndDelete()
    }
    case 'ellipse':
      return new ck.PathBuilder().addOval(ck.XYWHRect(x, y, width, height)).detachAndDelete()
    case 'path': {
      // Path data is drawn at its own size, placed at x and y. Scaling it with width and height
      // arrives with adapt, which is the first thing to resize a path per format.
      const parsed = ck.Path.MakeFromSVGString(shape.d)
      if (!parsed) throw new Error(`layer "${layer.id}" has path data CanvasKit can't read`)
      const builder = new ck.PathBuilder(parsed)
      parsed.delete()
      return builder
        .transform(ck.Matrix.translated(x, y))
        .setFillType(shape.fillRule === 'evenodd' ? ck.FillType.EvenOdd : ck.FillType.Winding)
        .detachAndDelete()
    }
  }
}

function drawGraphic(ck: CanvasKit, canvas: Canvas, layer: GraphicLayer, resources: Resources) {
  const { props } = layer
  const path = shapePath(ck, layer)
  for (const fill of props.fills) fillPath(ck, canvas, path, fill, props, resources)
  for (const stroke of props.strokes) {
    const paint = paintFor(ck, stroke.paint, props, resources)
    if (!paint) continue
    paint.setStyle(ck.PaintStyle.Stroke)
    canvas.save()
    if (stroke.align === 'center') {
      paint.setStrokeWidth(stroke.width)
    } else {
      // Half of a doubled stroke falls on each side of the outline; the clip keeps the wanted half.
      paint.setStrokeWidth(stroke.width * 2)
      canvas.clipPath(path, stroke.align === 'inside' ? ck.ClipOp.Intersect : ck.ClipOp.Difference, true)
    }
    canvas.drawPath(path, paint)
    canvas.restore()
    paint.delete()
  }
  path.delete()
}

function fillPath(ck: CanvasKit, canvas: Canvas, path: Path, fill: Paint, box: Box, resources: Resources) {
  const paint = paintFor(ck, fill, box, resources)
  if (!paint) return
  canvas.drawPath(path, paint)
  paint.delete()
}

/** A CanvasKit paint for one schema paint. Gradient and image geometry is placed in the layer's box. */
function paintFor(ck: CanvasKit, fill: Paint, box: Box, resources: Resources): CkPaint | null {
  const paint = new ck.Paint()
  paint.setAntiAlias(true)
  let shader: Shader | null = null
  const unitBox = ck.Matrix.multiply(ck.Matrix.translated(box.x, box.y), ck.Matrix.scaled(box.width, box.height))
  switch (fill.type) {
    case 'solid':
      paint.setColor(color(ck, fill.color))
      break
    case 'linear':
      shader = ck.Shader.MakeLinearGradient(
        [fill.from.x, fill.from.y], [fill.to.x, fill.to.y],
        fill.stops.map((s) => color(ck, s.color)), fill.stops.map((s) => s.offset), ck.TileMode.Clamp, unitBox,
      )
      break
    case 'radial':
      shader = ck.Shader.MakeRadialGradient(
        [fill.center.x, fill.center.y], fill.radius,
        fill.stops.map((s) => color(ck, s.color)), fill.stops.map((s) => s.offset), ck.TileMode.Clamp, unitBox,
      )
      break
    case 'image': {
      const image = resources.images.get(fill.assetId)
      if (!image) throw new Error(`no image for asset "${fill.assetId}"`)
      shader = imageShader(ck, image, fill, box)
      paint.setAlphaf(fill.opacity)
      break
    }
  }
  if (shader) {
    paint.setShader(shader)
    shader.delete()
  }
  return paint
}

/** Places an image in a box: fill covers it, fit fits inside it, crop shows the crop rect stretched to it, tile repeats it. */
function imageShader(ck: CanvasKit, image: Image, fill: Extract<Paint, { type: 'image' }>, box: Box): Shader {
  const iw = image.width()
  const ih = image.height()
  const sampling = [ck.FilterMode.Linear, ck.MipmapMode.None] as const
  if (fill.fit === 'tile') {
    return image.makeShaderOptions(ck.TileMode.Repeat, ck.TileMode.Repeat, ...sampling, ck.Matrix.translated(box.x, box.y))
  }
  let src = { x: 0, y: 0, width: iw, height: ih }
  let dst: Box = box
  if (fill.fit === 'crop' && fill.crop) {
    src = fill.crop
  } else if (fill.fit === 'fill' || fill.fit === 'crop') {
    const scale = Math.max(box.width / iw, box.height / ih)
    src = { width: box.width / scale, height: box.height / scale, x: (iw - box.width / scale) / 2, y: (ih - box.height / scale) / 2 }
  } else {
    const scale = Math.min(box.width / iw, box.height / ih)
    dst = { width: iw * scale, height: ih * scale, x: box.x + (box.width - iw * scale) / 2, y: box.y + (box.height - ih * scale) / 2 }
  }
  const matrix = ck.Matrix.multiply(
    ck.Matrix.translated(dst.x, dst.y),
    ck.Matrix.scaled(dst.width / src.width, dst.height / src.height),
    ck.Matrix.translated(-src.x, -src.y),
  )
  const tile = fill.fit === 'fit' ? ck.TileMode.Decal : ck.TileMode.Clamp
  return image.makeShaderOptions(tile, tile, ...sampling, matrix)
}

function drawText(ck: CanvasKit, canvas: Canvas, layer: TextLayer, resources: Resources) {
  const { paragraph, dy } = layoutText(ck, layer.props, resources)
  canvas.drawParagraph(paragraph, layer.props.x, layer.props.y + dy)
  paragraph.delete()
}

function blendMode(ck: CanvasKit, mode: SceneLayer['props']['blendMode']) {
  const b = ck.BlendMode
  return {
    normal: b.SrcOver, multiply: b.Multiply, screen: b.Screen, overlay: b.Overlay, darken: b.Darken, lighten: b.Lighten,
    'color-dodge': b.ColorDodge, 'color-burn': b.ColorBurn, 'hard-light': b.HardLight, 'soft-light': b.SoftLight,
    difference: b.Difference, exclusion: b.Exclusion, hue: b.Hue, saturation: b.Saturation, color: b.Color, luminosity: b.Luminosity,
  }[mode]
}
