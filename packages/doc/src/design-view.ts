import { parseDesignIncrementally, type Design } from '@razzlr/schema'
import type * as Y from 'yjs'
import { DELETED, nodeToJson, root, splitOverrideKey, type DesignDoc } from './design-doc.ts'
import { repair } from './repair.ts'

type Json = Record<string, unknown>

/**
 * A tab's validated design, kept up to date as the document changes (#23). Reading it after an
 * edit only converts and validates the layers and overrides the edit touched, where `readDesign`
 * does the whole design every time. It returns exactly what `readDesign` returns.
 * The design it returns is shared between reads, so it must never be changed.
 */
export function designView(doc: DesignDoc) {
  const r = root(doc)
  /** Each live layer as JSON; an object is replaced, never changed, when its layer changes. */
  const nodes = new Map<string, Json>()
  /** Override values by `scope|nodeId`, each set of values replaced whenever one of them changes. */
  const overrides = new Map<string, { scope: string; nodeId: string; props: Json }>()
  const dirtyNodes = new Set<string>()
  let head: { meta: Json; formats: Json; pages: Json } | null = null
  let design: Design | null = null

  const loadNode = (id: string) => {
    const ynode = r.nodes.get(id)
    if (!ynode || ynode.get(DELETED) === true) nodes.delete(id)
    else nodes.set(id, nodeToJson(ynode))
  }
  const loadOverride = (key: string) => {
    const { scope, nodeId, path } = splitOverrideKey(key)
    const pair = `${scope}|${nodeId}`
    const props = Object.fromEntries(Object.entries(overrides.get(pair)?.props ?? {}).filter(([p]) => p !== path))
    if (r.overrides.has(key)) props[path] = r.overrides.get(key)
    if (Object.keys(props).length > 0) overrides.set(pair, { scope, nodeId, props })
    else overrides.delete(pair)
  }
  for (const id of r.nodes.keys()) loadNode(id)
  for (const key of r.overrides.keys()) loadOverride(key)

  const onNodes = (events: Y.YEvent<Y.AbstractType<unknown>>[]) => {
    design = null
    for (const event of events) {
      if (event.target === r.nodes) for (const id of (event as Y.YMapEvent<unknown>).keysChanged) dirtyNodes.add(id)
      else dirtyNodes.add(String(event.path[0]))
    }
  }
  const onOverrides = (event: Y.YMapEvent<unknown>) => {
    design = null
    for (const key of event.keysChanged) loadOverride(key)
  }
  const onHead = () => {
    design = null
    head = null
  }
  r.nodes.observeDeep(onNodes)
  r.overrides.observe(onOverrides)
  for (const type of [r.meta, r.formats, r.pages]) type.observeDeep(onHead)

  function read(onRepair?: (repairs: string[]) => void): Design {
    if (design) return design
    for (const id of dirtyNodes) loadNode(id)
    dirtyNodes.clear()
    head ??= { meta: r.meta.toJSON(), formats: r.formats.toJSON(), pages: r.pages.toJSON() }
    const nested: Record<string, Record<string, Json>> = {}
    for (const { scope, nodeId, props } of overrides.values()) (nested[scope] ??= {})[nodeId] = props
    const repaired = repair({ ...head, nodes: Object.fromEntries(nodes), overrides: nested })
    if (repaired.repairs.length > 0) onRepair?.(repaired.repairs)
    const result = parseDesignIncrementally(repaired.snapshot)
    if (!result.success) throw new Error(`design document is invalid:\n${result.errors.join('\n')}`)
    design = result.design
    return design
  }

  return {
    read,
    destroy() {
      r.nodes.unobserveDeep(onNodes)
      r.overrides.unobserve(onOverrides)
      for (const type of [r.meta, r.formats, r.pages]) type.unobserveDeep(onHead)
    },
  }
}
