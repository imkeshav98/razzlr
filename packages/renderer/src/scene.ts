import { childrenOf } from '@razzlr/doc'
import type { Design, Layer, Paint } from '@razzlr/schema'

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

/** Builds the scene for one page in one format. Pure: the design is only read. */
export function render(design: Design, pageId: string, formatId: string): Scene {
  const page = design.pages[pageId]
  if (!page) throw new Error(`no page "${pageId}"`)
  const format = design.formats[formatId]
  if (!format) throw new Error(`no format "${formatId}"`)
  const overrides = design.overrides[`format:${formatId}`] ?? {}

  const layersUnder = (parentId: string): SceneLayer[] =>
    childrenOf(design, parentId).flatMap(([id, node]) => {
      const props = { ...node.props, ...overrides[id] }
      if (!props.visible) return []
      return [{ id, type: node.type, props, children: layersUnder(id) } as SceneLayer]
    })

  return { pageId, formatId, width: format.width, height: format.height, fills: page.fills, layers: layersUnder(pageId) }
}
