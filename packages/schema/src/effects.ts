import { z } from 'zod'
import { Color } from './primitives.ts'

export const DropShadow = z.object({
  type: z.literal('dropShadow'),
  x: z.number(),
  y: z.number(),
  blur: z.number().min(0),
  spread: z.number().default(0),
  color: Color,
})
export const LayerBlur = z.object({ type: z.literal('layerBlur'), radius: z.number().min(0) })

/** A shadow inside the layer's edges, as if the layer were cut out of a surface the light falls on. Spread pushes it further in. (#43) */
export const InnerShadow = z.object({
  type: z.literal('innerShadow'),
  x: z.number(),
  y: z.number(),
  blur: z.number().min(0),
  spread: z.number().min(0).default(0),
  color: Color,
})
/** A coloured haze around the layer's edges: a shadow that falls evenly on every side. (#43) */
export const Glow = z.object({
  type: z.literal('glow'),
  blur: z.number().min(0),
  spread: z.number().min(0).default(0),
  color: Color,
})
/** Blurs what is behind the layer, inside its outline, as frosted glass does. (#43) */
export const BackgroundBlur = z.object({ type: z.literal('backgroundBlur'), radius: z.number().min(0) })

export const Effect = z.discriminatedUnion('type', [DropShadow, InnerShadow, Glow, LayerBlur, BackgroundBlur])
export type Effect = z.infer<typeof Effect>
