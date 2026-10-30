import { z } from 'zod'
import { LAYER_PROPS, type LayerType } from './layers.ts'
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

const layerOf = <T extends LayerType>(type: T) =>
  z.object({ type: z.literal(type), ...nodeBase, props: LAYER_PROPS[type] })

export const Layer = z.discriminatedUnion('type', [
  layerOf('frame'), layerOf('group'), layerOf('graphic'), layerOf('text'),
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
  /** Paints behind every layer on the page. */
  fills: Paint.array().default([]),
})

export const DesignMeta = z.object({
  schemaVersion: z.literal(1),
  designId: z.string().min(1),
  name: z.string(),
  kind: z.enum(['single', 'carousel', 'story', 'document']),
  primaryFormatId: FormatId,
})

/** Spike scopes: only `format:<id>`. Variant and page scopes arrive with variants and masters. */
const FORMAT_SCOPE = /^format:([\w-]+)$/
/** The format a `format:<id>` scope names, or undefined for any other string. */
export const formatIdOf = (scope: string) => scope.match(FORMAT_SCOPE)?.[1]
export const Scope = z.string().refine((s) => formatIdOf(s) !== undefined, 'the spike only supports format:<id> scopes')

/** overrides[scope][nodeId][propertyPath] = value. Any property can be overridden per format. */
const Overrides = z.record(Scope, z.record(NodeId, z.record(z.string(), z.unknown())))

const DesignShape = z.object({
  meta: DesignMeta,
  formats: z.record(FormatId, Format),
  pages: z.record(PageId, Page),
  nodes: z.record(NodeId, Layer),
  overrides: Overrides.default({}),
})
type DesignShape = z.infer<typeof DesignShape>

/** A layer's props as one format sees them: its own props with that format's overrides on top. */
function propsInScope(node: Layer, overrides: Record<string, unknown>) {
  const schema = LAYER_PROPS[node.type]
  const known = Object.fromEntries(Object.entries(overrides).filter(([path]) => Object.hasOwn(schema.shape, path)))
  return schema.safeParse({ ...node.props, ...known })
}

function checkDesign(d: DesignShape, ctx: z.RefinementCtx) {
  const fail = (path: PropertyKey[], message: string) => ctx.addIssue({ code: 'custom', path, message })

  if (!d.formats[d.meta.primaryFormatId]) fail(['meta', 'primaryFormatId'], `no format "${d.meta.primaryFormatId}"`)
  if (Object.keys(d.pages).length === 0) fail(['pages'], 'a design needs a page')

  for (const [id, node] of Object.entries(d.nodes)) {
    if (d.pages[id]) fail(['nodes', id], `"${id}" is both a page and a layer`)
    const parent = d.nodes[node.parentId]
    if (!d.pages[node.parentId] && !parent) {
      fail(['nodes', id, 'parentId'], `parent "${node.parentId}" is neither a page nor a layer`)
    } else if (parent && parent.type !== 'frame' && parent.type !== 'group') {
      fail(['nodes', id, 'parentId'], `parent "${node.parentId}" is a ${parent.type}, which can't hold layers`)
    }
    // Walk up towards the page. Reaching this layer again means it is inside itself; reaching
    // another repeat means a cycle above it, which is reported for the layers in that cycle.
    const seen = new Set<string>()
    for (let up = node.parentId; d.nodes[up] && !seen.has(up); up = d.nodes[up]?.parentId ?? '') {
      if (up === id) {
        fail(['nodes', id, 'parentId'], `"${id}" is inside itself`)
        break
      }
      seen.add(up)
    }
  }

  for (const [scope, byNode] of Object.entries(d.overrides)) {
    const formatId = formatIdOf(scope) ?? ''
    if (!d.formats[formatId]) fail(['overrides', scope], `no format "${formatId}"`)
    for (const [nodeId, props] of Object.entries(byNode)) {
      const node = d.nodes[nodeId]
      if (!node) {
        fail(['overrides', scope, nodeId], `no layer "${nodeId}"`)
        continue
      }
      for (const path of Object.keys(props)) {
        if (!Object.hasOwn(LAYER_PROPS[node.type].shape, path)) fail(['overrides', scope, nodeId, path], `a ${node.type} has no property "${path}"`)
      }
      const merged = propsInScope(node, props)
      for (const issue of merged.success ? [] : merged.error.issues) {
        fail(['overrides', scope, nodeId, ...issue.path], issue.message)
      }
    }
  }
}

/** Gives override values the same defaults as base values, so a renderer never sees a half-filled paint or effect. */
function withOverrideDefaults(d: DesignShape): DesignShape {
  const overrides = Object.fromEntries(Object.entries(d.overrides).map(([scope, byNode]) => [scope, Object.fromEntries(
    Object.entries(byNode).map(([nodeId, props]) => {
      const node = d.nodes[nodeId]
      const merged = node && propsInScope(node, props)
      if (!merged?.success) return [nodeId, props]
      const parsed = merged.data as Record<string, unknown>
      return [nodeId, Object.fromEntries(Object.keys(props).map((path) => [path, parsed[path]]))]
    }),
  )]))
  return { ...d, overrides }
}

export const Design = DesignShape.superRefine(checkDesign).transform(withOverrideDefaults)
export type Design = z.infer<typeof Design>
export type DesignInput = z.input<typeof Design>

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
