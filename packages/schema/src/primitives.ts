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

/**
 * How a group or frame mixes with what is under it (#43). Pass-through, the default, adds no
 * layer of its own: each child mixes with what is under the group as if it weren't grouped.
 * Any other mode first draws the children together, so their own modes mix only with each
 * other, then mixes the result. A pass-through group with opacity or effects is drawn
 * together too, as normal, since its opacity and effects apply to the whole.
 */
export const ContainerBlendMode = z.enum([...BlendMode.options, 'pass-through'])
