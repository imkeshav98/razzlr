import { parseDesign, type Design } from '@razzlr/schema'
import * as Y from 'yjs'
import { repair } from './repair.ts'

/**
 * How a design lives in a Y.Doc (ADR-0003). Every map is a Y.Map so each key merges on its own:
 *
 *   meta       Y.Map<key, value>
 *   formats    Y.Map<FormatId, Y.Map<key, value>>
 *   pages      Y.Map<PageId, Y.Map<key, value>>
 *   nodes      Y.Map<NodeId, Y.Map>   type, parentId, index, name, role?, props: Y.Map<path, value>
 *                                     a text layer's `text` prop is a Y.Text whose formatting holds its runs
 *   overrides  Y.Map<"scope|nodeId|path", value>   flat, so two tabs overriding in a new scope never
 *                                                race to create the same nested map
 *
 * Deleted layers keep their Y.Map with `deleted: true`. Removing the map would make undo restore
 * it without the edits another tab made to it in the meantime, leaving required keys unset.
 */
export const DELETED = 'deleted'
export type DesignDoc = Y.Doc

type Json = Record<string, unknown>

export const root = (doc: DesignDoc) => ({
  meta: doc.getMap<unknown>('meta'),
  formats: doc.getMap<Y.Map<unknown>>('formats'),
  pages: doc.getMap<Y.Map<unknown>>('pages'),
  nodes: doc.getMap<Y.Map<unknown>>('nodes'),
  overrides: doc.getMap<unknown>('overrides'),
})

const SEP = '|'
export const overrideKey = (scope: string, nodeId: string, path: string) => [scope, nodeId, path].join(SEP)
const splitOverrideKey = (key: string) => {
  const [scope = '', nodeId = '', ...path] = key.split(SEP)
  return { scope, nodeId, path: path.join(SEP) }
}

export const toYMap = (json: Json) => {
  const map = new Y.Map<unknown>()
  for (const [k, v] of Object.entries(json)) if (v !== undefined) map.set(k, v)
  return map
}

/** A text layer's text and style runs as one Y.Text: run styles become formatting attributes. */
export function toYText(text: string, runs: { start: number; end: number; style: Json }[]) {
  const ytext = new Y.Text()
  ytext.insert(0, text)
  for (const run of runs) ytext.format(run.start, run.end - run.start, run.style)
  return ytext
}

/** The reverse of toYText. Adjacent ranges with the same style come back as one run. */
export function fromYText(ytext: Y.Text) {
  const runs: { start: number; end: number; style: Json }[] = []
  let at = 0
  for (const op of ytext.toDelta() as { insert: string; attributes?: Json }[]) {
    const end = at + op.insert.length
    if (op.attributes && Object.keys(op.attributes).length > 0) runs.push({ start: at, end, style: { ...op.attributes } })
    at = end
  }
  return { text: ytext.toString(), runs }
}

export function toYNode(node: Design['nodes'][string]) {
  const { props, ...rest } = node
  const ynode = toYMap(rest)
  const yprops = new Y.Map<unknown>()
  for (const [path, value] of Object.entries(props)) {
    if (node.type === 'text' && path === 'runs') continue
    if (node.type === 'text' && path === 'text') yprops.set('text', toYText(node.props.text, node.props.runs))
    else yprops.set(path, value)
  }
  ynode.set('props', yprops)
  return ynode
}

/** Writes a whole design into an empty doc in one transaction. */
export function loadDesign(design: Design, doc: DesignDoc = new Y.Doc()): DesignDoc {
  const r = root(doc)
  doc.transact(() => {
    for (const [k, v] of Object.entries(design.meta)) r.meta.set(k, v)
    for (const [id, f] of Object.entries(design.formats)) r.formats.set(id, toYMap(f))
    for (const [id, p] of Object.entries(design.pages)) r.pages.set(id, toYMap(p))
    for (const [id, n] of Object.entries(design.nodes)) r.nodes.set(id, toYNode(n))
    for (const [scope, byNode] of Object.entries(design.overrides)) {
      for (const [nodeId, props] of Object.entries(byNode)) {
        for (const [path, value] of Object.entries(props)) r.overrides.set(overrideKey(scope, nodeId, path), value)
      }
    }
  })
  return doc
}

function nodeToJson(ynode: Y.Map<unknown>): Json {
  const json: Json = {}
  for (const [k, v] of ynode.entries()) {
    if (k !== 'props' && k !== DELETED) json[k] = v
  }
  const props: Json = {}
  const yprops = ynode.get('props')
  if (!(yprops instanceof Y.Map)) return json
  for (const [path, value] of yprops.entries()) {
    if (value instanceof Y.Text) Object.assign(props, fromYText(value))
    else props[path] = value
  }
  json.props = props
  return json
}

/** The doc as plain JSON, before validation. */
export function snapshot(doc: DesignDoc) {
  const r = root(doc)
  const mapOf = <T>(m: Y.Map<T>, f: (v: T) => unknown) => Object.fromEntries([...m.entries()].map(([k, v]) => [k, f(v)]))
  return {
    meta: r.meta.toJSON(),
    formats: mapOf(r.formats, (f) => f.toJSON()),
    pages: mapOf(r.pages, (p) => p.toJSON()),
    nodes: Object.fromEntries([...r.nodes.entries()].filter(([, n]) => n.get(DELETED) !== true).map(([id, n]) => [id, nodeToJson(n)])),
    overrides: nestOverrides(r.overrides),
  }
}

function nestOverrides(flat: Y.Map<unknown>) {
  const nested: Record<string, Record<string, Json>> = {}
  for (const [key, value] of flat.entries()) {
    const { scope, nodeId, path } = splitOverrideKey(key)
    ;((nested[scope] ??= {})[nodeId] ??= {})[path] = value
  }
  return nested
}

/**
 * Reads the doc as a validated design, after repairing what concurrent edits can break
 * (see repair.ts). A doc that still fails validation is a bug in a command, so this throws.
 */
export function readDesign(doc: DesignDoc, onRepair?: (repairs: string[]) => void): Design {
  const repaired = repair(snapshot(doc))
  if (repaired.repairs.length > 0) onRepair?.(repaired.repairs)
  const result = parseDesign(repaired.snapshot)
  if (!result.success) throw new Error(`design document is invalid:\n${result.errors.join('\n')}`)
  return result.design
}
