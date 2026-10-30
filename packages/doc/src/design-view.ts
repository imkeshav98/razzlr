import { canHold, formatIdOf, parseDesignIncrementally, parseLayer, parseOverrideValues, SCHEMA_VERSION, type Design, type Layer } from '@razzlr/schema'
import type * as Y from 'yjs'
import { buildChildIndex, registerChildIndex, siblingOrder } from './children.ts'
import { DELETED, nodeToJson, readDesign, root, splitOverrideKey, type DesignDoc } from './design-doc.ts'
import { repair } from './repair.ts'

type Json = Record<string, unknown>
type Head = Pick<Design, 'meta' | 'formats' | 'pages'>

/**
 * A tab's validated design, kept up to date as the document changes (#23, #29). An edit that
 * changes layers' properties or override values, which is nearly every edit, re-reads and
 * validates only what it touched: nothing it does grows with the number of layers. An edit that
 * adds, removes or re-parents a layer, or changes the formats, pages or meta, reads and repairs
 * the whole design, as `readDesign` does. Either way the design equals what `readDesign` returns.
 *
 * The design it hands out is live: it always shows the document as it is now, so it never needs
 * copying. It can't be changed through, and each layer and set of override values in it is frozen
 * and replaced, never changed, when the document changes, so holding one of those is safe.
 */
export function designView(doc: DesignDoc) {
  const r = root(doc)
  /** Each live layer as plain JSON, as the document holds it, before repair and validation. */
  const rawNodes = new Map<string, Json>()
  /** Override values by scope and layer as the document holds them; each set is replaced when one value changes. */
  const rawOverrides = new Map<string, Map<string, Json>>()

  /** The validated design: layers, override values with defaults filled, and each parent's children. */
  const layers = new Map<string, Layer>()
  const filled = new Map<string, Map<string, Json>>()
  /** One live record per scope in `filled`, handed out as `design.overrides[scope]`. */
  const scopeRecords = new Map<string, Record<string, Json>>()
  /** A scope the document still has values in stays, even empty: its values may all belong to deleted layers, as in `readDesign`. */
  const setScope = (scope: string, byNode: Map<string, Json> | undefined) => {
    if (!byNode || (byNode.size === 0 && !rawOverrides.has(scope))) {
      filled.delete(scope)
      scopeRecords.delete(scope)
      return
    }
    filled.set(scope, byNode)
    if (!scopeRecords.has(scope)) scopeRecords.set(scope, readOnlyRecord(() => {
      refresh()
      return filled.get(scope) ?? new Map<string, Json>()
    }))
  }
  let children = new Map<string, string[]>()
  let head: Head | null = null
  /** Whether the last whole read moved a layer from where the document puts it, or gave it an index. */
  let placesRepaired = false

  /** Whether the whole design must be read again, and what changed since the last read otherwise. */
  let whole = true
  const dirtyNodes = new Set<string>()
  const dirtyPairs = new Map<string, Set<string>>()

  const loadNode = (id: string) => {
    const ynode = r.nodes.get(id)
    if (!ynode || ynode.get(DELETED) === true) rawNodes.delete(id)
    else rawNodes.set(id, nodeToJson(ynode))
  }
  const loadOverride = (key: string) => {
    const { scope, nodeId, path } = splitOverrideKey(key)
    const byNode = rawOverrides.get(scope) ?? new Map<string, Json>()
    const props = Object.fromEntries(Object.entries(byNode.get(nodeId) ?? {}).filter(([p]) => p !== path))
    // Defined, not assigned: a path such as `__proto__` from another tab stays a plain key.
    if (r.overrides.has(key)) Object.defineProperty(props, path, { value: r.overrides.get(key), enumerable: true, writable: true, configurable: true })
    if (Object.keys(props).length > 0) byNode.set(nodeId, props)
    else byNode.delete(nodeId)
    if (byNode.size > 0) rawOverrides.set(scope, byNode)
    else rawOverrides.delete(scope)
    const pairs = dirtyPairs.get(scope) ?? new Set<string>()
    pairs.add(nodeId)
    dirtyPairs.set(scope, pairs)
  }
  for (const id of r.nodes.keys()) loadNode(id)
  for (const key of r.overrides.keys()) loadOverride(key)
  dirtyPairs.clear()

  // Every change is seen before any observer of the document runs, so an observer that reads the
  // view gets the new design. The changed types name the touched layers and override keys.
  const heads = new Set<unknown>([r.meta, r.formats, r.pages])
  const onChange = (tr: Y.Transaction) => {
    for (const [changed, keys] of tr.changed) {
      const type: unknown = changed
      if (heads.has(type)) {
        whole = true
        continue
      }
      if (type === r.overrides) {
        for (const key of keys) if (key !== null) loadOverride(key)
        continue
      }
      if (type === r.nodes) {
        for (const id of keys) if (id !== null) dirtyNodes.add(id)
        continue
      }
      // A change inside a layer or a head map: walk up to the root map it hangs from.
      let item = changed._item
      while (item && item.parent !== r.nodes && !heads.has(item.parent)) item = (item.parent as Y.AbstractType<unknown>)._item
      if (!item) continue
      if (item.parent === r.nodes && typeof item.parentSub === 'string') dirtyNodes.add(item.parentSub)
      else whole = true
    }
  }
  doc.on('beforeObserverCalls', onChange)

  /** Reads, repairs and validates the whole design, as `readDesign` does. */
  function readWhole(onRepair?: (repairs: string[]) => void) {
    for (const id of dirtyNodes) loadNode(id)
    const rawHead = { meta: r.meta.toJSON(), formats: r.formats.toJSON(), pages: r.pages.toJSON() }
    const nested = Object.fromEntries([...rawOverrides].map(([scope, byNode]) => [scope, Object.fromEntries(byNode)]))
    const repaired = repair({ ...rawHead, nodes: Object.fromEntries(rawNodes), overrides: nested })
    if (repaired.repairs.length > 0) onRepair?.(repaired.repairs)
    const result = parseDesignIncrementally(repaired.snapshot)
    if (!result.success) throw new Error(`design document is invalid:\n${result.errors.join('\n')}`)
    const d = result.design
    head = { meta: deepFreeze(d.meta), formats: deepFreeze(d.formats), pages: deepFreeze(d.pages) }
    layers.clear()
    for (const [id, layer] of Object.entries(d.nodes)) layers.set(id, layer)
    for (const scope of [...filled.keys()]) if (!Object.hasOwn(d.overrides, scope)) setScope(scope, undefined)
    for (const [scope, byNode] of Object.entries(d.overrides)) setScope(scope, new Map(Object.entries(byNode)))
    children = buildChildIndex(layers)
    placesRepaired = [...layers].some(([id, layer]) => rawNodes.get(id)?.parentId !== layer.parentId || rawNodes.get(id)?.index !== layer.index)
  }

  /**
   * Takes in an edit by checking only the layers and override values it touched. Returns false,
   * having changed nothing, when repair has to decide instead: something is invalid, a layer
   * changed type, a move would put a layer inside itself, a removed layer leaves children behind,
   * or the last whole read repaired a layer's place, which a later change can undo.
   */
  function readChanges(): boolean {
    // A document saved at an older schema version is migrated as a whole each time it is read.
    if (!head || r.meta.get('schemaVersion') !== SCHEMA_VERSION) return false
    const pages = head.pages
    const staged = new Map<string, Layer>()
    const removed = new Set<string>()
    let structural = false
    for (const id of dirtyNodes) {
      const was = layers.get(id)
      loadNode(id)
      const raw = rawNodes.get(id)
      if (!raw) {
        if (was) removed.add(id)
        continue
      }
      if (was && raw.type !== was.type) return false
      const parsed = parseLayer(raw)
      if (!parsed.success) return false
      staged.set(id, parsed.layer)
      if (!was || was.parentId !== parsed.layer.parentId) structural = true
    }
    if (removed.size > 0) structural = true
    if (structural && placesRepaired) return false

    // The layers as they will be: what a parent check or a cycle walk sees.
    const next = (id: string) => staged.get(id) ?? (removed.has(id) ? undefined : layers.get(id))
    for (const [id, layer] of staged) {
      if (layers.get(id)?.parentId === layer.parentId) continue
      if (Object.hasOwn(pages, id)) return false
      if (!Object.hasOwn(pages, layer.parentId)) {
        const parent = next(layer.parentId)
        if (!parent || !canHold(parent.type, layer.type)) return false
      }
      for (let up = layer.parentId, steps = 0; !Object.hasOwn(pages, up); steps++) {
        const above = next(up)
        if (up === id || !above || steps > layers.size + staged.size) return false
        up = above.parentId
      }
    }
    for (const id of removed) {
      for (const child of children.get(id) ?? []) if (next(child)?.parentId === id) return false
    }

    // A changed layer's overrides are checked against it again, in every scope; a removed layer's go.
    const pairs = new Map([...dirtyPairs].map(([scope, ids]) => [scope, new Set(ids)]))
    for (const id of [...staged.keys(), ...removed]) {
      for (const [scope, byNode] of rawOverrides) if (byNode.has(id)) pairs.set(scope, (pairs.get(scope) ?? new Set()).add(id))
    }
    const stagedValues: [string, string, Json | undefined][] = []
    for (const [scope, ids] of pairs) {
      if (ids.size > 0 && !head.formats[formatIdOf(scope) ?? '']) return false
      for (const id of ids) {
        const values = rawOverrides.get(scope)?.get(id)
        if (!values || removed.has(id)) {
          stagedValues.push([scope, id, undefined])
          continue
        }
        // Values for a layer that doesn't exist: repair drops them and reports it.
        const layer = next(id)
        if (!layer) return false
        const parsed = parseOverrideValues(scope, layer, values)
        if (!parsed.success) return false
        stagedValues.push([scope, id, parsed.values])
      }
    }

    // Every list that changes is a new array, so a list handed out before stays as it was.
    const lists = new Map<string, string[]>()
    const listOf = (parentId: string) => {
      let list = lists.get(parentId)
      if (!list) {
        list = [...(children.get(parentId) ?? [])]
        lists.set(parentId, list)
      }
      return list
    }
    const drop = (parentId: string, id: string) => {
      const list = listOf(parentId)
      const at = list.indexOf(id)
      if (at !== -1) list.splice(at, 1)
    }
    for (const id of removed) {
      drop((layers.get(id) as Layer).parentId, id)
      layers.delete(id)
    }
    for (const [id, layer] of staged) {
      const was = layers.get(id)
      if (!was || was.parentId !== layer.parentId) {
        if (was) drop(was.parentId, id)
        listOf(layer.parentId).push(id)
      } else if (was.index !== layer.index) {
        listOf(layer.parentId)
      }
      layers.set(id, layer)
    }
    const order = siblingOrder(layers)
    for (const [parentId, list] of lists) {
      if (list.length > 0) children.set(parentId, list.sort(order))
      else children.delete(parentId)
    }
    for (const id of removed) if (!layers.has(id)) children.delete(id)
    for (const [scope, id, values] of stagedValues) {
      const byNode = filled.get(scope) ?? new Map<string, Json>()
      if (values) byNode.set(id, values)
      else byNode.delete(id)
      setScope(scope, byNode)
    }
    return true
  }

  /** Brings the validated design up to date with the document. Not inside a transaction: the changes so far aren't reported yet. */
  function refresh(onRepair?: (repairs: string[]) => void) {
    if (doc._transaction) return
    if (!whole && dirtyNodes.size === 0 && dirtyPairs.size === 0) return
    if (whole || !readChanges()) readWhole(onRepair)
    whole = false
    dirtyNodes.clear()
    dirtyPairs.clear()
  }

  const nodes = readOnlyRecord(() => {
    refresh()
    return layers
  })
  const overrides = readOnlyRecord(() => {
    refresh()
    return scopeRecords
  })
  const current = () => {
    refresh()
    if (!head) throw new Error('the design view was read inside a transaction before its first read')
    return head
  }
  const design = Object.freeze({
    get meta() { return current().meta },
    get formats() { return current().formats },
    get pages() { return current().pages },
    nodes,
    overrides,
  }) as unknown as Design
  registerChildIndex(nodes, (parentId) => {
    refresh()
    return children.get(parentId) ?? []
  })

  function read(onRepair?: (repairs: string[]) => void): Design {
    // Inside a transaction the changes so far haven't been reported yet: read them directly.
    if (doc._transaction) return readDesign(doc, onRepair)
    refresh(onRepair)
    return design
  }

  return {
    read,
    destroy() {
      doc.off('beforeObserverCalls', onChange)
    },
  }
}

/**
 * A plain-looking record over a map that can't be changed through: setting, defining or deleting
 * a key fails, which throws in strict mode code. Keys and values always come from `entries()`.
 */
function readOnlyRecord<V>(entries: () => ReadonlyMap<string, V>): Record<string, V> {
  return new Proxy({} as Record<string, V>, {
    get: (target, key) => {
      if (typeof key === 'string') {
        const map = entries()
        if (map.has(key)) return map.get(key)
      }
      return Reflect.get(target, key) as unknown
    },
    has: (_, key) => typeof key === 'string' && entries().has(key),
    ownKeys: () => [...entries().keys()],
    getOwnPropertyDescriptor: (_, key) => {
      const map = entries()
      if (typeof key !== 'string' || !map.has(key)) return undefined
      return { value: map.get(key), writable: false, enumerable: true, configurable: true }
    },
    set: () => false,
    defineProperty: () => false,
    deleteProperty: () => false,
    setPrototypeOf: () => false,
  })
}

function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const inner of Object.values(value)) deepFreeze(inner)
  }
  return value
}
