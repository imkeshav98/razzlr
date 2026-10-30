import { Format, FormatId, formatIdOf, formatSizeProblem, Layer, LAYER_PROPS, NodeId, Page, PageId, parseLayer, parseOverrideValues, RunStyle, Scope as FormatScope, type Design } from '@razzlr/schema'
import { generateKeyBetween } from 'fractional-indexing'
import { nanoid } from 'nanoid'
import { z } from 'zod'
import { childrenOf } from './children.ts'
import { defineCommand, type CommandContext } from './command.ts'
import * as Y from 'yjs'
import { DELETED, overrideKey, splitOverrideKey, toYMap, toYNode } from './design-doc.ts'

export { childrenOf }

/**
 * A fractional index between two neighbours that never throws. Neighbours can tie (two tabs
 * inserting at once) or use keys the library rejects (hand-written fixtures such as `a000`);
 * then it falls back to the nearest key it can make, and id order settles any remaining tie.
 */
export function indexBetween(before: string | null, after: string | null): string {
  const attempts: [string | null, string | null][] = [[before, after], [before, null], [null, after], [null, null]]
  for (const [a, b] of attempts) {
    try {
      return generateKeyBetween(a, b)
    } catch {
      // try the next, looser pair
    }
  }
  return 'a0'
}

const topIndex = (design: Design, parentId: string) => indexBetween(childrenOf(design, parentId).at(-1)?.[1].index ?? null, null)

/** Ids of deleted layers stay taken: their tombstones still hold the data an undo brings back. */
const idProblem = ({ r }: CommandContext, id: string | undefined) =>
  id && (r.nodes.has(id) || r.pages.has(id) || r.formats.has(id)) ? `id "${id}" is taken` : undefined

const parentProblem = (design: Design, parentId: string) => {
  const parent = design.nodes[parentId]
  if (!design.pages[parentId] && !parent) return `parent "${parentId}" is neither a page nor a layer`
  if (parent && parent.type !== 'frame' && parent.type !== 'group') return `parent "${parentId}" is a ${parent.type}, which can't hold layers`
  return undefined
}

const LayerInput = z.object({
  type: z.enum(Object.keys(LAYER_PROPS) as [keyof typeof LAYER_PROPS]),
  name: z.string(),
  role: z.string().optional(),
  props: z.record(z.string(), z.unknown()),
})

export const nodeCreate = defineCommand({
  name: 'node.create',
  input: z.object({ id: NodeId.optional(), parentId: z.union([PageId, NodeId]), layer: LayerInput }),
  check: (ctx, { id, parentId, layer }) => {
    const { design } = ctx
    const taken = idProblem(ctx, id)
    if (taken) return taken
    const problem = parentProblem(design, parentId)
    if (problem) return problem
    const parsed = Layer.safeParse({ ...layer, parentId, index: 'a0' })
    if (!parsed.success) return parsed.error.issues.map((i) => `layer.${i.path.join('.')}: ${i.message}`).join('; ')
    return undefined
  },
  apply: ({ r, design }, { id = nanoid(), parentId, layer }) => {
    r.nodes.set(id, toYNode(Layer.parse({ ...layer, parentId, index: topIndex(design, parentId) })))
    return id
  },
})

/** Base scope, or `format:<id>` to change one format only. */
const Scope = z.union([z.literal('base'), FormatScope]).default('base')

export const nodeUpdate = defineCommand({
  name: 'node.update',
  input: z.object({ ids: NodeId.array().min(1), scope: Scope, patch: z.record(z.string(), z.unknown()) }),
  check: ({ design }, { ids, scope, patch }) => {
    // Only the patched layers and their overrides are checked: nothing else changes (#29).
    if (scope !== 'base' && !design.formats[formatIdOf(scope) ?? '']) return `no format "${formatIdOf(scope) ?? scope}"`
    for (const id of ids) {
      const node = design.nodes[id]
      if (!node) return `no layer "${id}"`
      for (const path of Object.keys(patch)) {
        if (!Object.hasOwn(LAYER_PROPS[node.type].shape, path)) return `a ${node.type} has no property "${path}"`
        if (scope === 'base' && node.type === 'text' && (path === 'text' || path === 'runs')) return 'change text with text.edit'
      }
      if (scope !== 'base') {
        const values = parseOverrideValues(scope, node, { ...design.overrides[scope]?.[id], ...patch })
        if (!values.success) return values.errors.map((e) => `${id}.${e}`).join('; ')
        continue
      }
      const layer = parseLayer({ ...node, props: { ...node.props, ...patch } })
      if (!layer.success) return layer.errors.map((e) => `${id}.${e.replace(/^props\./, '')}`).join('; ')
      // A new base value can make an override that merges with it invalid.
      for (const [overrideScope, byNode] of Object.entries(design.overrides)) {
        const values = byNode[id] && parseOverrideValues(overrideScope, layer.layer, byNode[id])
        if (values && !values.success) return values.errors.map((e) => `${id}.${e}`).join('; ')
      }
    }
    return undefined
  },
  apply: ({ r }, { ids, scope, patch }) => {
    for (const id of ids) {
      if (scope === 'base') {
        const props = r.nodes.get(id)?.get('props') as Y.Map<unknown>
        for (const [path, value] of Object.entries(patch)) props.set(path, value)
        continue
      }
      for (const [path, value] of Object.entries(patch)) r.overrides.set(overrideKey(scope, id, path), value)
    }
  },
})

/**
 * Puts layers back to the base in one format: removes their overrides there, every one or only
 * the named property paths. Values the layers don't override are left as they are.
 */
export const overrideReset = defineCommand({
  name: 'override.reset',
  input: z.object({ ids: NodeId.array().min(1), scope: FormatScope, paths: z.string().array().min(1).optional() }),
  check: ({ design }, { ids, scope }) => {
    if (!design.formats[formatIdOf(scope) ?? '']) return `no format "${formatIdOf(scope) ?? scope}"`
    return ids.map((id) => (design.nodes[id] ? undefined : `no layer "${id}"`)).find(Boolean)
  },
  apply: ({ r, design }, { ids, scope, paths }) => {
    for (const id of ids) {
      for (const path of paths ?? Object.keys(design.overrides[scope]?.[id] ?? {})) r.overrides.delete(overrideKey(scope, id, path))
    }
  },
})

const isInside = (design: Design, id: string, maybeAncestor: string) => {
  for (let up: string | undefined = id; up; up = design.nodes[up]?.parentId) if (up === maybeAncestor) return true
  return false
}

export const nodeMove = defineCommand({
  name: 'node.move',
  input: z.object({ id: NodeId, parentId: z.union([PageId, NodeId]), before: NodeId.optional() }),
  check: ({ design }, { id, parentId, before }) => {
    if (!design.nodes[id]) return `no layer "${id}"`
    const problem = parentProblem(design, parentId)
    if (problem) return problem
    if (isInside(design, parentId, id)) return `can't move "${id}" inside itself`
    if (before === id) return `can't place "${id}" before itself`
    if (before && design.nodes[before]?.parentId !== parentId) return `"${before}" is not under "${parentId}"`
    return undefined
  },
  apply: ({ r, design }, { id, parentId, before }) => {
    const siblings = childrenOf(design, parentId).filter(([sibling]) => sibling !== id)
    const at = before ? siblings.findIndex(([sibling]) => sibling === before) : siblings.length
    const index = indexBetween(siblings[at - 1]?.[1].index ?? null, siblings[at]?.[1].index ?? null)
    const node = r.nodes.get(id)
    node?.set('parentId', parentId)
    node?.set('index', index)
  },
})

export const nodeDelete = defineCommand({
  name: 'node.delete',
  input: z.object({ ids: NodeId.array().min(1) }),
  check: ({ design }, { ids }) => ids.map((id) => (design.nodes[id] ? undefined : `no layer "${id}"`)).find(Boolean),
  apply: ({ r, design }, { ids }) => {
    const doomed = new Set<string>()
    const take = (id: string) => {
      if (doomed.has(id)) return
      doomed.add(id)
      for (const [child] of childrenOf(design, id)) take(child)
    }
    for (const id of ids) take(id)
    // A tombstone, not a removal: undo then just clears the flag, and edits another tab makes
    // to the layer meanwhile land in a live map instead of being lost (see DELETED in design-doc.ts).
    for (const id of doomed) r.nodes.get(id)?.set(DELETED, true)
  },
})

const TextOp = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('insert'), at: z.number().int().min(0), text: z.string().min(1) }),
  z.object({ kind: z.literal('delete'), at: z.number().int().min(0), length: z.number().int().positive() }),
  z.object({ kind: z.literal('style'), at: z.number().int().min(0), length: z.number().int().positive(), style: RunStyle }),
])

/** Offsets count UTF-16 units. Inserted text takes the style of the character before it. */
export const textEdit = defineCommand({
  name: 'text.edit',
  input: z.object({ id: NodeId, op: TextOp }),
  check: ({ design }, { id, op }) => {
    const node = design.nodes[id]
    if (!node) return `no layer "${id}"`
    if (node.type !== 'text') return `"${id}" is a ${node.type}, not a text layer`
    const end = op.at + (op.kind === 'insert' ? 0 : op.length)
    if (end > node.props.text.length) return `the range ${op.at}–${end} runs past the end of the text (${node.props.text.length})`
    return undefined
  },
  apply: ({ r }, { id, op }) => {
    const ytext = (r.nodes.get(id)?.get('props') as Y.Map<unknown>).get('text') as Y.Text
    if (op.kind === 'insert') ytext.insert(op.at, op.text)
    else if (op.kind === 'delete') ytext.delete(op.at, op.length)
    else ytext.format(op.at, op.length, op.style)
  },
})

const lastOrder = (entries: { order: string }[]) => entries.map((e) => e.order).sort().at(-1) ?? null

export const pageAdd = defineCommand({
  name: 'page.add',
  input: z.object({ id: PageId.optional(), name: z.string() }),
  check: (ctx, { id }) => idProblem(ctx, id),
  apply: ({ r, design }, { id = nanoid(), name }) => {
    r.pages.set(id, toYMap(Page.parse({ name, order: indexBetween(lastOrder(Object.values(design.pages)), null) })))
    return id
  },
})

const pagesInOrder = (design: Design) =>
  Object.entries(design.pages).sort(([a, x], [b, y]) => (x.order < y.order ? -1 : x.order > y.order ? 1 : a < b ? -1 : 1))

/** Every layer under a page or layer, parents before children. */
function descendants(design: Design, parentId: string): string[] {
  return childrenOf(design, parentId).flatMap(([id]) => [id, ...descendants(design, id)])
}

/** Renames a page. */
export const pageUpdate = defineCommand({
  name: 'page.update',
  input: z.object({ id: PageId, name: z.string() }),
  check: ({ design }, { id }) => (design.pages[id] ? undefined : `no page "${id}"`),
  apply: ({ r }, { id, name }) => {
    r.pages.get(id)?.set('name', name)
  },
})

/**
 * Copies a page right after itself: every layer with a fresh id, and every override those layers
 * have in any format. Returns the new page's id.
 */
export const pageDuplicate = defineCommand({
  name: 'page.duplicate',
  input: z.object({ id: PageId, newId: PageId.optional(), name: z.string().optional() }),
  check: (ctx, { id, newId }) => (ctx.design.pages[id] ? idProblem(ctx, newId) : `no page "${id}"`),
  apply: ({ r, design }, { id, newId = nanoid(), name }) => {
    const page = design.pages[id]
    if (!page) return newId
    const pages = pagesInOrder(design)
    const next = pages[pages.findIndex(([other]) => other === id) + 1]?.[1].order ?? null
    r.pages.set(newId, toYMap(Page.parse({ ...page, name: name ?? page.name, order: indexBetween(page.order, next) })))
    const ids = new Map(descendants(design, id).map((old) => [old, nanoid()] as const))
    for (const [old, fresh] of ids) {
      const node = design.nodes[old]
      if (!node) continue
      r.nodes.set(fresh, toYNode({ ...node, parentId: node.parentId === id ? newId : ids.get(node.parentId) ?? newId }))
      for (const [scope, byNode] of Object.entries(design.overrides)) {
        for (const [path, value] of Object.entries(byNode[old] ?? {})) r.overrides.set(overrideKey(scope, fresh, path), value)
      }
    }
    return newId
  },
})

/** Moves a page ahead of another page, or to the end with null. */
export const pageMove = defineCommand({
  name: 'page.move',
  input: z.object({ id: PageId, before: PageId.nullable() }),
  check: ({ design }, { id, before }) => {
    if (!design.pages[id]) return `no page "${id}"`
    if (before && (before === id || !design.pages[before])) return `no other page "${before}" to go before`
    return undefined
  },
  apply: ({ r, design }, { id, before }) => {
    const others = pagesInOrder(design).filter(([other]) => other !== id)
    const at = before === null ? others.length : others.findIndex(([other]) => other === before)
    r.pages.get(id)?.set('order', indexBetween(others[at - 1]?.[1].order ?? null, others[at]?.[1].order ?? null))
  },
})

/** Deletes a page and its layers; undo brings both back. A design keeps at least one page. */
export const pageDelete = defineCommand({
  name: 'page.delete',
  input: z.object({ id: PageId }),
  check: ({ design }, { id }) => {
    if (!design.pages[id]) return `no page "${id}"`
    if (Object.keys(design.pages).length === 1) return 'a design keeps at least one page'
    return undefined
  },
  apply: ({ r, design }, { id }) => {
    // Layers get the same tombstone node.delete gives them, so undo and other tabs' edits behave alike.
    for (const node of descendants(design, id)) r.nodes.get(node)?.set(DELETED, true)
    r.pages.delete(id)
  },
})

const byOrder = (design: Design) =>
  Object.entries(design.formats).sort(([a, x], [b, y]) => (x.order < y.order ? -1 : x.order > y.order ? 1 : a < b ? -1 : 1))

/**
 * Adds a format. Its layout starts as the primary format's, scaled to fit and centred, written
 * as the new format's overrides; constraints and AI adapt come later (phase 3).
 */
export const formatAdd = defineCommand({
  name: 'format.add',
  input: z.object({ id: FormatId.optional(), name: z.string(), width: Format.shape.width, height: Format.shape.height }),
  check: (ctx, { id, width, height }) => idProblem(ctx, id) ?? formatSizeProblem(width, height),
  apply: ({ r, design }, { id = nanoid(), ...format }) => {
    r.formats.set(id, toYMap({ ...format, order: indexBetween(lastOrder(Object.values(design.formats)), null) }))
    const primaryId = design.meta.primaryFormatId
    const primary = design.formats[primaryId]
    if (!primary) return id
    const scale = Math.min(format.width / primary.width, format.height / primary.height)
    const dx = (format.width - primary.width * scale) / 2
    const dy = (format.height - primary.height * scale) / 2
    const round = (n: number) => Math.round(n * 100) / 100
    const from = design.overrides[`format:${primaryId}`] ?? {}
    for (const [nodeId, node] of Object.entries(design.nodes)) {
      const props = { ...node.props, ...from[nodeId] } as Record<string, unknown> & { x: number; y: number; width: number; height: number }
      const scaled: Record<string, unknown> = {
        x: round(props.x * scale + dx), y: round(props.y * scale + dy), width: round(props.width * scale), height: round(props.height * scale),
      }
      // What the primary format turns or hides, this one does too.
      for (const path of ['rotation', 'visible']) if (from[nodeId]?.[path] !== undefined) scaled[path] = from[nodeId][path]
      for (const [path, value] of Object.entries(scaled)) r.overrides.set(overrideKey(`format:${id}`, nodeId, path), value)
    }
    return id
  },
})

/** Renames, resizes or moves a format; `before` puts it ahead of another format, null at the end. */
export const formatUpdate = defineCommand({
  name: 'format.update',
  input: z.object({
    id: FormatId, name: z.string().optional(), width: Format.shape.width.optional(), height: Format.shape.height.optional(),
    before: FormatId.nullable().optional(),
  }),
  check: ({ design }, { id, width, height, before }) => {
    const format = design.formats[id]
    if (!format) return `no format "${id}"`
    if (before && (before === id || !design.formats[before])) return `no other format "${before}" to go before`
    return width === undefined && height === undefined ? undefined : formatSizeProblem(width ?? format.width, height ?? format.height)
  },
  apply: ({ r, design }, { id, before, ...change }) => {
    const yformat = r.formats.get(id)
    if (!yformat) return
    for (const [key, value] of Object.entries(change)) if (value !== undefined) yformat.set(key, value)
    if (before === undefined) return
    const others = byOrder(design).filter(([other]) => other !== id)
    const at = before === null ? others.length : others.findIndex(([other]) => other === before)
    yformat.set('order', indexBetween(others[at - 1]?.[1].order ?? null, others[at]?.[1].order ?? null))
  },
})

/** Removes a format and every override it holds. The primary format and the last one stay. */
export const formatRemove = defineCommand({
  name: 'format.remove',
  input: z.object({ id: FormatId }),
  check: ({ design }, { id }) => {
    if (!design.formats[id]) return `no format "${id}"`
    if (Object.keys(design.formats).length === 1) return 'a design keeps at least one format'
    if (design.meta.primaryFormatId === id) return 'make another format primary first'
    return undefined
  },
  apply: ({ r }, { id }) => {
    r.formats.delete(id)
    const scope = `format:${id}`
    for (const key of [...r.overrides.keys()]) if (splitOverrideKey(key).scope === scope) r.overrides.delete(key)
  },
})

/** Makes a format the primary one: new formats start from its layout. */
export const formatSetPrimary = defineCommand({
  name: 'format.setPrimary',
  input: z.object({ id: FormatId }),
  check: ({ design }, { id }) => (design.formats[id] ? undefined : `no format "${id}"`),
  apply: ({ r }, { id }) => {
    r.meta.set('primaryFormatId', id)
  },
})

export const COMMANDS = {
  'node.create': nodeCreate,
  'node.update': nodeUpdate,
  'override.reset': overrideReset,
  'node.move': nodeMove,
  'node.delete': nodeDelete,
  'text.edit': textEdit,
  'page.add': pageAdd,
  'page.update': pageUpdate,
  'page.duplicate': pageDuplicate,
  'page.move': pageMove,
  'page.delete': pageDelete,
  'format.add': formatAdd,
  'format.update': formatUpdate,
  'format.remove': formatRemove,
  'format.setPrimary': formatSetPrimary,
} as const
export type CommandName = keyof typeof COMMANDS
