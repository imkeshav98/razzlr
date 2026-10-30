import { z } from 'zod'
import { Effect } from './effects.ts'
import { Paint } from './paint.ts'
import { BlendMode, Color, ContainerBlendMode } from './primitives.ts'

/**
 * Properties every layer has. Any property can be overridden per format (#1); the
 * per-format ones below are also the ones adapt computes for a format that has no value yet.
 */
const commonProps = {
  x: z.number(),
  y: z.number(),
  width: z.number().min(0),
  height: z.number().min(0),
  rotation: z.number().default(0),
  visible: z.boolean().default(true),
  opacity: z.number().min(0).max(1).default(1),
  blendMode: BlendMode.default('normal'),
  effects: Effect.array().default([]),
}

export const PER_FORMAT_PROPS = ['x', 'y', 'width', 'height', 'rotation', 'visible'] as const

export const Stroke = z.object({
  paint: Paint,
  width: z.number().positive(),
  align: z.enum(['inside', 'center', 'outside']).default('center'),
  /**
   * Dash and gap lengths in design pixels, taken in turn and repeated (#43); none is a solid
   * line. An odd number of lengths is taken twice, as in SVG, so dashes and gaps alternate.
   */
  dashes: z.number().min(0).array().refine((d) => d.length === 0 || d.some((n) => n > 0), 'dashes need a length above 0').default([]),
  /** How far into the pattern the dashes start, in design pixels. */
  dashOffset: z.number().default(0),
  /** The ends of open paths and of each dash. */
  cap: z.enum(['butt', 'round', 'square']).default('butt'),
  join: z.enum(['miter', 'round', 'bevel']).default('miter'),
  /** How far a mitred corner may reach, as a multiple of half the stroke width, before it is bevelled. */
  miterLimit: z.number().min(1).default(4),
})

export const Shape = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('rect'), cornerRadius: z.number().min(0).default(0) }),
  z.object({ kind: z.literal('ellipse') }),
  /** SVG path data in the layer's own box; evenodd lets a path have holes. */
  z.object({ kind: z.literal('path'), d: z.string().min(1), fillRule: z.enum(['nonzero', 'evenodd']).default('nonzero') }),
])

export const GraphicProps = z.object({
  ...commonProps,
  shape: Shape,
  fills: Paint.array().default([]),
  strokes: Stroke.array().default([]),
})

export const FrameProps = z.object({
  ...commonProps,
  blendMode: ContainerBlendMode.default('pass-through'),
  clip: z.boolean().default(true),
  fills: Paint.array().default([]),
})

export const GroupProps = z.object({ ...commonProps, blendMode: ContainerBlendMode.default('pass-through') })

const textStyleFields = {
  fontFamily: z.string().min(1),
  fontWeight: z.number().int().min(100).max(900),
  fontStyle: z.enum(['normal', 'italic']),
  fontSize: z.number().positive(),
  color: Color,
  letterSpacing: z.number(),
  /** A multiple of the font size; omitted means the font's own line height. */
  lineHeight: z.number().positive(),
}

/** A text layer's base character style. */
export const TextStyle = z.object({
  ...textStyleFields,
  fontWeight: textStyleFields.fontWeight.default(400),
  fontStyle: textStyleFields.fontStyle.default('normal'),
  letterSpacing: textStyleFields.letterSpacing.default(0),
  lineHeight: textStyleFields.lineHeight.optional(),
})

/** A run's style: only the keys it changes, with no defaults, so the rest come from the base style. */
export const RunStyle = z.object(textStyleFields).partial()

/** Run offsets count UTF-16 code units, as JavaScript strings and Y.Text do. */
export const TextRun = z.object({
  start: z.number().int().min(0),
  end: z.number().int().min(0),
  style: RunStyle,
}).refine((r) => r.end > r.start, 'a run must cover at least one character')

export const TextProps = z.object({
  ...commonProps,
  text: z.string(),
  style: TextStyle,
  runs: TextRun.array().default([]),
  align: z.enum(['start', 'center', 'end', 'justify']).default('start'),
  direction: z.enum(['auto', 'ltr', 'rtl']).default('auto'),
  verticalAlign: z.enum(['top', 'middle', 'bottom']).default('top'),
  boxMode: z.enum(['autoWidth', 'autoHeight', 'fixed']).default('autoHeight'),
}).superRefine((t, ctx) => {
  for (const [i, run] of t.runs.entries()) {
    if (run.end > t.text.length) {
      ctx.addIssue({ code: 'custom', path: ['runs', i, 'end'], message: `run ends at ${run.end} but the text is ${t.text.length} UTF-16 units long` })
    }
  }
})

/** The layer types in the spike: four of the seven in ADR-0006 (#1 leaves boolean, instance and lottie for later). */
export const LAYER_PROPS = {
  frame: FrameProps,
  group: GroupProps,
  graphic: GraphicProps,
  text: TextProps,
} as const
export type LayerType = keyof typeof LAYER_PROPS
