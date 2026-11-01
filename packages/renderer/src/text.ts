import type { CanvasKit, FontCollection, Paragraph, TextStyle as CkTextStyle } from '@dazbee/canvaskit'
import { color } from './color.ts'
import type { Resources } from './draw.ts'
import type { SceneLayer } from './scene.ts'

type TextProps = Extract<SceneLayer, { type: 'text' }>['props']

/** Hebrew, Arabic, Syriac, Thaana, NKo, their presentation forms, and the right-to-left blocks beyond the BMP. */
const RTL_CHAR = /[\u0590-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFF\u{10800}-\u{10FFF}\u{1E800}-\u{1EFFF}]/u
const STRONG_CHAR = /[\p{L}]/u

type Style = TextProps['style']

/** One paragraph of a text layer (the text between line breaks), laid out where it sits in the layer. */
export interface TextBlock {
  paragraph: Paragraph
  /** The same paragraph with outlined runs stroked and the rest clear, drawn over it; null without outlines. */
  outline: Paragraph | null
  /** Its bullet or number, at (markerX, markerY) in the block, on the first line's baseline; null when not in a list. */
  marker: Paragraph | null
  markerX: number
  markerY: number
  /** The paragraph as drawn, its case changed, without the line break; offsets match the layer's text. */
  text: string
  /** Where it is in the layer's text, in UTF-16 units. */
  start: number
  end: number
  /** Its origin in the layer, before vertical alignment. */
  x: number
  y: number
  height: number
}

/**
 * A text layer shaped and laid out: the one layout drawing, measuring and editing use, so the caret
 * sits on the glyphs that are drawn. Blocks stack down from the layer's (x, y + dy). Paragraphs cut
 * off by `maxLines` have no block. The caller deletes it.
 */
export interface TextLayout {
  blocks: TextBlock[]
  dy: number
  width: number
  height: number
  /** The base font size shrink to fit chose, over the one set; 1 without it. */
  scale: number
  align: TextProps['align']
  rtl: boolean
  delete(): void
}

const ELLIPSIS = '\u2026'

/**
 * Shapes and lays out a text layer, a paragraph at a time (#47): lists put each paragraph's lines
 * clear of a gutter for its marker, and paragraph spacing goes between them. A text with one
 * paragraph is laid out as one SkParagraph, as before.
 */
export function layoutText(ck: CanvasKit, props: TextProps, resources: Pick<Resources, 'fonts' | 'fallbackFamilies'>): TextLayout {
  const fit = props.shrinkToFit
  if (!fit) return place(props, build(ck, props, resources, 1))
  // The largest quarter point size from min to max that fits; min when none does.
  const base = props.style.fontSize
  let lo = Math.ceil(fit.min * 4)
  let hi = Math.floor(fit.max * 4)
  let best: TextLayout | null = null
  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2)
    const laid = build(ck, props, resources, mid / 4 / base)
    if (fits(props, laid)) {
      best?.delete()
      best = laid
      lo = mid + 1
    } else {
      laid.delete()
      hi = mid - 1
    }
  }
  return place(props, best ?? build(ck, props, resources, fit.min / base))
}

/** Vertical alignment in a fixed box. */
function place(props: TextProps, laid: TextLayout): TextLayout {
  const free = props.boxMode === 'fixed' ? props.height - laid.height : 0
  laid.dy = { top: 0, middle: free / 2, bottom: free }[props.verticalAlign]
  return laid
}

/** Whether text fits its box: no word broken across lines, nothing cut off, and in a fixed box no line below it. */
function fits(props: TextProps, laid: TextLayout): boolean {
  if (props.boxMode === 'autoWidth') return true
  const total = props.text.split('\n').length
  if (laid.blocks.length < total || laid.blocks.some((b) => b.paragraph.didExceedMaxLines())) return false
  for (const b of laid.blocks) if (b.paragraph.getMinIntrinsicWidth() > props.width - b.x - gutterRight(props, laid, b) + 0.01) return false
  return props.boxMode !== 'fixed' || laid.height <= props.height + 0.01
}
const gutterRight = (props: TextProps, laid: TextLayout, b: TextBlock) => (b.marker && b.x === 0 ? laid.width - b.paragraph.getMaxWidth() : 0)

/** Every size in a style scaled by shrink to fit. */
function scaled(style: Partial<Style>, scale: number): Partial<Style> {
  if (scale === 1) return style
  const out = { ...style }
  if (out.fontSize !== undefined) out.fontSize *= scale
  if (out.letterSpacing !== undefined) out.letterSpacing *= scale
  if (out.outline) out.outline = { ...out.outline, width: out.outline.width * scale }
  return out
}

function build(ck: CanvasKit, props: TextProps, resources: Pick<Resources, 'fonts' | 'fallbackFamilies'>, scale: number): TextLayout {
  const direction = props.direction === 'auto' ? autoDirection(props.text) : props.direction
  const rtl = direction === 'rtl'
  const base = scaled(props.style, scale) as Style
  // Later runs win where runs overlap, so split the text at every run edge and merge per piece.
  const edges = [...new Set([0, props.text.length, ...props.runs.flatMap((r) => [r.start, r.end])])].sort((a, b) => a - b)
  const pieces = edges.slice(0, -1).map((start, i) => {
    const end = edges[i + 1] ?? props.text.length
    const style = { ...props.style }
    for (const run of props.runs) if (run.start <= start && run.end >= end) Object.assign(style, run.style)
    return { start, end, style: scaled(style, scale) as Style }
  })
  const styleAt = (offset: number) => pieces.find((p) => offset >= p.start && offset < p.end)?.style ?? pieces.at(-1)?.style ?? base
  const shown = withCase(props.text, styleAt)

  const paragraphStyle = (style: Style, extra: { maxLines?: number; ellipsis?: string } = {}) => new ck.ParagraphStyle({
    textAlign: { start: ck.TextAlign.Start, center: ck.TextAlign.Center, end: ck.TextAlign.End, justify: ck.TextAlign.Justify }[props.align],
    textDirection: rtl ? ck.TextDirection.RTL : ck.TextDirection.LTR,
    textStyle: textStyle(ck, style, resources),
    ...extra,
  })
  const outlined = pieces.some((p) => (p.style.outline?.width ?? 0) > 0)
  const clear = new ck.Paint()
  clear.setColor(ck.TRANSPARENT)
  /** One paragraph of the text; with `outline`, its outline pass. `more` is drawn after it, as an ellipsis is. */
  const paragraphOf = (start: number, end: number, extra: { maxLines?: number; ellipsis?: string }, outline: boolean, more = '') => {
    // An empty paragraph takes the style typing would give it: the character before's.
    const lead = start < end ? styleAt(start) : styleAt(Math.max(0, start - 1))
    const builder = ck.ParagraphBuilder.MakeFromFontCollection(paragraphStyle(start === 0 && end === props.text.length ? base : lead, extra), resources.fonts)
    for (const piece of pieces) {
      const from = Math.max(piece.start, start)
      const to = Math.min(piece.end, end)
      if (to <= from) continue
      const style = textStyle(ck, piece.style, resources, outline)
      if (outline) {
        const width = piece.style.outline?.width ?? 0
        const stroke = new ck.Paint()
        stroke.setAntiAlias(true)
        if (width > 0 && piece.style.outline) {
          stroke.setStyle(ck.PaintStyle.Stroke)
          stroke.setStrokeWidth(width)
          stroke.setStrokeJoin(ck.StrokeJoin.Round)
          stroke.setColor(color(ck, piece.style.outline.color))
        } else {
          stroke.setColor(ck.TRANSPARENT)
        }
        builder.pushPaintStyle(style, stroke, clear)
        stroke.delete()
      } else {
        builder.pushStyle(style)
      }
      builder.addText(shown.slice(from, to))
      builder.pop()
    }
    if (more) {
      builder.pushStyle(textStyle(ck, styleAt(Math.max(start, end - 1)), resources, outline))
      builder.addText(more)
      builder.pop()
    }
    const paragraph = builder.build()
    builder.delete()
    return paragraph
  }

  // Paragraphs, and the marker of each one with text.
  const ranges: { start: number; end: number }[] = []
  let at = 0
  for (const line of props.text.split('\n')) {
    ranges.push({ start: at, end: at + line.length })
    at += line.length + 1
  }
  let number = 0
  const markers = ranges.map(({ start, end }) => {
    if (!props.list || start === end) return null
    number++
    const builder = ck.ParagraphBuilder.MakeFromFontCollection(paragraphStyle(styleAt(start)), resources.fonts)
    builder.pushStyle(textStyle(ck, styleAt(start), resources))
    // In right-to-left text the full stop lands on the number's left, as Arabic lists show it.
    builder.addText(props.list === 'bullet' ? '\u2022' : `${number}.`)
    builder.pop()
    const paragraph = builder.build()
    builder.delete()
    // Laid out at its own width: a right-to-left one laid out wider would sit at the far end.
    paragraph.layout(Number.POSITIVE_INFINITY)
    paragraph.layout(Math.ceil(paragraph.getMaxIntrinsicWidth()))
    return paragraph
  })
  // The gutter: the widest marker and half the base size more.
  const gutter = props.list ? Math.ceil(Math.max(0, ...markers.map((m) => m?.getMaxIntrinsicWidth() ?? 0)) + base.fontSize / 2) : 0

  let paragraphs = ranges.map(({ start, end }) => paragraphOf(start, end, {}, false))
  /** How the last paragraph was cut, so its outline pass is cut alike. */
  let cutWith: { extra: { maxLines?: number; ellipsis?: string }; more: string } = { extra: {}, more: '' }
  let width: number
  if (props.boxMode === 'autoWidth') {
    for (const p of paragraphs) p.layout(Number.POSITIVE_INFINITY)
    width = Math.ceil(Math.max(0, ...paragraphs.map((p) => p.getMaxIntrinsicWidth())))
    for (const p of paragraphs) p.layout(width)
    width += gutter
  } else {
    width = props.width
    for (const p of paragraphs) p.layout(width - gutter)
  }
  const inner = width - gutter
  const lineCount = (p: Paragraph) => Math.max(1, p.getLineMetrics().length)

  // Lines past maxLines are cut: the paragraph they end in gets an ellipsis, and later ones go.
  if (props.maxLines !== undefined) {
    let left = props.maxLines
    for (const [i, p] of paragraphs.entries()) {
      const lines = lineCount(p)
      const range = ranges[i] as { start: number; end: number }
      const cut = lines > left
      const last = lines === left && paragraphs.slice(i + 1).length > 0
      if (cut || last) {
        p.delete()
        cutWith = { extra: { maxLines: left, ellipsis: ELLIPSIS }, more: last ? ELLIPSIS : '' }
        const remake = paragraphOf(range.start, range.end, cutWith.extra, false, cutWith.more)
        remake.layout(inner)
        paragraphs[i] = remake
        for (const gone of paragraphs.slice(i + 1)) gone.delete()
        for (const gone of markers.slice(i + 1)) gone?.delete()
        paragraphs = paragraphs.slice(0, i + 1)
        markers.length = i + 1
        break
      }
      left -= lines
    }
  }

  const spacing = (props.paragraphSpacing ?? 0) * scale
  let y = 0
  const blocks: TextBlock[] = paragraphs.map((paragraph, i) => {
    const range = ranges[i] as { start: number; end: number }
    let outline: Paragraph | null = null
    if (outlined) {
      const lastOne = i === paragraphs.length - 1
      outline = paragraphOf(range.start, range.end, lastOne ? cutWith.extra : {}, true, lastOne ? cutWith.more : '')
      outline.layout(inner)
    }
    const marker = markers[i] ?? null
    const block: TextBlock = {
      paragraph, outline, marker,
      markerX: rtl ? inner + gutter - (marker?.getMaxIntrinsicWidth() ?? 0) : 0,
      markerY: (paragraph.getLineMetrics()[0]?.baseline ?? 0) - (marker?.getLineMetrics()[0]?.baseline ?? 0),
      text: shown.slice(range.start, range.end), start: range.start, end: range.end,
      x: rtl ? 0 : gutter, y, height: paragraph.getHeight(),
    }
    y += block.height + (i < paragraphs.length - 1 ? spacing : 0)
    return block
  })
  clear.delete()
  return {
    blocks, dy: 0, width, height: y, scale, align: props.align, rtl,
    delete() {
      for (const b of blocks) {
        b.paragraph.delete()
        b.outline?.delete()
        b.marker?.delete()
      }
    },
  }
}

const WORD_CHAR = /[\p{L}\p{N}\p{M}]/u

/** The text with each piece's case applied, a code point at a time and only where that keeps its length, so offsets still match. */
function withCase(text: string, styleAt: (offset: number) => Style): string {
  let out = ''
  let i = 0
  let prev = ''
  for (const ch of text) {
    const mode = styleAt(i).textCase ?? 'none'
    let next = ch
    if (mode === 'upper' || (mode === 'title' && !WORD_CHAR.test(prev))) next = ch.toUpperCase()
    else if (mode === 'lower') next = ch.toLowerCase()
    out += next.length === ch.length ? next : ch
    prev = ch
    i += ch.length
  }
  return out
}

/** What a text layer's layout depends on: everything but where it is placed and how it is painted over. */
const layoutKey = (props: TextProps, fallbackFamilies: string[]) => JSON.stringify([
  props.text, props.runs, props.style, props.width, props.height, props.boxMode, props.align, props.verticalAlign, props.direction,
  props.list, props.paragraphSpacing, props.maxLines, props.shrinkToFit, fallbackFamilies,
])

/**
 * Laid-out text kept by what shapes it, for a screen that redraws often: a redraw lays out only
 * the text that changed. The cache owns its layouts; `delete` frees them all.
 */
export function paragraphCache(limit = 4000) {
  // Insertion order is use order: a hit moves to the end, and the front is evicted first.
  const entries = new Map<string, TextLayout>()
  let fonts: FontCollection | null = null
  const clear = () => {
    for (const laid of entries.values()) laid.delete()
    entries.clear()
  }
  return {
    layout(ck: CanvasKit, props: TextProps, resources: Pick<Resources, 'fonts' | 'fallbackFamilies'>) {
      if (resources.fonts !== fonts) {
        clear()
        fonts = resources.fonts
      }
      const key = layoutKey(props, resources.fallbackFamilies)
      const hit = entries.get(key)
      if (hit) {
        entries.delete(key)
        entries.set(key, hit)
        return hit
      }
      const laid = layoutText(ck, props, resources)
      entries.set(key, laid)
      for (const [oldest, old] of entries) {
        if (entries.size <= limit) break
        entries.delete(oldest)
        old.delete()
      }
      return laid
    },
    delete: clear,
  }
}
export type ParagraphCache = ReturnType<typeof paragraphCache>

/** A style for CanvasKit; for an outline pass, without the lines, which the fill pass draws. */
function textStyle(ck: CanvasKit, style: Style, resources: Pick<Resources, 'fallbackFamilies'>, outline = false): CkTextStyle {
  const decoration = outline ? 0 : (style.underline ? ck.UnderlineDecoration : 0) | (style.strikethrough ? ck.LineThroughDecoration : 0)
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
    ...(decoration ? { decoration, decorationColor: color(ck, style.color), decorationThickness: 1 } : {}),
  })
}

/** The direction of the first strong character, as the Unicode bidi algorithm picks a paragraph's direction. */
function autoDirection(text: string): 'ltr' | 'rtl' {
  for (const ch of text) if (STRONG_CHAR.test(ch)) return RTL_CHAR.test(ch) ? 'rtl' : 'ltr'
  return 'ltr'
}

const graphemeSegmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' })

interface GraphemeBox extends SelectionBox { start: number; end: number; line: number }

/** Every grapheme's box, in its block, measured once per paragraph: a drag asks for the caret every frame. */
const graphemeBoxes = new WeakMap<Paragraph, GraphemeBox[]>()

function boxesOf(ck: CanvasKit, block: TextBlock): GraphemeBox[] {
  const { paragraph, text } = block
  let boxes = graphemeBoxes.get(paragraph)
  if (!boxes) {
    // getLineNumberAt answers 0 for every offset in CanvasKit 0.42, so lines come from their metrics.
    const lines = paragraph.getLineMetrics()
    boxes = [...graphemeSegmenter.segment(text)].flatMap((g) => {
      const end = g.index + g.segment.length
      const line = lines.find((l) => g.index >= l.startIndex && g.index < l.endIndex)?.lineNumber ?? -1
      return rectsOf(ck, paragraph, g.index, end).map((box) => ({ ...box, start: g.index, end, line }))
    })
    graphemeBoxes.set(paragraph, boxes)
  }
  return boxes
}

/** The block an offset is in: the one whose text or end holds it, else (cut off by maxLines) the last. */
function blockOf(laid: TextLayout, offset: number): TextBlock | undefined {
  return laid.blocks.find((b) => offset >= b.start && offset <= b.end) ?? laid.blocks.at(-1)
}

/**
 * The text offset a click lands on, in the layout's own coordinates (before `dy`): the paragraph
 * under the click (or the nearest one), the line in it, then the grapheme on it nearest the click,
 * then that grapheme's near edge by its own direction. Graphemes are Unicode's (Intl.Segmenter),
 * and the hit-test uses their boxes rather than SkParagraph's glyph lookup, which sends a click on
 * a Devanagari reph to the wrong grapheme.
 */
export function caretAt(ck: CanvasKit, laid: TextLayout, x: number, y: number): number {
  const gap = (top: number, height: number) => Math.max(top - y, 0, y - (top + height))
  const block = laid.blocks.reduce<TextBlock | undefined>((best, b) => (!best || gap(b.y, b.height) < gap(best.y, best.height) ? b : best), undefined)
  if (!block) return 0
  const lines = block.paragraph.getLineMetrics()
  if (lines.length === 0) return block.start
  const bx = x - block.x
  const by = y - block.y
  const lineGap = (l: (typeof lines)[number]) => {
    const top = l.baseline - l.ascent
    return Math.max(top - by, 0, by - (top + l.height))
  }
  const line = lines.reduce((best, l) => (lineGap(l) < lineGap(best) ? l : best))
  let best = { offset: line.startIndex, distance: Number.POSITIVE_INFINITY }
  for (const box of boxesOf(ck, block)) {
    if (box.line !== line.lineNumber) continue
    const distance = Math.max(box.x - bx, 0, bx - (box.x + box.width))
    if (distance < best.distance) {
      const beforeMiddle = bx < box.x + box.width / 2
      best = { offset: beforeMiddle !== box.rtl ? box.start : box.end, distance }
    }
  }
  return block.start + Math.min(best.offset, block.text.length)
}

/**
 * Where to draw the caret for an offset, in the layout's own coordinates (before `dy`): the
 * trailing edge of the grapheme before it, or at the start of a paragraph the leading edge of the
 * grapheme after it. At a bidi boundary this is the edge next to the text just typed.
 */
export function caretPosition(ck: CanvasKit, laid: TextLayout, offset: number): { x: number; y: number; height: number } {
  const block = blockOf(laid, offset)
  if (!block) return { x: 0, y: 0, height: 0 }
  const local = Math.min(offset - block.start, block.text.length)
  const boxes = boxesOf(ck, block)
  const at = (x: number, y: number, height: number) => ({ x: block.x + x, y: block.y + y, height })
  const before = boxes.find((b) => b.end === local)
  if (before) return at(before.rtl ? before.x : before.x + before.width, before.y, before.height)
  const after = boxes.find((b) => b.start === local)
  if (after) return at(after.rtl ? after.x + after.width : after.x, after.y, after.height)
  // An empty paragraph: where its first character would go.
  const width = block.paragraph.getMaxWidth()
  const lead = laid.rtl ? width : 0
  const x = { start: lead, justify: lead, center: width / 2, end: width - lead }[laid.align]
  return at(x, 0, block.height)
}

export interface SelectionBox { x: number; y: number; width: number; height: number; rtl: boolean }

function rectsOf(ck: CanvasKit, paragraph: Paragraph, start: number, end: number): SelectionBox[] {
  return paragraph.getRectsForRange(start, end, ck.RectHeightStyle.Max, ck.RectWidthStyle.Tight).map(({ rect, dir }) => ({
    x: rect[0] ?? 0, y: rect[1] ?? 0, width: (rect[2] ?? 0) - (rect[0] ?? 0), height: (rect[3] ?? 0) - (rect[1] ?? 0),
    rtl: dir.value === ck.TextDirection.RTL.value,
  }))
}

/** The boxes that highlight a text range, in the layout's own coordinates: one per run of one direction on one line. */
export function selectionBoxes(ck: CanvasKit, laid: TextLayout, start: number, end: number): SelectionBox[] {
  return laid.blocks.flatMap((b) => {
    const from = Math.max(start, b.start) - b.start
    const to = Math.min(end, b.end) - b.start
    if (to <= from) return []
    return rectsOf(ck, b.paragraph, from, to).map((r) => ({ ...r, x: r.x + b.x, y: r.y + b.y }))
  })
}

/**
 * Measures text for auto layout (#46), the way `layoutText` lays it out to draw: natural width
 * (rounded up, as a text box that grows draws) or the height at a given width.
 */
export function textMeasure(ck: CanvasKit, resources: Pick<Resources, 'fonts' | 'fallbackFamilies'>) {
  return (props: TextProps, width: number | null) => {
    const laid = layoutText(ck, width === null ? { ...props, boxMode: 'autoWidth' } : { ...props, boxMode: 'autoHeight', width }, resources)
    try {
      return { width: width ?? laid.width, height: laid.height }
    } finally {
      laid.delete()
    }
  }
}
