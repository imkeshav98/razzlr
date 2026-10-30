type Json = Record<string, unknown>
type NodeJson = { parentId: string } & Json
type Snapshot = {
  pages: Record<string, unknown>
  nodes: Record<string, Json>
  overrides: Record<string, unknown>
}
const orderOf = (page: unknown) => String((page as { order?: unknown } | undefined)?.order)

/**
 * Concurrent edits can merge into a state no single command allows: two moves that put layers
 * inside each other, a child added to a group another tab deleted, an override written for a
 * deleted layer. These rules turn any merged state into a valid one. They read only the merged
 * state, so every device repairs it the same way, and they never write: the next edit carries on
 * from the repaired view.
 */
export function repair<S extends Snapshot>(snapshot: S): { snapshot: S; repairs: string[] } {
  const s = structuredClone(snapshot)
  const nodes = new Map(Object.entries(s.nodes) as [string, NodeJson][])
  const repairs: string[] = []
  const firstPage = Object.entries(s.pages).sort(([a, x], [b, y]) => orderOf(x).localeCompare(orderOf(y)) || a.localeCompare(b))[0]?.[0]
  const containers = new Set(['frame', 'group'])

  const ids = [...nodes.keys()].sort()
  for (const id of ids) {
    const node = nodes.get(id) as NodeJson
    // Undoing a move after another tab moved the same layer can leave its parent and index unset.
    if (typeof node.type !== 'string' || typeof node.props !== 'object') {
      repairs.push(`dropped "${id}", which lost its type or props`)
      nodes.delete(id)
      continue
    }
    if (typeof node.index !== 'string') {
      repairs.push(`"${id}" lost its index; put at the back`)
      node.index = 'a0'
    }
    const parent = nodes.get(node.parentId)
    if (!s.pages[node.parentId] && (!parent || !containers.has(String(parent.type))) && firstPage) {
      repairs.push(`"${id}" lost its parent "${node.parentId}"; moved to page "${firstPage}"`)
      node.parentId = firstPage
    }
  }

  // Break each cycle at its smallest id, so all devices pick the same layer.
  for (const id of [...nodes.keys()].sort()) {
    const path: string[] = []
    for (let up: string | undefined = id; up && nodes.has(up); up = nodes.get(up)?.parentId) {
      const at = path.indexOf(up)
      if (at !== -1) {
        const breakAt = path.slice(at).sort()[0] as string
        repairs.push(`"${breakAt}" was inside itself; moved to page "${firstPage}"`)
        ;(nodes.get(breakAt) as NodeJson).parentId = firstPage ?? ''
        break
      }
      path.push(up)
    }
  }

  const overrides = Object.fromEntries(Object.entries(s.overrides).map(([scope, byNode]) => [scope, Object.fromEntries(
    Object.entries(byNode as Json).filter(([id]) => {
      if (nodes.has(id)) return true
      repairs.push(`dropped ${scope} overrides of deleted layer "${id}"`)
      return false
    }),
  )]))
  return { snapshot: { ...s, nodes: Object.fromEntries(nodes), overrides }, repairs }
}
