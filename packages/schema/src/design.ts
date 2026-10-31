import { z } from 'zod'
import { canHold, LAYER_PROPS, type LayerType } from './layers.ts'
import { migrateDesign, SCHEMA_VERSION } from './migrate.ts'
import { Paint } from './paint.ts'
import { FormatId, FractionalIndex, NodeId, PageId } from './primitives.ts'

/**
 * What can't be changed about a layer, each on its own (as in Polotno): its position, its size and
 * rotation, its content (text), its style, and whether it can be deleted. Locking a layer on the
 * stage sets all five; a layer whose position is locked can't be picked on the stage.
 */
export const LayerLock = z.object({
  move: z.boolean().default(false),
  resize: z.boolean().default(false),
  content: z.boolean().default(false),
  style: z.boolean().default(false),
  delete: z.boolean().default(false),
})
export type LayerLock = z.infer<typeof LayerLock>
export const LOCK_FLAGS = ['move', 'resize', 'content', 'style', 'delete'] as const satisfies (keyof LayerLock)[]

const nodeBase = {
  parentId: z.union([PageId, NodeId]),
  index: FractionalIndex,
  name: z.string(),
  role: z.enum([
    'headline', 'subhead', 'body', 'price', 'cta', 'logo', 'product', 'person', 'background', 'badge', 'decoration',
  ]).optional(),
  /** Left out while nothing is locked. */
  lock: LayerLock.optional(),
}

const layerOf = <T extends LayerType>(type: T) =>
  z.object({ type: z.literal(type), ...nodeBase, props: LAYER_PROPS[type] })

export const Layer = z.discriminatedUnion('type', [
  layerOf('frame'), layerOf('group'), layerOf('graphic'), layerOf('text'), layerOf('boolean'),
])
export type Layer = z.infer<typeof Layer>

export const Format = z.object({
  name: z.string(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  order: FractionalIndex,
})

/**
 * Sizes a format may take when added or resized (#38): 1:3 to 3:1, a short side of at least
 * 100 px and no side past 8000 px. Designs already holding other sizes still load.
 */
export const FORMAT_LIMITS = { maxRatio: 3, minShortSide: 100, maxSide: 8000 } as const

/** What keeps a size from being a format, for the app to put in its own words. */
export type FormatSizeIssue = 'whole' | 'short' | 'long' | 'ratio'

export function formatSizeIssue(width: number, height: number): FormatSizeIssue | undefined {
  const { maxRatio, minShortSide, maxSide } = FORMAT_LIMITS
  if (!Number.isInteger(width) || !Number.isInteger(height)) return 'whole'
  if (Math.min(width, height) < minShortSide) return 'short'
  if (Math.max(width, height) > maxSide) return 'long'
  if (width > height * maxRatio || height > width * maxRatio) return 'ratio'
  return undefined
}

/** Why a format can't be this size, or undefined when it can. */
export function formatSizeProblem(width: number, height: number): string | undefined {
  const { maxRatio, minShortSide, maxSide } = FORMAT_LIMITS
  const issue = formatSizeIssue(width, height)
  if (!issue) return undefined
  return {
    whole: 'a format is a whole number of pixels',
    short: `a format's short side is at least ${minShortSide} px`,
    long: `a format's sides are at most ${maxSide} px`,
    ratio: `a format runs from 1:${maxRatio} to ${maxRatio}:1`,
  }[issue]
}

/** How formats group when picking one: by the shape of the frame. */
export type FormatShape = 'square' | 'portrait' | 'tall' | 'landscape' | 'wide'
export const FORMAT_SHAPES: readonly FormatShape[] = ['square', 'portrait', 'tall', 'landscape', 'wide']

export function shapeOf(width: number, height: number): FormatShape {
  const ratio = width / height
  if (ratio >= 1.75) return 'wide'
  if (ratio > 1.05) return 'landscape'
  if (ratio >= 0.95) return 'square'
  if (ratio > 0.62) return 'portrait'
  return 'tall'
}

/** The sizes offered when adding a format; the app names them. Each sits inside FORMAT_LIMITS. */
export const FORMAT_PRESETS = [
  { id: 'feed-square', width: 1080, height: 1080 },
  { id: 'square-large', width: 1200, height: 1200 },
  { id: 'feed-portrait', width: 1080, height: 1350 },
  { id: 'pin', width: 1000, height: 1500 },
  { id: 'story', width: 1080, height: 1920 },
  { id: 'half-page', width: 300, height: 600 },
  { id: 'medium-rectangle', width: 300, height: 250 },
  { id: 'large-rectangle', width: 336, height: 280 },
  { id: 'slide-4-3', width: 1024, height: 768 },
  { id: 'link-image', width: 1200, height: 628 },
  { id: 'video-hd', width: 1920, height: 1080 },
  { id: 'header-3-1', width: 1500, height: 500 },
] as const
export type FormatPreset = (typeof FORMAT_PRESETS)[number]

export const Page = z.object({
  name: z.string(),
  order: FractionalIndex,
  /** Paints behind every layer on the page. */
  fills: Paint.array().default([]),
})

export const DesignMeta = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
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

/** Everything in a design but its layers and overrides: small, so always validated whole. */
const DesignHead = z.object({
  meta: DesignMeta,
  formats: z.record(FormatId, Format),
  pages: z.record(PageId, Page),
})

const DesignShape = z.object({
  ...DesignHead.shape,
  nodes: z.record(NodeId, Layer),
  overrides: Overrides.default({}),
})
type DesignShape = z.infer<typeof DesignShape>

type InScope = ReturnType<(typeof LAYER_PROPS)[LayerType]['safeParse']> & {
  /** Overridden paths the layer's type doesn't have. */
  unknownPaths: string[]
}
/** Merged props by layer, then by override object: both are only ever replaced, never changed. */
const inScopeCache = new WeakMap<Layer, WeakMap<object, InScope>>()

/** A layer's props as one format sees them: its own props with that format's overrides on top. */
function propsInScope(node: Layer, overrides: Record<string, unknown>): InScope {
  const byOverrides = inScopeCache.get(node) ?? new WeakMap<object, InScope>()
  inScopeCache.set(node, byOverrides)
  const cached = byOverrides.get(overrides)
  if (cached) return cached
  const schema = LAYER_PROPS[node.type]
  const known = Object.fromEntries(Object.entries(overrides).filter(([path]) => Object.hasOwn(schema.shape, path)))
  const unknownPaths = Object.keys(overrides).filter((path) => !Object.hasOwn(schema.shape, path))
  const merged = Object.assign(schema.safeParse({ ...node.props, ...known }), { unknownPaths })
  byOverrides.set(overrides, merged)
  return merged
}

type Fail = (path: PropertyKey[], message: string) => void

/** The rules about the design's shape: the primary format, pages, parents and cycles. */
function checkStructure(d: Pick<DesignShape, 'meta' | 'formats' | 'pages' | 'nodes'>, fail: Fail) {
  if (!d.formats[d.meta.primaryFormatId]) fail(['meta', 'primaryFormatId'], `no format "${d.meta.primaryFormatId}"`)
  if (Object.keys(d.pages).length === 0) fail(['pages'], 'a design needs a page')

  for (const [id, node] of Object.entries(d.nodes)) {
    if (d.pages[id]) fail(['nodes', id], `"${id}" is both a page and a layer`)
    const parent = d.nodes[node.parentId]
    if (!d.pages[node.parentId] && !parent) {
      fail(['nodes', id, 'parentId'], `parent "${node.parentId}" is neither a page nor a layer`)
    } else if (parent && !canHold(parent.type, node.type)) {
      fail(['nodes', id, 'parentId'], parent.type === 'boolean'
        ? `parent "${node.parentId}" is a boolean, which holds only shapes and booleans`
        : `parent "${node.parentId}" is a ${parent.type}, which can't hold layers`)
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
}

/** One layer's overrides in one scope, against the layer they override. */
function checkOverride(scope: string, nodeId: string, node: Layer | undefined, props: Record<string, unknown>, fail: Fail) {
  if (!node) {
    fail(['overrides', scope, nodeId], `no layer "${nodeId}"`)
    return
  }
  const merged = propsInScope(node, props)
  for (const path of merged.unknownPaths) fail(['overrides', scope, nodeId, path], `a ${node.type} has no property "${path}"`)
  for (const issue of merged.success ? [] : merged.error.issues) {
    fail(['overrides', scope, nodeId, ...issue.path], issue.message)
  }
}

/** The rules no single part can check alone: parents, cycles, and overrides against their layers. */
function checkDesign(d: DesignShape, fail: Fail) {
  checkStructure(d, fail)
  for (const [scope, byNode] of Object.entries(d.overrides)) {
    const formatId = formatIdOf(scope) ?? ''
    if (!d.formats[formatId]) fail(['overrides', scope], `no format "${formatId}"`)
    for (const [nodeId, props] of Object.entries(byNode)) checkOverride(scope, nodeId, d.nodes[nodeId], props, fail)
  }
}

/** Each override object with its defaults filled, by layer and then by the override object. */
const defaultsCache = new WeakMap<Layer, WeakMap<object, Record<string, unknown>>>()

/** One layer's overrides in one scope with the same defaults as base values; unchanged objects come back unchanged. */
function overrideDefaults(node: Layer, props: Record<string, unknown>) {
  const byProps = defaultsCache.get(node) ?? new WeakMap<object, Record<string, unknown>>()
  defaultsCache.set(node, byProps)
  const cached = byProps.get(props)
  if (cached) return cached
  const merged = propsInScope(node, props)
  if (!merged.success) return props
  const parsed = merged.data as Record<string, unknown>
  const filled = deepFreeze(Object.fromEntries(Object.keys(props).map((path) => [path, parsed[path]])))
  // Filled values merge into the same props, so the result can be read again without parsing.
  byProps.set(props, filled)
  byProps.set(filled, filled)
  inScopeCache.get(node)?.set(filled, merged)
  return filled
}

/** Gives override values the same defaults as base values, so a renderer never sees a half-filled paint or effect. */
function withOverrideDefaults(d: DesignShape): DesignShape {
  const overrides = Object.fromEntries(Object.entries(d.overrides).map(([scope, byNode]) => [scope, Object.fromEntries(
    Object.entries(byNode).map(([nodeId, props]) => {
      const node = d.nodes[nodeId]
      return [nodeId, node ? overrideDefaults(node, props) : props]
    }),
  )]))
  return { ...d, overrides }
}

export const Design = DesignShape
  .superRefine((d, ctx) => checkDesign(d, (path, message) => ctx.addIssue({ code: 'custom', path, message })))
  .transform(withOverrideDefaults)
export type Design = z.infer<typeof Design>
export type DesignInput = z.input<typeof Design>

export type ParseResult = { success: true; design: Design } | { success: false; errors: string[] }

/**
 * Validates untrusted JSON as a design, first bringing one saved at an older schema version up
 * to this one (see migrate.ts). Errors read `path: message`.
 */
export function parseDesign(input: unknown): ParseResult {
  const result = Design.safeParse(migrateDesign(input))
  if (result.success) return { success: true, design: result.data }
  return {
    success: false,
    errors: result.error.issues.map((i) => `${i.path.join('.') || '(design)'}: ${i.message}`),
  }
}

/** Freezes an object and everything inside it, so a cached result can be shared safely. */
function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const inner of Object.values(value)) deepFreeze(inner)
  }
  return value
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
/** Validated layers by the object they came from; a validated layer maps to itself. */
const layerCache = new WeakMap<object, Layer>()
const validIds = new Set<string>()
const validScopes = new Set<string>()

type Head = z.infer<typeof DesignHead>
/** Validated heads by their meta object, with the formats and pages they go with; a validated head maps to itself. */
const headCache = new WeakMap<object, { formats: unknown; pages: unknown; head: Head }>()
/** The head and layers of the last design parsed here. */
let last: { head: Head; nodes: Record<string, Layer> } | undefined
/** Each scope as last parsed: the object it came in as, its filled values, and the layers it was checked against. */
type ScopeResult = { input: object; filled: Record<string, Record<string, unknown>>; nodes: Record<string, Layer> }
const lastScopes = new Map<string, ScopeResult>()
/** Checked override values, by their object and by their filled object, with the layer they were checked against. */
const pairCache = new WeakMap<object, { node: Layer; filled: Record<string, unknown> }>()

/** Sets a key without ever touching the prototype, even for a key such as `__proto__`. */
const put = <T>(target: Record<string, T>, key: string, value: T) =>
  Object.defineProperty(target, key, { value, enumerable: true, writable: true, configurable: true })

function parseHead(input: Record<string, unknown>): Head | undefined {
  const cached = isRecord(input.meta) ? headCache.get(input.meta) : undefined
  if (cached && cached.formats === input.formats && cached.pages === input.pages) return cached.head
  const parsed = DesignHead.safeParse(input)
  if (!parsed.success) return undefined
  const head = deepFreeze(parsed.data)
  if (isRecord(input.meta)) headCache.set(input.meta, { formats: input.formats, pages: input.pages, head })
  headCache.set(head.meta, { formats: head.formats, pages: head.pages, head })
  return head
}

/** The ids whose layer differs between two sets of layers, and whether any of them came, went, or changed parent or type. */
function changedLayers(before: Record<string, Layer>, after: Record<string, Layer>) {
  const ids = new Set<string>()
  let structural = false
  for (const id in after) {
    const was = Object.hasOwn(before, id) ? before[id] : undefined
    const now = after[id] as Layer
    if (was === now) continue
    ids.add(id)
    if (!was || was.parentId !== now.parentId || was.type !== now.type) structural = true
  }
  for (const id in before) {
    if (Object.hasOwn(after, id)) continue
    ids.add(id)
    structural = true
  }
  return { ids, structural }
}

/** One layer's override values in one scope, checked and filled, or undefined if they are invalid. */
function parsePair(scope: string, nodeId: string, node: Layer | undefined, props: unknown) {
  const hit = isRecord(props) ? pairCache.get(props) : undefined
  if (hit && hit.node === node) return hit.filled
  if (!node || !isRecord(props)) return undefined
  if (!validIds.has(nodeId)) {
    if (!NodeId.safeParse(nodeId).success) return undefined
    validIds.add(nodeId)
  }
  let failed = false
  checkOverride(scope, nodeId, node, props, () => { failed = true })
  if (failed) return undefined
  const filled = overrideDefaults(node, props)
  pairCache.set(props, { node, filled })
  pairCache.set(filled, { node, filled })
  return filled
}

/** One layer, validated on its own: its type, props and defaults, but not its parent. Frozen. */
export function parseLayer(input: unknown): { success: true; layer: Layer } | { success: false; errors: string[] } {
  const cached = isRecord(input) ? layerCache.get(input) : undefined
  if (cached) return { success: true, layer: cached }
  const parsed = Layer.safeParse(input)
  if (!parsed.success) return { success: false, errors: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`) }
  const layer = deepFreeze(parsed.data)
  if (isRecord(input)) layerCache.set(input, layer)
  layerCache.set(layer, layer)
  return { success: true, layer }
}

/**
 * One layer's override values in one scope, checked against the layer as `parseDesign` checks
 * them and filled with the same defaults. The scope itself is not checked against the formats.
 */
export function parseOverrideValues(
  scope: string, layer: Layer, values: Record<string, unknown>,
): { success: true; values: Record<string, unknown> } | { success: false; errors: string[] } {
  const errors: string[] = []
  checkOverride(scope, '', layer, values, (path, message) => errors.push(`${path.slice(3).join('.')}: ${message}`))
  if (errors.length > 0) return { success: false, errors }
  return { success: true, values: overrideDefaults(layer, values) }
}

/**
 * Checks one scope's overrides and fills their defaults. A scope object seen last time, whose
 * layers didn't change since, comes back as it was; one whose layers changed copies the last
 * result and checks only those layers again.
 */
function parseScope(
  scope: string, byNode: Record<string, unknown>, nodes: Record<string, Layer>, changed: Set<string> | undefined,
): ScopeResult | undefined {
  const prev = lastScopes.get(scope)
  const own = (id: string) => (Object.hasOwn(nodes, id) ? nodes[id] : undefined)
  if (prev && changed && prev.nodes === last?.nodes && (prev.input === byNode || prev.filled === byNode)) {
    const filled = { ...prev.filled }
    for (const id of changed) {
      if (!Object.hasOwn(byNode, id)) continue
      const values = parsePair(scope, id, own(id), byNode[id])
      if (!values) return undefined
      put(filled, id, values)
    }
    return { input: prev.input, filled: changed.size > 0 ? filled : prev.filled, nodes }
  }
  const filled: Record<string, Record<string, unknown>> = {}
  for (const id in byNode) {
    const values = parsePair(scope, id, own(id), byNode[id])
    if (!values) return undefined
    put(filled, id, values)
  }
  return { input: byNode, filled, nodes }
}

/**
 * Validates a design like `parseDesign`, with the same result, but reuses what it validated
 * before for every layer object and override object it has seen: a design read again after one
 * edit only validates what the edit replaced. Inputs must never be changed after being passed in;
 * replace an object instead. Anything invalid goes through `parseDesign` for its exact errors.
 */
export function parseDesignIncrementally(input: unknown): ParseResult {
  if (!isRecord(input) || !isRecord(input.nodes) || !(input.overrides === undefined || isRecord(input.overrides))) return parseDesign(input)
  const head = parseHead(input)
  if (!head) return parseDesign(input)

  const entries: [string, Layer][] = []
  for (const id in input.nodes) {
    const raw = input.nodes[id]
    if (!validIds.has(id)) {
      if (!NodeId.safeParse(id).success) return parseDesign(input)
      validIds.add(id)
    }
    let layer = isRecord(raw) ? layerCache.get(raw) : undefined
    if (!layer) {
      const parsed = Layer.safeParse(raw)
      if (!parsed.success) return parseDesign(input)
      // Frozen: it is shared by every design parsed from this object from now on.
      layer = deepFreeze(parsed.data)
      if (isRecord(raw)) layerCache.set(raw, layer)
      layerCache.set(layer, layer)
    }
    entries.push([id, layer])
  }
  const nodes = Object.fromEntries(entries)

  // Parents and cycles only change when layers come or go, or a layer changes parent or type.
  const changed = last && last.head === head ? changedLayers(last.nodes, nodes) : undefined
  if (!changed || changed.structural) {
    let failed = false
    checkStructure({ ...head, nodes }, () => { failed = true })
    if (failed) return parseDesign(input)
  }

  const results: [string, ScopeResult][] = []
  for (const [scope, byNode] of Object.entries(input.overrides ?? {})) {
    if (!validScopes.has(scope)) {
      if (!Scope.safeParse(scope).success) return parseDesign(input)
      validScopes.add(scope)
    }
    if (!isRecord(byNode) || !head.formats[formatIdOf(scope) ?? '']) return parseDesign(input)
    const result = parseScope(scope, byNode, nodes, changed?.ids)
    if (!result) return parseDesign(input)
    results.push([scope, result])
  }
  last = { head, nodes }
  for (const [scope, result] of results) lastScopes.set(scope, result)
  const overrides = Object.fromEntries(results.map(([scope, result]) => [scope, result.filled]))
  return { success: true, design: { ...head, nodes, overrides } }
}

/** Every asset an image fill of the design names, on pages, layers or format overrides, sorted. */
export function imageAssetIds(design: Design): string[] {
  const ids = new Set<string>()
  const add = (fills: unknown) => {
    if (!Array.isArray(fills)) return
    for (const fill of fills) {
      if (fill && typeof fill === 'object' && (fill as { type?: unknown }).type === 'image') {
        const { assetId } = fill as { assetId?: unknown }
        if (typeof assetId === 'string') ids.add(assetId)
      }
    }
  }
  for (const page of Object.values(design.pages)) add(page.fills)
  for (const node of Object.values(design.nodes)) add((node.props as { fills?: unknown }).fills)
  for (const byNode of Object.values(design.overrides)) {
    for (const values of Object.values(byNode)) add(values.fills)
  }
  return [...ids].sort()
}

/**
 * Every font family the design's text names, in base styles, runs and format overrides, sorted
 * (#50): the families the editor and exports load. Fallback families are not among them.
 */
export function fontFamilies(design: Design): string[] {
  const families = new Set<string>()
  const addStyle = (style: unknown) => {
    const family = style && typeof style === 'object' ? (style as { fontFamily?: unknown }).fontFamily : undefined
    if (typeof family === 'string' && family) families.add(family)
  }
  const addText = (values: { style?: unknown; runs?: unknown }) => {
    addStyle(values.style)
    if (Array.isArray(values.runs)) for (const run of values.runs) addStyle((run as { style?: unknown } | null)?.style)
  }
  for (const node of Object.values(design.nodes)) if (node.type === 'text') addText(node.props)
  for (const byNode of Object.values(design.overrides)) {
    for (const [id, values] of Object.entries(byNode)) if (design.nodes[id]?.type === 'text') addText(values)
  }
  return [...families].sort()
}
