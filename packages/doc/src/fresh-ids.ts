// A copy of a design that shares no ids with it (#54): every format, page and layer gets a new id,
// and everything naming them (parents, the primary format, overrides) follows. Starting a design
// from a template makes one, so the two never collide when layers are copied between them.
import type { Design } from '@dazbee/schema'
import { nanoid } from 'nanoid'

export function withFreshIds(design: Design, newId: () => string = nanoid): Design {
  const fresh = (ids: string[]) => new Map(ids.map((id) => [id, newId()]))
  const formats = fresh(Object.keys(design.formats))
  const pages = fresh(Object.keys(design.pages))
  const nodes = fresh(Object.keys(design.nodes))
  const to = (map: Map<string, string>, id: string) => map.get(id) ?? id
  const rekey = <T>(record: Record<string, T>, map: Map<string, string>, value: (v: T) => T = (v) => v) =>
    Object.fromEntries(Object.entries(record).map(([id, v]) => [to(map, id), value(v)]))
  return {
    ...design,
    meta: { ...design.meta, primaryFormatId: to(formats, design.meta.primaryFormatId) },
    formats: rekey(design.formats, formats),
    pages: rekey(design.pages, pages),
    nodes: rekey(design.nodes, nodes, (node) => ({ ...node, parentId: pages.get(node.parentId) ?? to(nodes, node.parentId) })),
    overrides: Object.fromEntries(Object.entries(design.overrides).map(([scope, byNode]) => {
      const formatId = /^format:(.+)$/.exec(scope)?.[1]
      return [formatId ? `format:${to(formats, formatId)}` : scope, rekey(byNode, nodes)]
    })),
  }
}
