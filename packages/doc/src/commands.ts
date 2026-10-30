import { Format, FormatId, Layer, LAYER_PROPS, NodeId, Page, PageId, parseDesign, RunStyle, type Design } from '@razzlr/schema'
import { generateKeyBetween } from 'fractional-indexing'
import { nanoid } from 'nanoid'
import { z } from 'zod'
import { defineCommand } from './command.ts'
import * as Y from 'yjs'
import { DELETED, toYMap, toYNode } from './design-doc.ts'

/** The layers directly under a page or layer, back to front. Ties in index break by id, the same on every device. */
export function childrenOf(design: Design, parentId: string) {
  return Object.entries(design.nodes)
    .filter(([, n]) => n.parentId === parentId)
    .sort(([a, x], [b, y]) => (x.index < y.index ? -1 : x.index > y.index ? 1 : a < b ? -1 : 1))
}

const topIndex = (design: Design, parentId: string) => generateKeyBetween(childrenOf(design, parentId).at(-1)?.[1].index ?? null, null)

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
  check: ({ design }, { id, parentId, layer }) => {
    if (id && (design.nodes[id] || design.pages[id])) return `id "${id}" is taken`
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

/** Turns `nodes.box.props.opacity: …` into `box.opacity: …` for command errors. */
const shortErrors = (errors: string[]) => errors.map((e) => e.replace(/^nodes\.([\w-]+)\.props\./, '$1.').replace(/^overrides\.[^.]+\.([\w-]+)\./, '$1.')).join('; ')

/** Base scope, or `format:<id>` to change one format only. */
const Scope = z.union([z.literal('base'), z.string().regex(/^format:[\w-]+$/)]).default('base')

export const nodeUpdate = defineCommand({
  name: 'node.update',
  input: z.object({ ids: NodeId.array().min(1), scope: Scope, patch: z.record(z.string(), z.unknown()) }),
  check: ({ design }, { ids, scope, patch }) => {
    const candidate = structuredClone(design) as Design & { overrides: Record<string, Record<string, Record<string, unknown>>> }
    for (const id of ids) {
      const node = candidate.nodes[id]
      if (!node) return `no layer "${id}"`
      for (const path of Object.keys(patch)) {
        if (!(path in LAYER_PROPS[node.type].shape)) return `a ${node.type} has no property "${path}"`
        if (scope === 'base' && node.type === 'text' && (path === 'text' || path === 'runs')) return 'change text with text.edit'
      }
      if (scope === 'base') Object.assign(node.props, patch)
      else {
        const byNode = (candidate.overrides[scope] ??= {})
        byNode[id] = { ...byNode[id], ...patch }
      }
    }
    const result = parseDesign(candidate)
    return result.success ? undefined : shortErrors(result.errors)
  },
  apply: ({ r }, { ids, scope, patch }) => {
    for (const id of ids) {
      if (scope === 'base') {
        const props = r.nodes.get(id)?.get('props') as Y.Map<unknown>
        for (const [path, value] of Object.entries(patch)) props.set(path, value)
        continue
      }
      let byNode = r.overrides.get(scope)
      if (!byNode) r.overrides.set(scope, (byNode = new Y.Map()))
      let props = byNode.get(id)
      if (!props) byNode.set(id, (props = new Y.Map()))
      for (const [path, value] of Object.entries(patch)) props.set(path, value)
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
    if (before && design.nodes[before]?.parentId !== parentId) return `"${before}" is not under "${parentId}"`
    return undefined
  },
  apply: ({ r, design }, { id, parentId, before }) => {
    const siblings = childrenOf(design, parentId).filter(([sibling]) => sibling !== id)
    const at = before ? siblings.findIndex(([sibling]) => sibling === before) : siblings.length
    const index = generateKeyBetween(siblings[at - 1]?.[1].index ?? null, siblings[at]?.[1].index ?? null)
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
    const doomed = new Set(Object.keys(design.nodes).filter((n) => ids.some((id) => isInside(design, n, id))))
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
  check: ({ design }, { id }) => (id && (design.pages[id] || design.nodes[id]) ? `id "${id}" is taken` : undefined),
  apply: ({ r, design }, { id = nanoid(), name }) => {
    r.pages.set(id, toYMap(Page.parse({ name, order: generateKeyBetween(lastOrder(Object.values(design.pages)), null) })))
    return id
  },
})

export const formatAdd = defineCommand({
  name: 'format.add',
  input: z.object({ id: FormatId.optional(), name: z.string(), width: Format.shape.width, height: Format.shape.height }),
  check: ({ design }, { id }) => (id && design.formats[id] ? `id "${id}" is taken` : undefined),
  apply: ({ r, design }, { id = nanoid(), ...format }) => {
    r.formats.set(id, toYMap({ ...format, order: generateKeyBetween(lastOrder(Object.values(design.formats)), null) }))
    return id
  },
})

export const COMMANDS = {
  'node.create': nodeCreate,
  'node.update': nodeUpdate,
  'node.move': nodeMove,
  'node.delete': nodeDelete,
  'text.edit': textEdit,
  'page.add': pageAdd,
  'format.add': formatAdd,
} as const
export type CommandName = keyof typeof COMMANDS
