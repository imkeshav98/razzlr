// Editing inside a text layer (#47): the ranges a double or triple click selects, where the arrow
// keys go, and what a style key does to a range. Kept free of the editor so it can be tested on
// its own. Offsets count UTF-16 units, as the document's text does.
import type { Design } from '@razzlr/schema'

type TextNode = Extract<Design['nodes'][string], { type: 'text' }>
type Style = TextNode['props']['style']
export type RunStyle = Partial<Style>

/** A range of the text; `start` is never after `end`. */
export interface TextRange { start: number; end: number }

const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' })
const words = new Intl.Segmenter(undefined, { granularity: 'word' })

/** Every offset a caret can stand at: the edges of Unicode's graphemes. */
export const graphemeEdges = (text: string) => [0, ...[...graphemes.segment(text)].map((g) => g.index + g.segment.length)]

/** The offset one grapheme on, or back. */
export function step(text: string, offset: number, forward: boolean): number {
  const edges = graphemeEdges(text)
  return forward ? (edges.find((x) => x > offset) ?? text.length) : (edges.findLast((x) => x < offset) ?? 0)
}

/**
 * The word a double click at an offset selects: the word it is in, or touches at its end; between
 * words, the space or punctuation there.
 */
export function wordAt(text: string, offset: number): TextRange {
  const segments = [...words.segment(text)]
  const inside = segments.find((s) => offset >= s.index && offset < s.index + s.segment.length && s.isWordLike)
    ?? segments.find((s) => offset === s.index + s.segment.length && s.isWordLike)
    ?? segments.find((s) => offset >= s.index && offset < s.index + s.segment.length)
    ?? segments.at(-1)
  return inside ? { start: inside.index, end: inside.index + inside.segment.length } : { start: offset, end: offset }
}

/** The paragraph a triple click selects: the text between the line breaks around the offset. */
export function paragraphAt(text: string, offset: number): TextRange {
  const start = text.lastIndexOf('\n', offset - 1) + 1
  const next = text.indexOf('\n', offset)
  return { start, end: next === -1 ? text.length : next }
}

/** Each character's style in a range: the base, then every run over it, later runs winning. */
function stylesIn(props: TextNode['props'], range: TextRange): Style[] {
  const out: Style[] = []
  for (let i = range.start; i < range.end; i++) {
    const style = { ...props.style }
    for (const run of props.runs) if (run.start <= i && run.end > i) Object.assign(style, run.style)
    out.push(style)
  }
  return out
}

/** What a style key toggles: bold, italic, underline or strikethrough. */
export type StyleToggle = 'bold' | 'italic' | 'underline' | 'strikethrough'

/**
 * The run style a toggle writes over a range: on everywhere unless it is on everywhere already,
 * as word processors do. Bold is weight 700, and off is the base weight, or 400 when the base is bold.
 */
export function toggled(props: TextNode['props'], range: TextRange, toggle: StyleToggle): RunStyle {
  const styles = stylesIn(props, range)
  switch (toggle) {
    case 'bold': {
      const on = styles.every((s) => s.fontWeight >= 600)
      return { fontWeight: on ? (props.style.fontWeight >= 600 ? 400 : props.style.fontWeight) : 700 }
    }
    case 'italic':
      return { fontStyle: styles.every((s) => s.fontStyle === 'italic') ? 'normal' : 'italic' }
    case 'underline':
      return { underline: !styles.every((s) => s.underline) }
    case 'strikethrough':
      return { strikethrough: !styles.every((s) => s.strikethrough) }
  }
}
