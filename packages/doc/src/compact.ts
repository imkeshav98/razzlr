import { DELETED, root, splitOverrideKey, type DesignDoc } from './design-doc.ts'

/** The origin of compaction's transaction, so a server can tell it from an edit. */
export const COMPACTION = 'compaction'

/**
 * Drops what only an undo could still need (#57): the maps deleted layers keep (see DELETED) and
 * every override of a layer that is gone. Undo is per session, so this is safe only with nobody
 * connected. With the doc's garbage collection on, what is dropped shrinks to a few ranges.
 * Returns how many layers and overrides went.
 */
export function compact(doc: DesignDoc): { layers: number; overrides: number } {
  const r = root(doc)
  const gone = [...r.nodes.entries()].filter(([, node]) => node.get(DELETED) === true).map(([id]) => id)
  const live = new Set([...r.nodes.keys()].filter((id) => r.nodes.get(id)?.get(DELETED) !== true))
  const stale = [...r.overrides.keys()].filter((key) => !live.has(splitOverrideKey(key).nodeId))
  if (gone.length > 0 || stale.length > 0) {
    doc.transact(() => {
      for (const id of gone) r.nodes.delete(id)
      for (const key of stale) r.overrides.delete(key)
    }, COMPACTION)
  }
  return { layers: gone.length, overrides: stale.length }
}
