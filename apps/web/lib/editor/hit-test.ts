import type { SceneLayer } from '@razzlr/renderer'

export interface Point { x: number; y: number }

/** The point as seen from inside a layer: un-rotated about the layer's centre. */
function unrotate(p: Point, layer: SceneLayer): Point {
  const { x, y, width, height, rotation } = layer.props
  if (rotation === 0) return p
  const cx = x + width / 2
  const cy = y + height / 2
  const a = (-rotation * Math.PI) / 180
  const dx = p.x - cx
  const dy = p.y - cy
  return { x: cx + dx * Math.cos(a) - dy * Math.sin(a), y: cy + dx * Math.sin(a) + dy * Math.cos(a) }
}

const inside = (p: Point, layer: SceneLayer) => {
  const { x, y, width, height } = layer.props
  return p.x >= x && p.x <= x + width && p.y >= y && p.y <= y + height
}

/**
 * The topmost layer under a page point, by layer boxes. Clicking inside a group or frame picks
 * the child under the point, so the spike can move single layers; a clipping frame hides what
 * lies outside it.
 */
export function hitTest(layers: SceneLayer[], p: Point): SceneLayer | null {
  for (const layer of [...layers].reverse()) {
    const q = unrotate(p, layer)
    if (layer.type === 'frame' || layer.type === 'group') {
      if (layer.type === 'frame' && layer.props.clip && !inside(q, layer)) continue
      const child = hitTest(layer.children, q)
      if (child) return child
      if (layer.type === 'frame' && inside(q, layer)) return layer
      continue
    }
    if (inside(q, layer)) return layer
  }
  return null
}
