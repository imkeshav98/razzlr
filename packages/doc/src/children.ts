import type { Design, Layer } from '@dazbee/schema'

/** The ids of the layers directly under a page or layer, back to front. */
export type ChildIndex = (parentId: string) => readonly string[]

/** Code-unit order, the same on every device (unlike localeCompare) and the order fractional indexes use. */
const byCodeUnits = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)

/** Ties in index break by id, the same on every device. */
export const siblingOrder = (nodes: Readonly<Record<string, Layer>> | ReadonlyMap<string, Layer>) => {
  const get = (id: string) => (nodes instanceof Map ? nodes.get(id) : (nodes as Record<string, Layer>)[id])
  return (a: string, b: string) => byCodeUnits(get(a)?.index ?? '', get(b)?.index ?? '') || byCodeUnits(a, b)
}

/** Every parent's children, sorted, from a set of layers. */
export function buildChildIndex(nodes: ReadonlyMap<string, Layer>): Map<string, string[]> {
  const index = new Map<string, string[]>()
  for (const [id, node] of nodes) {
    const list = index.get(node.parentId)
    if (list) list.push(id)
    else index.set(node.parentId, [id])
  }
  const order = siblingOrder(nodes)
  for (const list of index.values()) list.sort(order)
  return index
}

/** Child indexes by a design's `nodes` object. A design's layers are never changed in place, so an index stays right. */
const indexes = new WeakMap<object, ChildIndex>()

/** Lets a design that keeps its own index (the live design view) hand it out instead of having one built. */
export function registerChildIndex(nodes: object, index: ChildIndex) {
  indexes.set(nodes, index)
}

/** The layers directly under a page or layer, back to front. Ties in index break by id, the same on every device. */
export function childrenOf(design: Design, parentId: string): [string, Layer][] {
  let index = indexes.get(design.nodes)
  if (!index) {
    const built = buildChildIndex(new Map(Object.entries(design.nodes)))
    index = (id) => built.get(id) ?? []
    indexes.set(design.nodes, index)
  }
  return index(parentId).map((id) => [id, design.nodes[id] as Layer])
}
