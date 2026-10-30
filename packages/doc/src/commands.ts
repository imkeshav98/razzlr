import { BooleanOp, canHold, Format, FormatId, formatIdOf, formatSizeProblem, Layer, LAYER_PROPS, LayerLock, LOCK_FLAGS, type Layer as LayerT, NodeId, Page, PageId, parseLayer, parseOverrideValues, RunStyle, Scope as FormatScope, type Design } from '@razzlr/schema'
import { generateKeyBetween } from 'fractional-indexing'
import { nanoid } from 'nanoid'
import { z } from 'zod'
import { childrenOf } from './children.ts'
import { defineCommand, type CommandContext } from './command.ts'
import * as Y from 'yjs'
import { DELETED, overrideKey, splitOverrideKey, toYMap, toYNode } from './design-doc.ts'
import { boundsOf, centreOf, normalAngle, round, turn } from './geometry.ts'
import { inferLayout } from './infer-layout.ts'
import { Placement } from './placement.ts'

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

const parentProblem = (design: Design, parentId: string, type: string) => {
  const parent = design.nodes[parentId]
  if (!design.pages[parentId] && !parent) return `parent "${parentId}" is neither a page nor a layer`
  if (parent && !canHold(parent.type, type)) {
    return parent.type === 'boolean'
      ? `parent "${parentId}" is a boolean, which holds only shapes and booleans`
      : `parent "${parentId}" is a ${parent.type}, which can't hold layers`
  }
  return undefined
}

/** The lock flag a change to a property needs clear: position, size and rotation, content or style. */
export function lockFor(path: string): keyof LayerLock | null {
  if (path === 'x' || path === 'y') return 'move'
  if (path === 'width' || path === 'height' || path === 'rotation') return 'resize'
  if (path === 'visible') return null
  if (path === 'text' || path === 'runs') return 'content'
  return 'style'
}

const lockProblem = (id: string, node: LayerT, flag: keyof LayerLock | null) =>
  flag && node.lock?.[flag] ? `"${id}" is locked (${flag})` : undefined

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
    const problem = parentProblem(design, parentId, layer.type)
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
        const locked = lockProblem(id, node, lockFor(path))
        if (locked) return locked
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
    const node = design.nodes[id]
    if (!node) return `no layer "${id}"`
    const problem = parentProblem(design, parentId, node.type)
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
  check: ({ design }, { ids }) => {
    for (const id of ids) {
      const node = design.nodes[id]
      if (!node) return `no layer "${id}"`
      const locked = [id, ...descendants(design, id)].map((inner) => lockProblem(inner, design.nodes[inner] as LayerT, 'delete')).find(Boolean)
      if (locked) return locked
    }
    return undefined
  },
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

/** Sets some of layers' lock flags, keeping the others; a layer with nothing locked loses the field. */
export const nodeLock = defineCommand({
  name: 'node.lock',
  input: z.object({ ids: NodeId.array().min(1), lock: z.object(Object.fromEntries(LOCK_FLAGS.map((flag) => [flag, z.boolean().optional()]))) }),
  check: ({ design }, { ids }) => ids.map((id) => (design.nodes[id] ? undefined : `no layer "${id}"`)).find(Boolean),
  apply: ({ r, design }, { ids, lock }) => {
    for (const id of ids) {
      const next = LayerLock.parse({ ...design.nodes[id]?.lock, ...lock })
      if (LOCK_FLAGS.some((flag) => next[flag])) r.nodes.get(id)?.set('lock', next)
      else r.nodes.get(id)?.delete('lock')
    }
  },
})

/** Each sibling list after a z-order change, as ids bottom to top. */
function restack(order: string[], moving: Set<string>, to: 'forward' | 'backward' | 'front' | 'back') {
  if (to === 'front') return [...order.filter((id) => !moving.has(id)), ...order.filter((id) => moving.has(id))]
  if (to === 'back') return [...order.filter((id) => moving.has(id)), ...order.filter((id) => !moving.has(id))]
  const next = [...order]
  // One step past the nearest sibling that isn't moving; a moving block keeps its own order.
  const up = to === 'forward'
  for (let i = up ? next.length - 2 : 1; up ? i >= 0 : i < next.length; i += up ? -1 : 1) {
    const id = next[i] as string
    const j = up ? i + 1 : i - 1
    if (!moving.has(id) || moving.has(next[j] as string)) continue
    next[i] = next[j] as string
    next[j] = id
  }
  return next
}

/**
 * Brings layers forward or back one step, or to the front or back, among their siblings. Only the
 * moved layers get new indexes, so a concurrent change to the others merges.
 */
export const nodeReorder = defineCommand({
  name: 'node.reorder',
  input: z.object({ ids: NodeId.array().min(1), to: z.enum(['forward', 'backward', 'front', 'back']) }),
  check: ({ design }, { ids }) => ids.map((id) => (design.nodes[id] ? undefined : `no layer "${id}"`)).find(Boolean),
  apply: ({ r, design }, { ids, to }) => {
    const moving = new Set(ids)
    const parents = new Set(ids.map((id) => design.nodes[id]?.parentId as string))
    for (const parentId of parents) {
      const before = childrenOf(design, parentId)
      const indexOf = new Map(before.map(([id, node]) => [id, node.index]))
      const after = restack(before.map(([id]) => id), moving, to)
      // Runs of moved layers get indexes between the unmoved neighbours around them, unless the
      // ones they have already sit in order there.
      for (let i = 0; i < after.length; i++) {
        if (!moving.has(after[i] as string)) continue
        let end = i
        while (end + 1 < after.length && moving.has(after[end + 1] as string)) end++
        const run = after.slice(i, end + 1)
        const low = i > 0 ? indexOf.get(after[i - 1] as string) ?? null : null
        const high = end + 1 < after.length ? indexOf.get(after[end + 1] as string) ?? null : null
        const current = run.map((id) => indexOf.get(id) as string)
        const fits = current.every((index, k) => (k === 0 ? low === null || index > low : index > (current[k - 1] as string)))
          && (high === null || (current.at(-1) as string) < high)
        if (!fits) {
          let at = low
          for (const id of run) {
            at = indexBetween(at, high)
            indexOf.set(id, at)
            r.nodes.get(id)?.set('index', at)
          }
        }
        i = end
      }
    }
  },
})

/**
 * Copies layers with fresh ids, each with every layer under it and their overrides in every
 * format; `place` says where each copied root goes. Returns the old id to new id map.
 */
function copyLayers(r: CommandContext['r'], design: Design, roots: string[], place: (root: string) => { parentId: string; index: string }) {
  const ids = new Map<string, string>()
  for (const root of roots) for (const old of [root, ...descendants(design, root)]) ids.set(old, nanoid())
  for (const [old, fresh] of ids) {
    const node = design.nodes[old]
    if (!node) continue
    const placed = roots.includes(old) ? place(old) : { parentId: ids.get(node.parentId) ?? node.parentId, index: node.index }
    r.nodes.set(fresh, toYNode({ ...node, ...placed }))
    for (const [scope, byNode] of Object.entries(design.overrides)) {
      for (const [path, value] of Object.entries(byNode[old] ?? {})) r.overrides.set(overrideKey(scope, fresh, path), value)
    }
  }
  return ids
}

/** Copies layers in place, each right above its original. Returns the copies' ids, in order. */
export const nodeDuplicate = defineCommand({
  name: 'node.duplicate',
  input: z.object({ ids: NodeId.array().min(1) }),
  check: ({ design }, { ids }) => ids.map((id) => (design.nodes[id] ? undefined : `no layer "${id}"`)).find(Boolean),
  apply: ({ r, design }, { ids }) => {
    // A layer inside another one being copied comes along with it.
    const roots = ids.filter((id) => !ids.some((other) => other !== id && isInside(design, id, other)))
    const copies = copyLayers(r, design, roots, (root) => {
      const node = design.nodes[root] as LayerT
      const siblings = childrenOf(design, node.parentId)
      const next = siblings[siblings.findIndex(([id]) => id === root) + 1]?.[1].index ?? null
      return { parentId: node.parentId, index: indexBetween(node.index, next) }
    })
    return roots.map((root) => copies.get(root) as string)
  },
})

const depthOf = (design: Design, id: string) => {
  let depth = 0
  for (let up = design.nodes[id]?.parentId; up && design.nodes[up]; up = design.nodes[up]?.parentId) depth++
  return depth
}

/** What wrapping layers in a new group or boolean checks: they exist, share a parent, and the parent can hold the wrapper. */
function wrapProblem(ctx: CommandContext, ids: string[], id: string | undefined, type: 'group' | 'boolean') {
  const { design } = ctx
  const missing = ids.map((layer) => (design.nodes[layer] ? undefined : `no layer "${layer}"`)).find(Boolean)
  if (missing) return missing
  if (new Set(ids.map((layer) => design.nodes[layer]?.parentId)).size > 1) return `layers to ${type === 'group' ? 'group' : 'combine'} must share a parent`
  const parentId = design.nodes[ids[0] as string]?.parentId as string
  return parentProblem(design, parentId, type) ?? idProblem(ctx, id)
}

/**
 * Puts layers that share a parent inside a new layer of `type` where the topmost of them was,
 * without moving anything on screen: its box hugs them in each format.
 */
function wrap({ r, design }: CommandContext, ids: string[], id: string, layer: { type: 'group' | 'boolean'; name: string; props?: Record<string, unknown> }) {
  const parentId = design.nodes[ids[0] as string]?.parentId as string
  const inside = childrenOf(design, parentId).filter(([child]) => ids.includes(child))
  const top = inside.at(-1)?.[1] as LayerT
  const place = new Placement(design)
  const boxIn = (scope: Parameters<Placement['get']>[0]) => boundsOf(inside.map(([child]) => place.get(scope, child)))
  const base = boxIn('base')
  const box = { x: round(base.x), y: round(base.y), width: round(base.width), height: round(base.height) }
  r.nodes.set(id, toYNode(Layer.parse({ type: layer.type, name: layer.name, parentId, index: top.index, props: { ...layer.props, ...box } })))
  for (const scope of place.scopes) {
    if (scope === 'base') continue
    const b = boxIn(scope)
    for (const [path, value] of Object.entries({ x: b.x, y: b.y, width: b.width, height: b.height })) {
      if (Math.abs(round(value) - box[path as keyof typeof box]) >= 0.005) r.overrides.set(overrideKey(scope, id, path), round(value))
    }
  }
  // Their indexes already order them; they only change parent.
  for (const [child] of inside) r.nodes.get(child)?.set('parentId', id)
  return id
}

/**
 * Wraps layers that share a parent in a new group where the topmost of them was, without moving
 * anything on screen. The group's box hugs them in each format. Returns the group's id.
 */
export const nodeGroup = defineCommand({
  name: 'node.group',
  input: z.object({ ids: NodeId.array().min(1), id: NodeId.optional(), name: z.string().default('Group') }),
  check: (ctx, { ids, id }) => wrapProblem(ctx, ids, id, 'group'),
  apply: (ctx, { ids, id = nanoid(), name }) => wrap(ctx, ids, id, { type: 'group', name }),
})

/**
 * Combines shapes that share a parent into a live boolean (#44) where the topmost of them was,
 * without moving them. It paints with the bottom shape's fills and strokes, the shape the others
 * add to or cut from. Returns the boolean's id.
 */
export const nodeBoolean = defineCommand({
  name: 'node.boolean',
  input: z.object({ ids: NodeId.array().min(2), op: BooleanOp, id: NodeId.optional(), name: z.string().optional() }),
  check: (ctx, { ids, id }) => {
    for (const layer of ids) {
      const type = ctx.design.nodes[layer]?.type
      if (type && type !== 'graphic' && type !== 'boolean') return `"${layer}" is a ${type}; only shapes and booleans combine`
    }
    return wrapProblem(ctx, ids, id, 'boolean')
  },
  apply: (ctx, { ids, op, id = nanoid(), name }) => {
    const parentId = ctx.design.nodes[ids[0] as string]?.parentId as string
    const bottom = childrenOf(ctx.design, parentId).find(([child]) => ids.includes(child))?.[1]
    const paint = bottom && (bottom.type === 'graphic' || bottom.type === 'boolean') ? { fills: bottom.props.fills, strokes: bottom.props.strokes } : {}
    const names = { union: 'Union', subtract: 'Subtract', intersect: 'Intersect', exclude: 'Exclude' } as const
    return wrap(ctx, ids, id, { type: 'boolean', name: name ?? names[op], props: { op, ...paint } })
  },
})

/**
 * Takes the layers out of groups or booleans and removes them, without moving anything on
 * screen: a turned group's turn goes into each layer it held, and a group hidden in a format
 * hides them there. Shapes out of a boolean show their own paints again. The layers take the group's place among its siblings. Returns their ids, in order.
 */
export const nodeUngroup = defineCommand({
  name: 'node.ungroup',
  input: z.object({ ids: NodeId.array().min(1) }),
  check: ({ design }, { ids }) => {
    for (const id of ids) {
      const node = design.nodes[id]
      if (!node) return `no layer "${id}"`
      if (node.type !== 'group' && node.type !== 'boolean') return `"${id}" is a ${node.type}, not a group or boolean`
      const locked = lockProblem(id, node, 'delete')
      if (locked) return locked
    }
    return undefined
  },
  apply: ({ r, design }, { ids }) => {
    const freed: string[] = []
    const groups = ids.filter((id) => !ids.some((other) => other !== id && isInside(design, id, other)))
    const place = new Placement(design)
    for (const id of groups) {
      const kids = childrenOf(design, id).map(([child]) => child)
      for (const scope of place.scopes) {
        const group = place.get(scope, id)
        for (const kid of kids) {
          const was = place.get(scope, kid)
          if (group.rotation !== 0) {
            const c = centreOf(was)
            const to = turn(c, centreOf(group), group.rotation)
            const dx = to.x - c.x
            const dy = to.y - c.y
            place.set(scope, kid, { x: was.x + dx, y: was.y + dy, rotation: normalAngle(was.rotation + group.rotation) })
            for (const inner of descendants(design, kid)) {
              const at = place.get(scope, inner)
              place.set(scope, inner, { x: at.x + dx, y: at.y + dy })
            }
          }
          if (!group.visible) place.set(scope, kid, { visible: false })
        }
      }
    }
    place.write(r)
    for (const id of groups) {
      const group = design.nodes[id] as LayerT
      const siblings = childrenOf(design, group.parentId)
      const next = siblings[siblings.findIndex(([sibling]) => sibling === id) + 1]?.[1].index ?? null
      let at = group.index
      for (const [kid] of childrenOf(design, id)) {
        at = indexBetween(at, next)
        r.nodes.get(kid)?.set('parentId', group.parentId)
        r.nodes.get(kid)?.set('index', at)
        freed.push(kid)
      }
      r.nodes.get(id)?.set(DELETED, true)
    }
    return freed
  },
})

/**
 * Fits groups and booleans to what they hold, in every format: each named one, and every one the
 * named layers are in, innermost first. A turned group's layers shift with its new centre so nothing
 * moves on screen. The editor runs it after a change to layers inside a group, in the same step.
 */
export const nodeHug = defineCommand({
  name: 'node.hug',
  input: z.object({ ids: NodeId.array().min(1) }),
  check: ({ design }, { ids }) => ids.map((id) => (design.nodes[id] ? undefined : `no layer "${id}"`)).find(Boolean),
  apply: ({ r, design }, { ids }) => {
    const groups = new Set<string>()
    for (const id of ids) {
      for (let up: string | undefined = id; up && design.nodes[up]; up = design.nodes[up]?.parentId) {
        const type = design.nodes[up]?.type
        if (type === 'group' || type === 'boolean') groups.add(up)
      }
    }
    const place = new Placement(design)
    for (const id of [...groups].sort((a, b) => depthOf(design, b) - depthOf(design, a))) {
      const kids = childrenOf(design, id).map(([child]) => child)
      if (kids.length === 0) continue
      for (const scope of place.scopes) {
        const group = place.get(scope, id)
        const fit = boundsOf(kids.map((kid) => place.get(scope, kid)))
        // Turned about its new centre instead of the old one, the group would draw its layers
        // elsewhere; moving them and the box by d keeps every one where it was.
        const v = { x: centreOf(group).x - centreOf(fit).x, y: centreOf(group).y - centreOf(fit).y }
        const turned = turn(v, { x: 0, y: 0 }, group.rotation)
        const d = { x: v.x - turned.x, y: v.y - turned.y }
        const next = { x: fit.x + d.x, y: fit.y + d.y, width: fit.width, height: fit.height }
        // Within what rounding to hundredths leaves, it already fits: fitting again changes nothing.
        if ((['x', 'y', 'width', 'height'] as const).every((k) => Math.abs(next[k] - group[k]) < 0.02)) continue
        place.set(scope, id, next)
        if (Math.hypot(d.x, d.y) < 0.005) continue
        for (const inner of descendants(design, id)) {
          const at = place.get(scope, inner)
          place.set(scope, inner, { x: at.x + d.x, y: at.y + d.y })
        }
      }
    }
    place.write(r)
  },
})

/**
 * Gives a path layer new path data (#45). The data is in the layer's own coordinates as they were,
 * moved so the new outline starts at 0, 0: `dx` and `dy` are how far its box's corner moves, and
 * `width` and `height` its new size. Path data is shared by every format, so each format's box moves
 * the same way; a turned box also shifts with its new centre, so the points that didn't change
 * stay where they are drawn.
 */
export const nodeReshape = defineCommand({
  name: 'node.reshape',
  input: z.object({ id: NodeId, d: z.string().min(1), dx: z.number(), dy: z.number(), width: z.number().min(0), height: z.number().min(0) }),
  check: ({ design }, { id }) => {
    const node = design.nodes[id]
    if (!node) return `no layer "${id}"`
    if (node.type !== 'graphic' || node.props.shape.kind !== 'path') return `"${id}" is not a path`
    for (const flag of ['style', 'move', 'resize'] as const) {
      const locked = lockProblem(id, node, flag)
      if (locked) return locked
    }
    return undefined
  },
  apply: ({ r, design }, { id, d, dx, dy, width, height }) => {
    const node = design.nodes[id]
    if (node?.type !== 'graphic' || node.props.shape.kind !== 'path') return
    const props = r.nodes.get(id)?.get('props') as Y.Map<unknown>
    props.set('shape', { ...node.props.shape, d })
    const place = new Placement(design)
    for (const scope of place.scopes) {
      const was = place.get(scope, id)
      const next = { x: was.x + dx, y: was.y + dy, width, height }
      const v = { x: centreOf({ ...next, rotation: 0 }).x - centreOf(was).x, y: centreOf({ ...next, rotation: 0 }).y - centreOf(was).y }
      const turned = turn(v, { x: 0, y: 0 }, was.rotation)
      place.set(scope, id, { ...next, x: next.x + turned.x - v.x, y: next.y + turned.y - v.y })
    }
    place.write(r)
  },
})

/**
 * Switches a frame's auto layout on or off (#46). On, its settings are read off where its
 * children are, in every format, and the children are put in the order the flow takes them, so a
 * frame whose children already sit in an even row or column looks the same. Off, the layout goes
 * from the base and every format.
 */
export const nodeAutoLayout = defineCommand({
  name: 'node.autoLayout',
  input: z.object({ id: NodeId, on: z.boolean() }),
  check: ({ design }, { id }) => {
    const node = design.nodes[id]
    if (!node) return `no layer "${id}"`
    if (node.type !== 'frame') return `"${id}" is a ${node.type}; only frames have auto layout`
    return lockProblem(id, node, 'style')
  },
  apply: ({ r, design }, { id, on }) => {
    const props = r.nodes.get(id)?.get('props') as Y.Map<unknown>
    const scopes = Object.keys(design.formats).map((f) => `format:${f}` as const)
    if (!on) {
      props.delete('layout')
      for (const scope of scopes) r.overrides.delete(overrideKey(scope, id, 'layout'))
      return
    }
    const place = new Placement(design)
    const flow = childrenOf(design, id).filter(([, node]) => !node.props.absolute)
    const inferIn = (scope: 'base' | `format:${string}`) => inferLayout(place.get(scope, id), flow.map(([kid]) => [kid, place.get(scope, kid)]))
    const { order, layout } = inferIn('base')
    props.set('layout', layout)
    for (const scope of scopes) {
      const here = inferIn(scope).layout
      if (JSON.stringify(here) !== JSON.stringify(layout)) r.overrides.set(overrideKey(scope, id, 'layout'), here)
      else r.overrides.delete(overrideKey(scope, id, 'layout'))
    }
    // The flow follows the children's order: they swap places in it, leaving absolute ones where they are.
    const slots = flow.map(([, node]) => node.index).sort()
    order.forEach((kid, i) => {
      if (design.nodes[kid]?.index !== slots[i]) r.nodes.get(kid)?.set('index', slots[i])
    })
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
    const locked = lockProblem(id, node, op.kind === 'style' ? 'style' : 'content')
    if (locked) return locked
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

/**
 * Sets the box of text that grows to the size it is drawn at (#47), measured by the caller in each
 * format: its width and height for auto width, its height for auto height. The editor runs it as
 * text is typed, in the same undo step, so the box is always where the words are.
 */
export const textFit = defineCommand({
  name: 'text.fit',
  input: z.object({ id: NodeId, sizes: z.record(z.string(), z.object({ width: z.number().min(0), height: z.number().min(0) })) }),
  check: ({ design }, { id, sizes }) => {
    const node = design.nodes[id]
    if (!node) return `no layer "${id}"`
    if (node.type !== 'text') return `"${id}" is a ${node.type}, not a text layer`
    return Object.keys(sizes).map((f) => (design.formats[f] ? undefined : `no format "${f}"`)).find(Boolean)
  },
  apply: ({ r, design }, { id, sizes }) => {
    const place = new Placement(design)
    const primary = sizes[design.meta.primaryFormatId]
    if (primary) place.set('base', id, primary)
    for (const [formatId, size] of Object.entries(sizes)) place.set(`format:${formatId}`, id, size)
    place.write(r)
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
    copyLayers(r, design, childrenOf(design, id).map(([child]) => child), (root) => ({ parentId: newId, index: (design.nodes[root] as LayerT).index }))
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
  'node.lock': nodeLock,
  'node.reorder': nodeReorder,
  'node.duplicate': nodeDuplicate,
  'node.group': nodeGroup,
  'node.boolean': nodeBoolean,
  'node.ungroup': nodeUngroup,
  'node.hug': nodeHug,
  'node.reshape': nodeReshape,
  'node.autoLayout': nodeAutoLayout,
  'text.edit': textEdit,
  'text.fit': textFit,
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
