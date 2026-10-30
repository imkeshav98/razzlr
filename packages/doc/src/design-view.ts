import { parseDesignIncrementally, type Design } from '@razzlr/schema'
import type * as Y from 'yjs'
import { DELETED, nodeToJson, readDesign, root, splitOverrideKey, type DesignDoc } from './design-doc.ts'
import { repair } from './repair.ts'

type Json = Record<string, unknown>

/**
 * A tab's validated design, kept up to date as the document changes (#23). Reading it after an
 * edit only converts and validates the layers and overrides the edit touched, where `readDesign`
 * does the whole design every time. It returns exactly what `readDesign` returns.
 * The design it returns is shared between reads, so it is frozen.
 */
export function designView(doc: DesignDoc) {
  const r = root(doc)
  /** Each live layer as JSON; an object is replaced, never changed, when its layer changes. */
  const nodes = new Map<string, Json>()
  /** Override values by scope and layer, each set of values replaced whenever one of them changes. */
  const overrides = new Map<string, Map<string, Json>>()
  /** Each scope's override values as one object, until one of them changes. */
  const scopes = new Map<string, Json>()
  const dirtyNodes = new Set<string>()
  let head: { meta: Json; formats: Json; pages: Json } | null = null
  let design: Design | null = null

  const loadNode = (id: string) => {
    const ynode = r.nodes.get(id)
    if (!ynode || ynode.get(DELETED) === true) nodes.delete(id)
    else nodes.set(id, Object.freeze(nodeToJson(ynode)))
  }
  const loadOverride = (key: string) => {
    const { scope, nodeId, path } = splitOverrideKey(key)
    scopes.delete(scope)
    const byNode = overrides.get(scope) ?? new Map<string, Json>()
    const props = Object.fromEntries(Object.entries(byNode.get(nodeId) ?? {}).filter(([p]) => p !== path))
    if (r.overrides.has(key)) Object.defineProperty(props, path, { value: r.overrides.get(key), enumerable: true, writable: true, configurable: true })
    if (Object.keys(props).length > 0) byNode.set(nodeId, props)
    else byNode.delete(nodeId)
    if (byNode.size > 0) overrides.set(scope, byNode)
    else overrides.delete(scope)
  }
  for (const id of r.nodes.keys()) loadNode(id)
  for (const key of r.overrides.keys()) loadOverride(key)

  // Every change is seen before any observer of the document runs, so an observer that reads the
  // view gets the new design. The changed types name the touched layers and override keys.
  const heads = new Set<unknown>([r.meta, r.formats, r.pages])
  const onChange = (tr: Y.Transaction) => {
    for (const [changed, keys] of tr.changed) {
      const type: unknown = changed
      if (heads.has(type)) {
        head = null
        design = null
        continue
      }
      if (type === r.overrides) {
        for (const key of keys) if (key !== null) loadOverride(key)
        design = null
        continue
      }
      if (type === r.nodes) {
        for (const id of keys) if (id !== null) dirtyNodes.add(id)
        design = null
        continue
      }
      // A change inside a layer or a head map: walk up to the root map it hangs from.
      let item = changed._item
      while (item && item.parent !== r.nodes && !heads.has(item.parent)) item = (item.parent as Y.AbstractType<unknown>)._item
      if (!item) continue
      if (item.parent === r.nodes && typeof item.parentSub === 'string') dirtyNodes.add(item.parentSub)
      else head = null
      design = null
    }
  }
  doc.on('beforeObserverCalls', onChange)

  function read(onRepair?: (repairs: string[]) => void): Design {
    // Inside a transaction the changes so far haven't been reported yet: read them directly.
    if (doc._transaction) return readDesign(doc, onRepair)
    if (design) return design
    for (const id of dirtyNodes) loadNode(id)
    dirtyNodes.clear()
    head ??= { meta: r.meta.toJSON(), formats: r.formats.toJSON(), pages: r.pages.toJSON() }
    // Unchanged scopes keep their objects, so the parser can take them as checked before.
    // Entries, not assignment: an id such as `__proto__` from another tab stays a plain key.
    for (const [scope, byNode] of overrides) if (!scopes.has(scope)) scopes.set(scope, Object.freeze(Object.fromEntries(byNode)))
    const nestedOverrides = Object.fromEntries([...overrides.keys()].map((scope) => [scope, scopes.get(scope)]))
    const repaired = repair({ ...head, nodes: Object.fromEntries(nodes), overrides: nestedOverrides })
    if (repaired.repairs.length > 0) onRepair?.(repaired.repairs)
    const result = parseDesignIncrementally(repaired.snapshot)
    if (!result.success) throw new Error(`design document is invalid:\n${result.errors.join('\n')}`)
    // The layers and override values inside are frozen by the parser; freeze the rest.
    design = Object.freeze({
      ...result.design,
      meta: deepFreeze(result.design.meta),
      formats: deepFreeze(result.design.formats),
      pages: deepFreeze(result.design.pages),
      nodes: Object.freeze(result.design.nodes),
      overrides: Object.freeze(Object.fromEntries(Object.entries(result.design.overrides).map(([k, v]) => [k, Object.freeze(v)]))),
    })
    return design
  }

  return {
    read,
    destroy() {
      doc.off('beforeObserverCalls', onChange)
    },
  }
}

function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const inner of Object.values(value)) deepFreeze(inner)
  }
  return value
}
