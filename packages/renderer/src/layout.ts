// Auto layout (#46), solved while a scene is built so the editor, exports and the server lay out
// alike, per format. A frame with `layout` places the children in its flow, in a row or a column,
// sizing each one fixed, hugging what it holds or filling the room left; children marked
// `absolute` stay where they are put. Boxes stay in page space and unturned: a turned frame turns
// its laid-out children about its centre when drawn, as it does any child.
import type { SceneLayer } from './scene.ts'

type TextProps = Extract<SceneLayer, { type: 'text' }>['props']
type FrameLayer = Extract<SceneLayer, { type: 'frame' }>
type Size = { width: number; height: number }
type Sizing = 'fixed' | 'hug' | 'fill'

/**
 * Measures a text layer as it would draw: with `width` null, its natural width (each paragraph
 * on one line) and the height that gives; otherwise its height when laid out `width` wide.
 */
export type MeasureText = (props: TextProps, width: number | null) => Size

/** How a layer sizes on each axis. Left unsaid, text hugs as its box mode says, and the rest is fixed. */
export function sizingOf(layer: SceneLayer): { width: Sizing; height: Sizing } {
  if (layer.props.sizing) return layer.props.sizing
  if (layer.type === 'text') return { width: layer.props.boxMode === 'autoWidth' ? 'hug' : 'fixed', height: layer.props.boxMode === 'fixed' ? 'fixed' : 'hug' }
  return { width: 'fixed', height: 'fixed' }
}

const hasLayout = (layer: SceneLayer): layer is FrameLayer & { props: { layout: NonNullable<FrameLayer['props']['layout']> } } =>
  layer.type === 'frame' && layer.props.layout !== undefined

/** Moves a layer and everything inside it. */
function shift(layer: SceneLayer, dx: number, dy: number): SceneLayer {
  if (dx === 0 && dy === 0) return layer
  return { ...layer, props: { ...layer.props, x: layer.props.x + dx, y: layer.props.y + dy }, children: layer.children.map((c) => shift(c, dx, dy)) } as SceneLayer
}

/** Layers solved before, by the layer as built and the measure used, so an unchanged frame is laid out once. */
const solved = new WeakMap<SceneLayer, { measure: MeasureText | undefined; layer: SceneLayer }>()

/** Lays out every auto layout frame among `layers` and inside them; layers with none inside come back as they were. */
export function applyLayout(layers: SceneLayer[], measure?: MeasureText): SceneLayer[] {
  let changed = false
  const next = layers.map((layer) => {
    const out = layoutOne(layer, measure)
    if (out !== layer) changed = true
    return out
  })
  return changed ? next : layers
}

function layoutOne(layer: SceneLayer, measure?: MeasureText): SceneLayer {
  const before = solved.get(layer)
  if (before && before.measure === measure) return before.layer
  let out: SceneLayer
  if (hasLayout(layer)) {
    out = solveFrame(layer, {}, measure)
  } else {
    const children = applyLayout(layer.children, measure)
    out = children === layer.children ? layer : ({ ...layer, children } as SceneLayer)
  }
  solved.set(layer, { measure, layer: out })
  return out
}

/** A text layer's size where it hugs: natural, or at the width it was given. */
function textSize(layer: Extract<SceneLayer, { type: 'text' }>, width: number | null, measure?: MeasureText): Size {
  if (!measure) return { width: width ?? layer.props.width, height: layer.props.height }
  return measure(layer.props, width)
}

/**
 * A layer placed by its frame at a box: an auto layout frame laid out at that size, text at its
 * width, and any other layer moved there with what it holds (a group or plain frame keeps its
 * own size: only auto layout reaches inside).
 */
function place(layer: SceneLayer, box: { x: number; y: number; width: number; height: number }, measure?: MeasureText): SceneLayer {
  if (hasLayout(layer)) return solveFrame({ ...layer, props: { ...layer.props, x: box.x, y: box.y } }, { width: box.width, height: box.height }, measure)
  const moved = shift(layer, box.x - layer.props.x, box.y - layer.props.y)
  const resized = layer.type === 'group' ? moved : ({ ...moved, props: { ...moved.props, width: box.width, height: box.height } } as SceneLayer)
  return { ...resized, children: applyLayout(resized.children, measure) } as SceneLayer
}

interface Item { layer: SceneLayer; width: number; height: number; fillMain: boolean; fillCross: boolean }

/**
 * Lays out an auto layout frame: its own size where `given` says (its parent's flow decided it)
 * or where it hugs, then each child's size and place. Returns the frame with its new size and
 * children; absolute children are only laid out inside.
 */
function solveFrame(frame: FrameLayer & { props: { layout: NonNullable<FrameLayer['props']['layout']> } }, given: Partial<Size>, measure?: MeasureText): SceneLayer {
  const { layout } = frame.props
  const { padding: pad } = layout
  const row = layout.direction === 'row'
  const own = sizingOf(frame)
  const hugW = given.width === undefined && own.width === 'hug'
  const hugH = given.height === undefined && own.height === 'hug'
  let width = given.width ?? frame.props.width
  let height = given.height ?? frame.props.height
  const hugMain = row ? hugW : hugH
  const hugCross = row ? hugH : hugW
  const padMain = row ? pad.left + pad.right : pad.top + pad.bottom
  const padCross = row ? pad.top + pad.bottom : pad.left + pad.right
  const innerCross = () => (row ? height : width) - padCross

  // Each child's size: widths first, since text that hugs its height needs its width.
  const flow = frame.children.filter((c) => !c.props.absolute)
  const items: Item[] = flow.map((layer) => {
    const s = sizingOf(layer)
    const fillW = s.width === 'fill' && !(row ? hugMain : hugCross)
    const fillH = s.height === 'fill' && !(row ? hugCross : hugMain)
    const natural = () => {
      if (layer.type === 'text') return textSize(layer, s.width === 'hug' ? null : layer.props.width, measure)
      if (hasLayout(layer)) {
        const inner = solveFrame(layer, {}, measure)
        return { width: inner.props.width, height: inner.props.height }
      }
      return { width: layer.props.width, height: layer.props.height }
    }
    const n = s.width === 'hug' || s.height === 'hug' ? natural() : null
    const w = s.width === 'hug' && n ? n.width : layer.props.width
    let h = s.height === 'hug' && n ? n.height : layer.props.height
    // Text that hugs its height at a width set otherwise is measured at that width.
    if (layer.type === 'text' && s.height === 'hug' && s.width !== 'hug') h = textSize(layer, w, measure).height
    return { layer, width: w, height: h, fillMain: row ? fillW : fillH, fillCross: row ? fillH : fillW }
  })
  const mainOf = (i: Item) => (row ? i.width : i.height)
  const crossOf = (i: Item) => (row ? i.height : i.width)
  const setMain = (i: Item, v: number) => { if (row) i.width = v; else i.height = v }
  const setCross = (i: Item, v: number) => { if (row) i.height = v; else i.width = v }

  // Lines: one, or as many as wrapping takes at the frame's size along the flow.
  const innerMain = () => (row ? width : height) - padMain
  const lines: Item[][] = []
  if (layout.wrap && !hugMain) {
    let line: Item[] = []
    let used = 0
    for (const item of items) {
      const add = (line.length > 0 ? layout.gap : 0) + mainOf(item)
      if (line.length > 0 && used + add > innerMain() + 1e-6) {
        lines.push(line)
        line = []
        used = 0
      }
      used += (line.length > 0 ? layout.gap : 0) + mainOf(item)
      line.push(item)
    }
    if (line.length > 0) lines.push(line)
  } else {
    lines.push(items)
  }

  // Fill across the flow takes the line's room: the frame's, or the tallest in a wrapped line.
  // Text whose width that sets hugs its height at it. Known up front for one line in a frame
  // that doesn't hug across, so a column can hug text that wraps at the width it fills.
  const lineCross = (line: Item[]) => Math.max(0, ...line.filter((i) => !i.fillCross).map(crossOf))
  const fillAcross = (line: Item[], room: number) => {
    for (const i of line) {
      if (!i.fillCross) continue
      setCross(i, Math.max(0, room))
      if (i.layer.type === 'text' && !row && sizingOf(i.layer).height === 'hug') i.height = textSize(i.layer, i.width, measure).height
    }
  }
  const crossKnown = lines.length === 1 && !hugCross
  if (crossKnown) fillAcross(items, innerCross())

  // Fill along the flow shares what each line leaves; a wrapped line's fill children keep their size.
  if (!layout.wrap) {
    for (const line of lines) {
      const fills = line.filter((i) => i.fillMain)
      if (fills.length === 0) continue
      const fixed = line.filter((i) => !i.fillMain).reduce((sum, i) => sum + mainOf(i), 0)
      const share = Math.max(0, (innerMain() - fixed - layout.gap * (line.length - 1)) / fills.length)
      for (const i of fills) setMain(i, share)
    }
  }
  // Text whose width was just filled hugs its height at that width.
  for (const i of items) {
    if (i.layer.type === 'text' && row && i.fillMain && sizingOf(i.layer).height === 'hug') i.height = textSize(i.layer, i.width, measure).height
  }

  const lineMain = (line: Item[]) => line.reduce((sum, i) => sum + mainOf(i), 0) + layout.gap * Math.max(0, line.length - 1)
  if (hugMain) {
    const main = Math.max(0, ...lines.map(lineMain)) + padMain
    if (row) width = main
    else height = main
  }
  if (hugCross) {
    const cross = lines.reduce((sum, line) => sum + lineCross(line), 0) + layout.lineGap * Math.max(0, lines.length - 1) + padCross
    if (row) height = cross
    else width = cross
  }
  if (!crossKnown) for (const line of lines) fillAcross(line, lines.length === 1 ? innerCross() : lineCross(line))

  // Places: along the flow by justify, across it by align, line after line.
  const placed = new Map<SceneLayer, SceneLayer>()
  const startMain = (row ? frame.props.x + pad.left : frame.props.y + pad.top)
  let crossAt = row ? frame.props.y + pad.top : frame.props.x + pad.left
  for (const line of lines) {
    const used = lineMain(line)
    const free = innerMain() - used
    let gap = layout.gap
    let at = startMain
    if (layout.justify === 'center') at += free / 2
    else if (layout.justify === 'end') at += free
    else if (layout.justify === 'space-between' && line.length > 1) gap = layout.gap + free / (line.length - 1)
    const room = lines.length === 1 ? innerCross() : lineCross(line)
    for (const i of line) {
      const spare = room - crossOf(i)
      const across = crossAt + (layout.align === 'center' ? spare / 2 : layout.align === 'end' ? spare : 0)
      const box = row ? { x: at, y: across, width: i.width, height: i.height } : { x: across, y: at, width: i.width, height: i.height }
      placed.set(i.layer, place(i.layer, box, measure))
      at += mainOf(i) + gap
    }
    crossAt += room + layout.lineGap
  }

  const children = frame.children.map((c) => placed.get(c) ?? ({ ...c, children: applyLayout(c.children, measure) } as SceneLayer))
  return { ...frame, props: { ...frame.props, width, height }, children } as SceneLayer
}
