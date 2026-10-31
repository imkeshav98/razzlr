import { childrenOf } from '@razzlr/doc'
import { bindProps, type Design, type Layer, type Paint, type Variables } from '@razzlr/schema'
import { applyLayout, type MeasureText } from './layout.ts'

/** One layer as a scene draws it: its props with the format's overrides applied, and its visible children. */
export type SceneLayer = {
  [T in Layer['type']]: { id: string; type: T; props: Extract<Layer, { type: T }>['props']; children: SceneLayer[] }
}[Layer['type']]

/**
 * A resolved tree for one page and format, ready to draw on any surface.
 * Positions are in page space: a layer inside a frame or group keeps its own page coordinates,
 * and a container's rotation turns its children about the container's centre.
 */
export interface Scene {
  pageId: string
  formatId: string
  width: number
  height: number
  fills: Paint[]
  layers: SceneLayer[]
}

/**
 * The scene layers built before, by format and node, for the editor (#36): with it, `render` hands
 * back the same layer object while its node, its override in the format and its children are the
 * same objects, so a cache can know an unchanged layer by identity alone.
 */
export type SceneMemo = Map<string, WeakMap<object, { override: unknown; variables: Variables | undefined; layer: SceneLayer }>>
export const sceneMemo = (): SceneMemo => new Map()

const sameLayers = (a: SceneLayer[], b: SceneLayer[]) => a.length === b.length && a.every((layer, i) => layer === b[i])

/**
 * Builds the scene for one page in one format, auto layout solved (#46). Pure: the design is only
 * read. Without `measure`, text in an auto layout keeps the size its box says. Bound properties take
 * their values from `variables`, the brand kit's (#53), or stay as stored without one.
 */
export function render(design: Design, pageId: string, formatId: string, memo?: SceneMemo, measure?: MeasureText, variables?: Variables): Scene {
  const page = design.pages[pageId]
  if (!page) throw new Error(`no page "${pageId}"`)
  const format = design.formats[formatId]
  if (!format) throw new Error(`no format "${formatId}"`)
  const overrides = design.overrides[`format:${formatId}`] ?? {}
  let built = memo?.get(formatId)
  if (memo && !built) memo.set(formatId, (built = new WeakMap()))

  const layersUnder = (parentId: string): SceneLayer[] =>
    childrenOf(design, parentId).flatMap(([id, node]) => {
      const override = overrides[id]
      const props = { ...node.props, ...override }
      if (!props.visible) return []
      const children = layersUnder(id)
      // Only a bound layer depends on the variables, so a brand change rebuilds only those.
      const used = node.bindings ? variables : undefined
      const before = built?.get(node)
      if (before && before.override === override && before.variables === used && before.layer.id === id && sameLayers(before.layer.children, children)) return [before.layer]
      const layer = { id, type: node.type, props: bindProps(node.type, props, node.bindings, used), children } as SceneLayer
      built?.set(node, { override, variables: used, layer })
      return [layer]
    })

  return { pageId, formatId, width: format.width, height: format.height, fills: page.fills, layers: applyLayout(layersUnder(pageId), measure) }
}
