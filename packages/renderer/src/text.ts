import type { CanvasKit, Paragraph, TextStyle as CkTextStyle } from 'canvaskit-wasm'
import { color } from './color.ts'
import type { Resources } from './draw.ts'
import type { SceneLayer } from './scene.ts'

type TextProps = Extract<SceneLayer, { type: 'text' }>['props']

/** Hebrew, Arabic, Syriac, Thaana, NKo, their presentation forms, and the right-to-left blocks beyond the BMP. */
const RTL_CHAR = /[\u0590-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFF\u{10800}-\u{10FFF}\u{1E800}-\u{1EFFF}]/u
const STRONG_CHAR = /[\p{L}]/u

/**
 * Shapes and lays out a text layer: the one paragraph both drawing and editing use, so the caret
 * sits on the glyphs that are drawn. The paragraph's origin is the layer's (x, y + dy).
 * The caller deletes the paragraph.
 */
export function layoutText(ck: CanvasKit, props: TextProps, resources: Pick<Resources, 'fonts' | 'fallbackFamilies'>): { paragraph: Paragraph; dy: number } {
  const direction = props.direction === 'auto' ? autoDirection(props.text) : props.direction
  const builder = ck.ParagraphBuilder.MakeFromFontCollection(new ck.ParagraphStyle({
    textAlign: { start: ck.TextAlign.Start, center: ck.TextAlign.Center, end: ck.TextAlign.End, justify: ck.TextAlign.Justify }[props.align],
    textDirection: direction === 'rtl' ? ck.TextDirection.RTL : ck.TextDirection.LTR,
    textStyle: textStyle(ck, props.style, resources),
  }), resources.fonts)

  // Later runs win where runs overlap, so split the text at every run edge and merge per piece.
  const edges = [...new Set([0, props.text.length, ...props.runs.flatMap((r) => [r.start, r.end])])].sort((a, b) => a - b)
  for (const [i, start] of edges.slice(0, -1).entries()) {
    const end = edges[i + 1] ?? props.text.length
    const style = { ...props.style }
    for (const run of props.runs) if (run.start <= start && run.end >= end) Object.assign(style, run.style)
    builder.pushStyle(textStyle(ck, style, resources))
    builder.addText(props.text.slice(start, end))
    builder.pop()
  }
  const paragraph = builder.build()
  builder.delete()

  paragraph.layout(props.boxMode === 'autoWidth' ? Number.POSITIVE_INFINITY : props.width)
  if (props.boxMode === 'autoWidth') paragraph.layout(Math.ceil(paragraph.getMaxIntrinsicWidth()))
  const free = props.boxMode === 'fixed' ? props.height - paragraph.getHeight() : 0
  const dy = { top: 0, middle: free / 2, bottom: free }[props.verticalAlign]
  return { paragraph, dy }
}

function textStyle(ck: CanvasKit, style: TextProps['style'], resources: Pick<Resources, 'fallbackFamilies'>): CkTextStyle {
  return new ck.TextStyle({
    color: color(ck, style.color),
    fontFamilies: [style.fontFamily, ...resources.fallbackFamilies.filter((f) => f !== style.fontFamily)],
    fontSize: style.fontSize,
    fontStyle: {
      weight: { value: style.fontWeight },
      slant: style.fontStyle === 'italic' ? ck.FontSlant.Italic : ck.FontSlant.Upright,
    },
    letterSpacing: style.letterSpacing,
    ...(style.lineHeight === undefined ? {} : { heightMultiplier: style.lineHeight, halfLeading: true }),
  })
}

/** The direction of the first strong character, as the Unicode bidi algorithm picks a paragraph's direction. */
function autoDirection(text: string): 'ltr' | 'rtl' {
  for (const ch of text) if (STRONG_CHAR.test(ch)) return RTL_CHAR.test(ch) ? 'rtl' : 'ltr'
  return 'ltr'
}

const graphemeSegmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' })

interface GraphemeBox extends SelectionBox { start: number; end: number; line: number }

/** Every grapheme's box, measured once per paragraph: a drag asks for the caret every frame. */
const graphemeBoxes = new WeakMap<Paragraph, GraphemeBox[]>()

function boxesOf(ck: CanvasKit, paragraph: Paragraph, text: string): GraphemeBox[] {
  let boxes = graphemeBoxes.get(paragraph)
  if (!boxes) {
    // getLineNumberAt answers 0 for every offset in CanvasKit 0.42, so lines come from their metrics.
    const lines = paragraph.getLineMetrics()
    boxes = [...graphemeSegmenter.segment(text)].flatMap((g) => {
      const end = g.index + g.segment.length
      const line = lines.find((l) => g.index >= l.startIndex && g.index < l.endIndex)?.lineNumber ?? -1
      return selectionBoxes(ck, paragraph, g.index, end).map((box) => ({ ...box, start: g.index, end, line }))
    })
    graphemeBoxes.set(paragraph, boxes)
  }
  return boxes
}

/**
 * The text offset a click lands on, in the paragraph's own coordinates: the line under the click
 * (or the nearest one), then the grapheme on it nearest the click, then that grapheme's near edge
 * by its own direction. Graphemes are Unicode's (Intl.Segmenter), and the hit-test uses their
 * boxes rather than SkParagraph's glyph lookup, which sends a click on a Devanagari reph to the
 * wrong grapheme.
 */
export function caretAt(ck: CanvasKit, paragraph: Paragraph, text: string, x: number, y: number): number {
  const lines = paragraph.getLineMetrics()
  if (lines.length === 0) return 0
  const lineGap = (l: (typeof lines)[number]) => {
    const top = l.baseline - l.ascent
    return Math.max(top - y, 0, y - (top + l.height))
  }
  const line = lines.reduce((best, l) => (lineGap(l) < lineGap(best) ? l : best))
  let best = { offset: line.startIndex, distance: Number.POSITIVE_INFINITY }
  for (const box of boxesOf(ck, paragraph, text)) {
    if (box.line !== line.lineNumber) continue
    const distance = Math.max(box.x - x, 0, x - (box.x + box.width))
    if (distance < best.distance) {
      const beforeMiddle = x < box.x + box.width / 2
      best = { offset: beforeMiddle !== box.rtl ? box.start : box.end, distance }
    }
  }
  return best.offset
}

/**
 * Where to draw the caret for an offset, in the paragraph's own coordinates: the trailing edge of
 * the grapheme before it, or for offset 0 (and right after a line break) the leading edge of the
 * grapheme after it. At a bidi boundary this is the edge next to the text just typed.
 */
export function caretPosition(ck: CanvasKit, paragraph: Paragraph, text: string, offset: number): { x: number; y: number; height: number } {
  const boxes = boxesOf(ck, paragraph, text)
  const before = boxes.find((b) => b.end === offset && text[offset - 1] !== '\n')
  if (before) return { x: before.rtl ? before.x : before.x + before.width, y: before.y, height: before.height }
  const after = boxes.find((b) => b.start === offset)
  if (after) return { x: after.rtl ? after.x + after.width : after.x, y: after.y, height: after.height }
  const [line] = paragraph.getLineMetrics()
  return { x: 0, y: 0, height: line?.height ?? 0 }
}

export interface SelectionBox { x: number; y: number; width: number; height: number; rtl: boolean }

/** The boxes that highlight a text range, one per run of one direction on one line. */
export function selectionBoxes(ck: CanvasKit, paragraph: Paragraph, start: number, end: number): SelectionBox[] {
  return paragraph.getRectsForRange(start, end, ck.RectHeightStyle.Max, ck.RectWidthStyle.Tight).map(({ rect, dir }) => ({
    x: rect[0] ?? 0, y: rect[1] ?? 0, width: (rect[2] ?? 0) - (rect[0] ?? 0), height: (rect[3] ?? 0) - (rect[1] ?? 0),
    rtl: dir.value === ck.TextDirection.RTL.value,
  }))
}
