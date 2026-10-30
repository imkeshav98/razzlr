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

/** What the end of a line looks like (#44). */
export const LineEnd = z.enum(['none', 'arrow', 'triangle', 'circle'])

const Radius = z.number().min(0)

export const Shape = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('rect'),
    cornerRadius: Radius.default(0),
    /** Each corner's own radius, from the top left clockwise (#44); when set, `cornerRadius` is unused. */
    corners: z.tuple([Radius, Radius, Radius, Radius]).optional(),
  }),
  z.object({ kind: z.literal('ellipse') }),
  /** A regular polygon in the layer's box, its first corner at the top centre (#44). */
  z.object({ kind: z.literal('polygon'), sides: z.number().int().min(3).max(100).default(5), cornerRadius: Radius.default(0) }),
  /**
   * A star in the layer's box, its first point at the top centre (#44). Its inner corners sit at
   * `innerRadius` of the way out, as a share of the box.
   */
  z.object({
    kind: z.literal('star'),
    points: z.number().int().min(3).max(100).default(5),
    innerRadius: z.number().min(0).max(1).default(0.382),
    cornerRadius: Radius.default(0),
  }),
  /**
   * A straight line across the middle of the layer's box, from its start edge to its end edge,
   * drawn by the layer's strokes; rotation turns it (#44). The ends take the first stroke's size.
   */
  z.object({ kind: z.literal('line'), start: LineEnd.default('none'), end: LineEnd.default('none') }),
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

/** How a boolean layer combines its shapes, in order: the first with each of the others (#44). */
export const BooleanOp = z.enum(['union', 'subtract', 'intersect', 'exclude'])

/**
 * A live boolean of the shapes inside it (#44): their outlines combined by `op` and painted with
 * the boolean's own fills and strokes. The shapes keep their own properties, so they can still be
 * moved and edited; their paints don't show.
 */
export const BooleanProps = z.object({
  ...commonProps,
  op: BooleanOp.default('union'),
  fills: Paint.array().default([]),
  strokes: Stroke.array().default([]),
})

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

/** Five of the seven layer types in ADR-0006: boolean arrived with #44; instance and lottie come later. */
export const LAYER_PROPS = {
  frame: FrameProps,
  group: GroupProps,
  graphic: GraphicProps,
  text: TextProps,
  boolean: BooleanProps,
} as const

/** Layer types that hold other layers, and which types each can hold. */
export const CONTAINERS = {
  frame: ['frame', 'group', 'graphic', 'text', 'boolean'],
  group: ['frame', 'group', 'graphic', 'text', 'boolean'],
  boolean: ['graphic', 'boolean'],
} as const satisfies Partial<Record<LayerType, readonly LayerType[]>>

/** Whether a layer of type `parent` can hold one of type `child`. */
export const canHold = (parent: string, child: string) =>
  Object.hasOwn(CONTAINERS, parent) && (CONTAINERS[parent as keyof typeof CONTAINERS] as readonly string[]).includes(child)
/** Whether a layer of this type holds other layers. */
export const isContainer = (type: string) => Object.hasOwn(CONTAINERS, type)
export type LayerType = keyof typeof LAYER_PROPS
