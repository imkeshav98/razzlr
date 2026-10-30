import { z } from 'zod'
import { AssetId, Color, Point } from './primitives.ts'

const GradientStop = z.object({ offset: z.number().min(0).max(1), color: Color })
const Stops = GradientStop.array().min(2)

export const SolidPaint = z.object({ type: z.literal('solid'), color: Color })

/** Gradient geometry is in the layer's unit box: (0,0) top left, (1,1) bottom right. */
export const LinearPaint = z.object({ type: z.literal('linear'), from: Point, to: Point, stops: Stops })
export const RadialPaint = z.object({
  type: z.literal('radial'),
  center: Point,
  radius: z.number().positive(),
  stops: Stops,
})

/**
 * A conic sweep of colour about `center` (#43): offset 0 starts at `angle` degrees, turning
 * clockwise from pointing right, and the stops go once round to offset 1 back at the start.
 */
export const AngularPaint = z.object({
  type: z.literal('angular'),
  center: Point,
  angle: z.number().default(0),
  stops: Stops,
})

/** A crop is the fill's transform: the visible part of the image, in image pixels. */
export const ImageCrop = z.object({
  x: z.number().min(0),
  y: z.number().min(0),
  width: z.number().positive(),
  height: z.number().positive(),
})
/** How far to push each adjustment of an image fill (#48), from -100 to 100; 0 leaves it as it is. */
const Amount = z.number().min(-100).max(100).default(0)
export const ImageAdjust = z.object({
  /** Brighter or darker, up to a stop either way. */
  exposure: Amount,
  contrast: Amount,
  /** -100 is grey. */
  saturation: Amount,
  /** Warmer (more red, less blue) or cooler. */
  temperature: Amount,
  /** Towards magenta, or towards green. */
  tint: Amount,
})
export type ImageAdjust = z.infer<typeof ImageAdjust>
/** A look laid over an image fill after its adjustments (#48). */
export const ImageFilter = z.enum(['none', 'mono', 'sepia', 'vivid', 'fade', 'warm', 'cool'])
export type ImageFilter = z.infer<typeof ImageFilter>
export const ImagePaint = z.object({
  type: z.literal('image'),
  assetId: AssetId,
  fit: z.enum(['fill', 'fit', 'crop', 'tile']).default('fill'),
  crop: ImageCrop.optional(),
  opacity: z.number().min(0).max(1).default(1),
  adjust: ImageAdjust.optional(),
  filter: ImageFilter.optional(),
})

export const Paint = z.discriminatedUnion('type', [SolidPaint, LinearPaint, RadialPaint, AngularPaint, ImagePaint])
export type Paint = z.infer<typeof Paint>
