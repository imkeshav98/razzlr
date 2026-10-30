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

/**
 * The text offset a click lands on, in the paragraph's own coordinates. It is always the near
 * edge of the grapheme (as Unicode segments them) whose box is closest to the click, judged by
 * that grapheme's direction. Hit-testing our own grapheme boxes, rather than asking SkParagraph
 * for the glyph under the point, keeps a reph or a split matra from sending the caret to the
 * wrong grapheme.
 */
export function caretAt(ck: CanvasKit, paragraph: Paragraph, text: string, x: number, y: number): number {
  let best = { offset: 0, distance: Number.POSITIVE_INFINITY }
  for (const g of new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text)) {
    const end = g.index + g.segment.length
    for (const box of selectionBoxes(ck, paragraph, g.index, end)) {
      const dx = Math.max(box.x - x, 0, x - (box.x + box.width))
      const dy = Math.max(box.y - y, 0, y - (box.y + box.height))
      // A click is on a line before it is beside a grapheme, so vertical distance counts first.
      const distance = dy * 1e6 + dx
      if (distance < best.distance) {
        const beforeMiddle = x < box.x + box.width / 2
        best = { offset: beforeMiddle !== box.rtl ? g.index : end, distance }
      }
    }
  }
  return best.offset
}

export interface SelectionBox { x: number; y: number; width: number; height: number; rtl: boolean }

/** The boxes that highlight a text range, one per run of one direction on one line. */
export function selectionBoxes(ck: CanvasKit, paragraph: Paragraph, start: number, end: number): SelectionBox[] {
  return paragraph.getRectsForRange(start, end, ck.RectHeightStyle.Tight, ck.RectWidthStyle.Tight).map(({ rect, dir }) => ({
    x: rect[0] ?? 0, y: rect[1] ?? 0, width: (rect[2] ?? 0) - (rect[0] ?? 0), height: (rect[3] ?? 0) - (rect[1] ?? 0),
    rtl: dir.value === ck.TextDirection.RTL.value,
  }))
}
