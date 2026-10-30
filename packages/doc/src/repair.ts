type Json = Record<string, unknown>
type NodeJson = { parentId: string } & Json
type Snapshot = {
  pages: Record<string, unknown>
  nodes: Record<string, Json>
  overrides: Record<string, unknown>
}

/** Code-unit order, the same on every device (unlike localeCompare) and the order fractional indexes use. */
const byCodeUnits = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)
const orderOf = (page: unknown) => String((page as { order?: unknown } | undefined)?.order)

/**
 * Concurrent edits can merge into a state no single command allows: two moves that put layers
 * inside each other, a child added to a group another tab deleted, an override written for a
 * deleted layer, a key an undo left unset. These rules turn any merged state into a valid one.
 * They read only the merged state, so every device repairs it the same way, and they never
 * write: the next edit carries on from the repaired view. The snapshot is not changed either: a
 * repaired layer is a copy, and every other object comes back as it was, so a reader can keep
 * what it validated for them.
 */
export function repair<S extends Snapshot>(snapshot: S): { snapshot: S; repairs: string[] } {
  const s = snapshot
  const repairs: string[] = []
  const firstPage = Object.entries(s.pages).sort(([a, x], [b, y]) => byCodeUnits(orderOf(x), orderOf(y)) || byCodeUnits(a, b))[0]?.[0]
  if (!firstPage) return { snapshot: s, repairs }
  const containers = new Set(['frame', 'group'])

  // 1. Drop layers that can't be read at all, before anyone looks for parents among them.
  const nodes = new Map<string, NodeJson>()
  for (const id of Object.keys(s.nodes).sort(byCodeUnits)) {
    const node = s.nodes[id] as NodeJson
    if (typeof node.type !== 'string' || typeof node.props !== 'object' || node.props === null) {
      repairs.push(`dropped "${id}", which lost its type or props`)
    } else {
      nodes.set(id, node)
    }
  }
  const ids = [...nodes.keys()]

  // 2. Give every layer an index and a parent that exists and can hold it.
  for (const id of ids) {
    const node = nodes.get(id) as NodeJson
    if (typeof node.index !== 'string') {
      repairs.push(`"${id}" lost its index; put at the back`)
      nodes.set(id, { ...node, index: 'a0' })
    }
    const parent = nodes.get(node.parentId)
    if (!s.pages[node.parentId] && (!parent || !containers.has(String(parent.type)))) {
      repairs.push(`"${id}" lost its parent "${String(node.parentId)}"; moved to page "${firstPage}"`)
      nodes.set(id, { ...(nodes.get(id) as NodeJson), parentId: firstPage })
    }
  }

  // 3. Break each cycle at its smallest id, so all devices pick the same layer.
  for (const id of ids) {
    const path: string[] = []
    for (let up: string | undefined = id; up && nodes.has(up); up = nodes.get(up)?.parentId) {
      const at = path.indexOf(up)
      if (at !== -1) {
        const breakAt = path.slice(at).sort(byCodeUnits)[0] as string
        repairs.push(`"${breakAt}" was inside itself; moved to page "${firstPage}"`)
        nodes.set(breakAt, { ...(nodes.get(breakAt) as NodeJson), parentId: firstPage })
        break
      }
      path.push(up)
    }
  }

  // 4. Overrides of layers that no longer exist mean nothing.
  const orphaned = Object.values(s.overrides).some((byNode) => Object.keys(byNode as Json).some((id) => !nodes.has(id)))
  if (repairs.length === 0 && !orphaned) return { snapshot: s, repairs }
  const overrides = Object.fromEntries(Object.entries(s.overrides).map(([scope, byNode]) => [scope, Object.fromEntries(
    Object.entries(byNode as Json).filter(([id]) => {
      if (nodes.has(id)) return true
      repairs.push(`dropped ${scope} overrides of deleted layer "${id}"`)
      return false
    }),
  )]))
  return { snapshot: { ...s, nodes: Object.fromEntries(nodes), overrides }, repairs }
}
