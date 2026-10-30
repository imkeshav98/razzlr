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

/** A crop is the fill's transform: the visible part of the image, in image pixels. */
export const ImageCrop = z.object({
  x: z.number().min(0),
  y: z.number().min(0),
  width: z.number().positive(),
  height: z.number().positive(),
})
export const ImagePaint = z.object({
  type: z.literal('image'),
  assetId: AssetId,
  fit: z.enum(['fill', 'fit', 'crop', 'tile']).default('fill'),
  crop: ImageCrop.optional(),
  opacity: z.number().min(0).max(1).default(1),
})

export const Paint = z.discriminatedUnion('type', [SolidPaint, LinearPaint, RadialPaint, ImagePaint])
export type Paint = z.infer<typeof Paint>
