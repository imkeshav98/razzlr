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

export const Effect = z.discriminatedUnion('type', [DropShadow, LayerBlur])
export type Effect = z.infer<typeof Effect>
