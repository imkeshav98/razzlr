import type { Effect, Paint } from '@razzlr/schema'
import type {
  Canvas, CanvasKit, FontCollection, Image, ImageFilter, Paint as CkPaint, Path, Shader,
} from 'canvaskit-wasm'
import { color } from './color.ts'
import type { LayerPictures } from './pictures.ts'
import type { Scene, SceneLayer } from './scene.ts'
import { layoutText, type ParagraphCache } from './text.ts'

/** What drawing needs besides the scene: fonts registered from our own files and images decoded by CanvasKit. */
export interface Resources {
  fonts: FontCollection
  /** Families tried, in order, for characters a layer's own font lacks. */
  fallbackFamilies: string[]
  images: ReadonlyMap<string, Image>
  /** Paragraphs kept between draws, for the editor's screen; without it each draw lays out its text and frees it. */
  paragraphs?: ParagraphCache
  /** Top-level layers recorded between draws, for the editor's screen; without it each draw draws every layer. */
  layers?: LayerPictures
}

/** A text layer laid out, from the paragraph cache when there is one; `done` frees what the cache doesn't own. */
function laidOut(ck: CanvasKit, props: TextLayer['props'], resources: Resources) {
  if (resources.paragraphs) return { ...resources.paragraphs.layout(ck, props, resources), done: () => {} }
  const laid = layoutText(ck, props, resources)
  return { ...laid, done: () => laid.paragraph.delete() }
}

type Box = { x: number; y: number; width: number; height: number }
type TextLayer = Extract<SceneLayer, { type: 'text' }>
type GraphicLayer = Extract<SceneLayer, { type: 'graphic' }>

/** A clip wider than any page, so clipping to it changes nothing. */
const EVERYWHERE = Float32Array.of(-1e6, -1e6, 1e6, 1e6)

/** Blur radii in the schema are twice the Gaussian sigma, as in CSS box-shadow and design tools. */
const sigma = (radius: number) => radius / 2

/**
 * Draws a scene. The one drawing path for every surface: the same calls run on the CPU surface for
 * exports and on WebGL for the editor screen (ADR-0005), so only the surface differs.
 */
export function drawScene(ck: CanvasKit, canvas: Canvas, scene: Scene, resources: Resources) {
  canvas.clear(ck.TRANSPARENT)
  drawPageContent(ck, canvas, scene, resources)
}

/**
 * Draws a scene onto part of a bigger canvas, such as one frame of the editor's infinite canvas:
 * nothing outside the page shows and nothing else on the canvas is cleared. The caller places it.
 */
export function drawPage(ck: CanvasKit, canvas: Canvas, scene: Scene, resources: Resources) {
  canvas.save()
  canvas.clipRect(ck.XYWHRect(0, 0, scene.width, scene.height), ck.ClipOp.Intersect, true)
  drawPageContent(ck, canvas, scene, resources)
  canvas.restore()
}

function drawPageContent(ck: CanvasKit, canvas: Canvas, scene: Scene, resources: Resources) {
  const page = { x: 0, y: 0, width: scene.width, height: scene.height }
  const pagePath = rectPath(ck, page)
  for (const fill of scene.fills) fillPath(ck, canvas, pagePath, fill, page, resources)
  pagePath.delete()
  const { layers } = resources
  for (const layer of scene.layers) {
    if (layers) canvas.drawPicture(layers.picture(ck, layer, resources, (into) => drawLayer(ck, into, layer, resources)))
    else drawLayer(ck, canvas, layer, resources)
  }
}

function drawLayer(ck: CanvasKit, canvas: Canvas, layer: SceneLayer, resources: Resources) {
  const { props } = layer
  canvas.save()
  if (props.rotation !== 0) canvas.rotate(props.rotation, props.x + props.width / 2, props.y + props.height / 2)

  // Frosted glass first: what is already drawn behind the layer, blurred inside its outline.
  const glass = props.effects.find((e): e is Extract<Effect, { type: 'backgroundBlur' }> => e.type === 'backgroundBlur' && e.radius > 0)
  if (glass) blurBehind(ck, canvas, layer, glass.radius)

  const content = () => drawContent(ck, canvas, layer, resources)
  const own = props.effects.filter((e) => e.type !== 'backgroundBlur')
  // A group or frame is drawn by itself first unless it passes through; other layers only for a mode that isn't normal.
  const container = layer.type === 'group' || layer.type === 'frame'
  const together = props.blendMode !== 'pass-through' && (props.blendMode !== 'normal' || container)
  const needsLayer = props.opacity < 1 || together || own.length > 0
  if (!needsLayer) {
    content()
  } else {
    // An offscreen layer only as big as what the layer draws, effects included; a page-sized one
    // for every translucent layer made the 300-layer stress fixture take 15 s (#18).
    // One pixel more for anti-aliased edges.
    const reach = withEffects(drawnBounds(ck, layer, resources), props.effects)
    const bounds = ck.XYWHRect(reach.x - 1, reach.y - 1, reach.width + 2, reach.height + 2)
    const layerPaint = new ck.Paint()
    layerPaint.setAlphaf(props.opacity)
    layerPaint.setBlendMode(blendMode(ck, props.blendMode))
    canvas.saveLayer(layerPaint, bounds)
    layerPaint.delete()
    // Changes no pixel, but keeps a recorded picture from folding the layer's opacity into its one
    // draw (Skia's SkRecordOptimize), which rounds differently: the editor draws through pictures
    // and must match exports exactly (#36).
    canvas.clipRect(EVERYWHERE, ck.ClipOp.Intersect, false)
    // Shadows and glows behind the content, in their order.
    for (const effect of own) {
      if (effect.type === 'dropShadow') withFilter(ck, canvas, dropShadow(ck, effect), bounds, content)
      if (effect.type === 'glow') withFilter(ck, canvas, dropShadow(ck, { ...effect, x: 0, y: 0 }), bounds, content)
    }
    // The first blur that blurs; a zero-radius one before it no longer hides it.
    const blur = props.effects.find((e): e is Extract<Effect, { type: 'layerBlur' }> => e.type === 'layerBlur' && e.radius > 0)
    if (blur) {
      withFilter(ck, canvas, ck.ImageFilter.MakeBlur(sigma(blur.radius), sigma(blur.radius), ck.TileMode.Decal, null), bounds, content)
    } else {
      content()
    }
    // Inner shadows over the content, each kept inside it.
    for (const effect of own) {
      if (effect.type === 'innerShadow') withFilter(ck, canvas, innerShadow(ck, effect), bounds, content)
    }
    canvas.restore()
  }
  canvas.restore()
}

/**
 * Blurs what the canvas already holds under a layer's outline: a layer of nothing, whose
 * backdrop is the blurred canvas, clipped to the outline. Edges clamp, so the blur doesn't
 * fade in from outside what it reads.
 */
function blurBehind(ck: CanvasKit, canvas: Canvas, layer: SceneLayer, radius: number) {
  const outline = outlineOf(ck, layer)
  const [left = 0, top = 0, right = 0, bottom = 0] = outline.computeTightBounds()
  canvas.save()
  canvas.clipPath(outline, ck.ClipOp.Intersect, true)
  outline.delete()
  const blur = ck.ImageFilter.MakeBlur(sigma(radius), sigma(radius), ck.TileMode.Clamp, null)
  canvas.saveLayer(undefined, ck.LTRBRect(left, top, right, bottom), blur, 0, ck.TileMode.Clamp)
  canvas.restore()
  canvas.restore()
  blur.delete()
}

/** The outline a background blur fills: a shape's own path, otherwise the layer's box. */
function outlineOf(ck: CanvasKit, layer: SceneLayer): Path {
  return layer.type === 'graphic' ? shapePath(ck, layer) : rectPath(ck, layer.props)
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

function dropShadow(ck: CanvasKit, effect: Pick<Extract<Effect, { type: 'dropShadow' }>, 'x' | 'y' | 'blur' | 'spread' | 'color'>) {
  const spread = effect.spread > 0 ? ck.ImageFilter.MakeDilate(effect.spread, effect.spread, null)
    : effect.spread < 0 ? ck.ImageFilter.MakeErode(-effect.spread, -effect.spread, null) : null
  const shadow = ck.ImageFilter.MakeDropShadowOnly(effect.x, effect.y, sigma(effect.blur), sigma(effect.blur), color(ck, effect.color), spread)
  spread?.delete()
  return shadow
}

/**
 * An inner shadow: the layer's outside, coloured, grown inwards by the spread, moved and
 * blurred, then kept only where the layer is. The colour matrix turns transparent into the
 * shadow colour and opaque into nothing, working on unpremultiplied values in 0 to 1.
 */
function innerShadow(ck: CanvasKit, effect: Extract<Effect, { type: 'innerShadow' }>) {
  const [r = 0, g = 0, b = 0, a = 0] = color(ck, effect.color)
  const outside = ck.ColorFilter.MakeMatrix([
    0, 0, 0, 0, r,
    0, 0, 0, 0, g,
    0, 0, 0, 0, b,
    0, 0, 0, -a, a,
  ])
  const colored = ck.ImageFilter.MakeColorFilter(outside, null)
  outside.delete()
  const spread = effect.spread > 0 ? ck.ImageFilter.MakeDilate(effect.spread, effect.spread, colored) : colored
  const moved = ck.ImageFilter.MakeOffset(effect.x, effect.y, spread)
  const blurred = ck.ImageFilter.MakeBlur(sigma(effect.blur), sigma(effect.blur), ck.TileMode.Decal, moved)
  const inside = ck.ImageFilter.MakeBlend(ck.BlendMode.SrcIn, null, blurred)
  for (const f of new Set([colored, spread, moved, blurred])) f.delete()
  return inside
}

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

/** What a layer's content can touch, in its own unrotated coordinates. */
function drawnBounds(ck: CanvasKit, layer: SceneLayer, resources: Resources): Box {
  switch (layer.type) {
    case 'graphic': {
      const path = shapePath(ck, layer)
      const [left = 0, top = 0, right = 0, bottom = 0] = path.computeTightBounds()
      path.delete()
      // A mitred corner reaches up to the miter limit × half the width past the outline; a square cap √2 × half.
      const reach = Math.max(0, ...layer.props.strokes.map((s) =>
        (s.align === 'inside' ? 0 : s.align === 'center' ? s.width / 2 : s.width) * (s.join === 'miter' ? Math.max(s.miterLimit, Math.SQRT2) : Math.SQRT2)))
      return outset({ x: left, y: top, width: right - left, height: bottom - top }, reach)
    }
    case 'text':
      return textBounds(ck, layer, resources)
    case 'frame':
      if (layer.props.clip) return layer.props
      return childrenBounds(ck, layer, resources, layer.props)
    case 'group':
      return childrenBounds(ck, layer, resources, { x: layer.props.x, y: layer.props.y, width: 0, height: 0 })
  }
}

/** A container's own box grown by everything its children draw, each turned as it is drawn. */
function childrenBounds(ck: CanvasKit, layer: SceneLayer, resources: Resources, own: Box): Box {
  let box = own
  for (const child of layer.children) {
    box = union(box, rotated(withEffects(drawnBounds(ck, child, resources), child.props.effects), child.props, child.props.rotation))
  }
  return box
}

/**
 * Where a text layer's lines sit, from the same paragraph drawing lays out, which can be outside
 * its box: a fixed box overflows, an auto width box grows. Glyphs can reach past their line's
 * ascent, descent and advance (marks, swashes, wide letters), so each side gets half the largest
 * font size more.
 */
function textBounds(ck: CanvasKit, layer: TextLayer, resources: Resources): Box {
  const { props } = layer
  const { paragraph, dy, done } = laidOut(ck, props, resources)
  let box: Box = props
  for (const line of paragraph.getLineMetrics()) {
    box = union(box, { x: props.x + line.left, y: props.y + dy + line.baseline - line.ascent, width: line.width, height: line.ascent + line.descent })
  }
  done()
  const largest = Math.max(props.style.fontSize, ...props.runs.map((r) => r.style.fontSize ?? 0))
  return outset(box, largest / 2)
}

/** Grows a layer's drawn bounds by how far its shadows and blur reach. */
function withEffects(box: Box, effects: readonly Effect[]): Box {
  let reach = box
  for (const effect of effects) {
    if (effect.type === 'dropShadow' || effect.type === 'glow') {
      const shadow = outset(box, BLUR_REACH * sigma(effect.blur) + Math.max(0, effect.spread))
      const { x = 0, y = 0 } = effect.type === 'dropShadow' ? effect : {}
      reach = union(reach, { ...shadow, x: shadow.x + x, y: shadow.y + y })
    } else if (effect.type === 'innerShadow') {
      // Drawn only inside the layer, but made from what lies around it: the offscreen holds that
      // much of the outside, so the edges of the offscreen never show as edges of the layer.
      reach = union(reach, outset(box, Math.max(Math.abs(effect.x), Math.abs(effect.y)) + BLUR_REACH * sigma(effect.blur) + effect.spread))
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
    paint.setStrokeCap({ butt: ck.StrokeCap.Butt, round: ck.StrokeCap.Round, square: ck.StrokeCap.Square }[stroke.cap])
    paint.setStrokeJoin({ miter: ck.StrokeJoin.Miter, round: ck.StrokeJoin.Round, bevel: ck.StrokeJoin.Bevel }[stroke.join])
    paint.setStrokeMiter(stroke.miterLimit)
    if (stroke.dashes.length > 0) {
      // Skia needs dash and gap pairs; an odd list repeats, as in SVG.
      const dash = ck.PathEffect.MakeDash(stroke.dashes.length % 2 === 0 ? [...stroke.dashes] : [...stroke.dashes, ...stroke.dashes], stroke.dashOffset)
      paint.setPathEffect(dash)
      dash.delete()
    }
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
    case 'angular': {
      // Turned about its centre in the unit box, so offset 0 starts at the angle.
      const turn = ck.Matrix.rotated((fill.angle * Math.PI) / 180, fill.center.x, fill.center.y)
      shader = ck.Shader.MakeSweepGradient(
        fill.center.x, fill.center.y, fill.stops.map((s) => color(ck, s.color)), fill.stops.map((s) => s.offset),
        ck.TileMode.Clamp, ck.Matrix.multiply(unitBox, turn),
      )
      break
    }
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
  const { paragraph, dy, done } = laidOut(ck, layer.props, resources)
  canvas.drawParagraph(paragraph, layer.props.x, layer.props.y + dy)
  done()
}

function blendMode(ck: CanvasKit, mode: SceneLayer['props']['blendMode']) {
  const b = ck.BlendMode
  return {
    normal: b.SrcOver, multiply: b.Multiply, screen: b.Screen, overlay: b.Overlay, darken: b.Darken, lighten: b.Lighten,
    'color-dodge': b.ColorDodge, 'color-burn': b.ColorBurn, 'hard-light': b.HardLight, 'soft-light': b.SoftLight,
    difference: b.Difference, exclusion: b.Exclusion, hue: b.Hue, saturation: b.Saturation, color: b.Color, luminosity: b.Luminosity,
    // Only reached when a pass-through group needs its own layer for opacity or effects.
    'pass-through': b.SrcOver,
  }[mode]
}
