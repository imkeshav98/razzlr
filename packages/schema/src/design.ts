import { z } from 'zod'
import { LAYER_PROPS, PER_FORMAT_PROPS } from './layers.ts'
import { Paint } from './paint.ts'
import { FormatId, FractionalIndex, NodeId, PageId } from './primitives.ts'

const nodeBase = {
  parentId: z.union([PageId, NodeId]),
  index: FractionalIndex,
  name: z.string(),
  role: z.enum([
    'headline', 'subhead', 'body', 'price', 'cta', 'logo', 'product', 'person', 'background', 'badge', 'decoration',
  ]).optional(),
}

export const Layer = z.discriminatedUnion('type', [
  z.object({ type: z.literal('frame'), ...nodeBase, props: LAYER_PROPS.frame }),
  z.object({ type: z.literal('group'), ...nodeBase, props: LAYER_PROPS.group }),
  z.object({ type: z.literal('graphic'), ...nodeBase, props: LAYER_PROPS.graphic }),
  z.object({ type: z.literal('text'), ...nodeBase, props: LAYER_PROPS.text }),
])
export type Layer = z.infer<typeof Layer>

export const Format = z.object({
  name: z.string(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  order: FractionalIndex,
})

export const Page = z.object({
  name: z.string(),
  order: FractionalIndex,
  background: Paint.array().default([]),
})

export const DesignMeta = z.object({
  schemaVersion: z.literal(1),
  designId: z.string().min(1),
  name: z.string(),
  kind: z.enum(['single', 'carousel', 'story', 'document']),
  primaryFormatId: FormatId,
})

/** Spike scopes: only `format:<id>`. Variant and page scopes arrive with variants and masters. */
const FormatScope = z.string().regex(/^format:[\w-]+$/, 'the spike only supports format:<id> scopes')

/** overrides[scope][nodeId][propertyPath] = value */
const Overrides = z.record(FormatScope, z.record(NodeId, z.record(z.string(), z.unknown())))

const DesignShape = z.object({
  meta: DesignMeta,
  formats: z.record(FormatId, Format),
  pages: z.record(PageId, Page),
  nodes: z.record(NodeId, Layer),
  overrides: Overrides.default({}),
})

export const Design = DesignShape.superRefine((d, ctx) => {
  if (!d.formats[d.meta.primaryFormatId]) {
    ctx.addIssue({ code: 'custom', path: ['meta', 'primaryFormatId'], message: `no format "${d.meta.primaryFormatId}"` })
  }
  if (Object.keys(d.pages).length === 0) ctx.addIssue({ code: 'custom', path: ['pages'], message: 'a design needs a page' })

  for (const id of Object.keys(d.nodes)) {
    if (d.pages[id]) ctx.addIssue({ code: 'custom', path: ['nodes', id], message: `"${id}" is both a page and a layer` })
  }
  for (const [id, node] of Object.entries(d.nodes)) {
    const parent = d.nodes[node.parentId]
    if (!d.pages[node.parentId] && !parent) {
      ctx.addIssue({ code: 'custom', path: ['nodes', id, 'parentId'], message: `parent "${node.parentId}" is neither a page nor a layer` })
    } else if (parent && parent.type !== 'frame' && parent.type !== 'group') {
      ctx.addIssue({ code: 'custom', path: ['nodes', id, 'parentId'], message: `parent "${node.parentId}" is a ${parent.type}, which can't hold layers` })
    }
    // Walk up to a page; meeting a layer twice means a cycle.
    const seen = new Set<string>([id])
    for (let up = d.nodes[node.parentId]; up; up = d.nodes[up.parentId]) {
      if (seen.has(up.parentId)) {
        ctx.addIssue({ code: 'custom', path: ['nodes', id, 'parentId'], message: `"${id}" is inside itself` })
        break
      }
      seen.add(up.parentId)
    }
  }

  for (const [scope, byNode] of Object.entries(d.overrides)) {
    const formatId = scope.slice('format:'.length)
    if (!d.formats[formatId]) ctx.addIssue({ code: 'custom', path: ['overrides', scope], message: `no format "${formatId}"` })
    for (const [nodeId, props] of Object.entries(byNode)) {
      const node = d.nodes[nodeId]
      if (!node) {
        ctx.addIssue({ code: 'custom', path: ['overrides', scope, nodeId], message: `no layer "${nodeId}"` })
        continue
      }
      const shape: Record<string, z.ZodType> = LAYER_PROPS[node.type].shape
      for (const [path, value] of Object.entries(props)) {
        const propSchema = shape[path]
        if (!propSchema) {
          ctx.addIssue({ code: 'custom', path: ['overrides', scope, nodeId, path], message: `a ${node.type} has no property "${path}"` })
          continue
        }
        const parsed = propSchema.safeParse(value)
        if (!parsed.success) {
          ctx.addIssue({ code: 'custom', path: ['overrides', scope, nodeId, path], message: parsed.error.issues[0]?.message ?? 'invalid value' })
        }
      }
    }
  }
})
export type Design = z.infer<typeof Design>
export type DesignInput = z.input<typeof Design>

export { PER_FORMAT_PROPS }

export type ParseResult = { success: true; design: Design } | { success: false; errors: string[] }

/** Validates untrusted JSON as a design. Errors read `path: message`. */
export function parseDesign(input: unknown): ParseResult {
  const result = Design.safeParse(input)
  if (result.success) return { success: true, design: result.data }
  return {
    success: false,
    errors: result.error.issues.map((i) => `${i.path.join('.') || '(design)'}: ${i.message}`),
  }
}
