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

/** How near a line a click picks it, in design pixels, beyond half its stroke. */
const LINE_REACH = 4

const inside = (p: Point, layer: SceneLayer) => {
  const { x, y, width, height } = layer.props
  if (layer.type === 'graphic' && layer.props.shape.kind === 'line') {
    // A line is often no taller than nothing: it is picked near it, not only inside its box.
    const reach = Math.max(height / 2, ...layer.props.strokes.map((s) => s.width / 2)) + LINE_REACH
    return p.x >= x && p.x <= x + width && Math.abs(p.y - (y + height / 2)) <= reach
  }
  if (layer.type === 'graphic' && layer.props.shape.kind === 'path') {
    // A path can be a stroke alone, as thin as a line: it is picked near its box too (#45).
    const reach = Math.max(0, ...layer.props.strokes.map((s) => s.width / 2)) + LINE_REACH
    return p.x >= x - reach && p.x <= x + width + reach && p.y >= y - reach && p.y <= y + height + reach
  }
  return p.x >= x && p.x <= x + width && p.y >= y && p.y <= y + height
}

/**
 * The topmost layer under a page point, by layer boxes. Clicking inside a group, frame or boolean picks
 * the child under the point, so the spike can move single layers; a clipping frame hides what
 * lies outside it. A layer that isn't `pickable` (locked) is passed over with everything in it,
 * so the click reaches what lies beneath.
 */
export function hitTest(layers: SceneLayer[], p: Point, pickable: (layer: SceneLayer) => boolean = () => true): SceneLayer | null {
  for (const layer of [...layers].reverse()) {
    if (!pickable(layer)) continue
    const q = unrotate(p, layer)
    if (layer.type === 'frame' || layer.type === 'group' || layer.type === 'boolean') {
      if (layer.type === 'frame' && layer.props.clip && !inside(q, layer)) continue
      const child = hitTest(layer.children, q, pickable)
      if (child) return child
      if (layer.type === 'frame' && inside(q, layer)) return layer
      continue
    }
    if (inside(q, layer)) return layer
  }
  return null
}
