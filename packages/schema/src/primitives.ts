import { z } from 'zod'

/** Ids are random strings made on the device (21 chars in production; fixtures use short readable ones). */
export const Id = z.string().min(1).max(64).regex(/^[\w-]+$/, 'ids are letters, digits, _ and -')
export const NodeId = Id
export const PageId = Id
export const FormatId = Id
export const AssetId = Id

/** A fractional index: a short string that sorts between its neighbours. */
export const FractionalIndex = z.string().min(1).regex(/^[0-9A-Za-z]+$/, 'fractional indexes are base-62 strings')

/** #RRGGBBAA, upper or lower case. */
export const Color = z.string().regex(/^#[0-9a-fA-F]{8}$/, 'colours are #RRGGBBAA')

export const Point = z.object({ x: z.number(), y: z.number() })

export const BlendMode = z.enum([
  'normal', 'multiply', 'screen', 'overlay', 'darken', 'lighten', 'color-dodge', 'color-burn',
  'hard-light', 'soft-light', 'difference', 'exclusion', 'hue', 'saturation', 'color', 'luminosity',
])
