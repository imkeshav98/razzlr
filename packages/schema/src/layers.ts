import { z } from 'zod'
import { Effect } from './effects.ts'
import { Paint } from './paint.ts'
import { BlendMode, Color } from './primitives.ts'

/**
 * Properties every layer has. Per-format properties (box, rotation, visible) can be
 * overridden per format; shared ones only change everywhere at once (proposal 2).
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
  clip: z.boolean().default(true),
  fills: Paint.array().default([]),
})

export const GroupProps = z.object(commonProps)

/** Character styles. A run with no value for a key inherits the text layer's base style. */
export const TextStyle = z.object({
  fontFamily: z.string().min(1),
  fontWeight: z.number().int().min(100).max(900).default(400),
  fontStyle: z.enum(['normal', 'italic']).default('normal'),
  fontSize: z.number().positive(),
  color: Color,
  letterSpacing: z.number().default(0),
  /** A multiple of the font size; omitted means the font's own line height. */
  lineHeight: z.number().positive().optional(),
})

export const TextRun = z.object({
  start: z.number().int().min(0),
  end: z.number().int().min(0),
  style: TextStyle.partial(),
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
      ctx.addIssue({ code: 'custom', path: ['runs', i, 'end'], message: `run ends at ${run.end} but the text has ${t.text.length} characters` })
    }
  }
})

/** The layer types in the spike: four of the seven in proposal 2. */
export const LAYER_PROPS = {
  frame: FrameProps,
  group: GroupProps,
  graphic: GraphicProps,
  text: TextProps,
} as const
export type LayerType = keyof typeof LAYER_PROPS
