import { migrateDesign, SCHEMA_VERSION } from '@dazbee/schema'
import * as Y from 'yjs'
import { nodeToJson, overrideKey, root, splitOverrideKey, type DesignDoc } from './design-doc.ts'

type Json = Record<string, unknown>
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

/** Marks the migration's writes, which no tab's undo holds. */
export const MIGRATION_ORIGIN = { migration: true }

/**
 * Brings a document saved at an older schema version up to SCHEMA_VERSION (#43), writing only
 * the values the migration changes, in one transaction no undo step holds. Every tab that opens
 * the document runs it before its first command; tabs that do so at once write the same values,
 * so they merge to one result. Deleted layers are migrated too, so undoing a delete brings back
 * a layer at the current version. Returns whether it wrote anything.
 *
 * Like the restore after undo in session.ts, this is a write outside a command (ADR-0004): it
 * changes no design, only how the document says the same design.
 */
export function migrateDoc(doc: DesignDoc): boolean {
  const r = root(doc)
  const version = r.meta.get('schemaVersion')
  if (typeof version !== 'number' || version >= SCHEMA_VERSION) return false
  const nested: Record<string, Record<string, Json>> = {}
  for (const [key, value] of r.overrides.entries()) {
    const { scope, nodeId, path } = splitOverrideKey(key)
    const byNode = (nested[scope] ??= {})
    const values = (byNode[nodeId] ??= {})
    Object.defineProperty(values, path, { value, enumerable: true, writable: true, configurable: true })
  }
  const before = {
    meta: r.meta.toJSON(),
    nodes: Object.fromEntries([...r.nodes.entries()].map(([id, n]) => [id, nodeToJson(n)])),
    overrides: nested,
  }
  const after = migrateDesign(before) as typeof before
  if (after === before) return false
  doc.transact(() => {
    for (const [key, value] of Object.entries(after.meta)) if (!same(value, before.meta[key])) r.meta.set(key, value)
    for (const [id, node] of Object.entries(after.nodes)) {
      const props = r.nodes.get(id)?.get('props')
      const was = before.nodes[id]?.props as Json | undefined
      if (!(props instanceof Y.Map) || !was) continue
      for (const [path, value] of Object.entries(node.props as Json)) {
        // A text layer's text and runs live in its Y.Text, which no migration changes.
        if (path === 'text' || path === 'runs' || same(value, was[path])) continue
        props.set(path, value)
      }
    }
    for (const [scope, byNode] of Object.entries(after.overrides)) {
      for (const [nodeId, values] of Object.entries(byNode)) {
        for (const [path, value] of Object.entries(values)) {
          if (!same(value, nested[scope]?.[nodeId]?.[path])) r.overrides.set(overrideKey(scope, nodeId, path), value)
        }
      }
    }
  }, MIGRATION_ORIGIN)
  return true
}
