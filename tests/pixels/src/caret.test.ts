import { FALLBACK_FAMILIES } from '@razzlr/fonts'
import { loadFontFiles } from '@razzlr/fonts/node'
import { caretAt, caretPosition, layoutText, makeResources, selectionBoxes } from '@razzlr/renderer'
import { loadCanvasKit } from '@razzlr/renderer/node'
import { TextProps } from '@razzlr/schema'
import type { Paragraph } from 'canvaskit-wasm'
import { afterAll, describe, expect, it } from 'vitest'
import { MIXED, SAMPLES, type TextSample } from './text-samples.ts'

const ck = await loadCanvasKit()
const resources = makeResources(ck, { fonts: loadFontFiles(), fallbackFamilies: [...FALLBACK_FAMILIES], images: {} })
afterAll(() => resources.delete())

/** Arabic letters and marks run right to left; Latin and digits, Arabic-Indic ones included, left to right. */
const ARABIC = /(?=\p{Script=Arabic})\P{Nd}/u
const LATIN_OR_DIGIT = /[\p{Script=Latin}\p{Nd}]/u

/** Graphemes as Unicode defines them (Intl.Segmenter), with their UTF-16 ranges. */
function graphemes(text: string) {
  return [...new Intl.Segmenter('und', { granularity: 'grapheme' }).segment(text)]
    .map((s) => ({ text: s.segment, start: s.index, end: s.index + s.segment.length }))
}

function laidOut(sample: TextSample, width?: number) {
  const props = TextProps.parse({
    x: 0, y: 0, width: width ?? 0, height: 0, boxMode: width ? 'autoHeight' : 'autoWidth', text: sample.text,
    style: { fontFamily: sample.family, fontWeight: sample.weight, fontSize: 48, color: '#000000FF' },
  })
  return layoutText(ck, props, resources).paragraph
}

/** Where each glyph is drawn, by the UTF-16 offset of its cluster, from the shaped lines rather than from selection boxes. */
function glyphOrigins(paragraph: Paragraph, text: string) {
  const utf16At = new Map<number, number>()
  let bytes = 0
  for (let i = 0; i < text.length; i++) {
    utf16At.set(bytes, i)
    const code = text.codePointAt(i) ?? 0
    bytes += code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4
    if (code >= 0x10000) i++
  }
  return paragraph.getShapedLines().flatMap((line) => line.runs.flatMap((run) =>
    [...run.glyphs].map((_, i) => ({ offset: utf16At.get(run.offsets[i] ?? -1) ?? -1, x: run.positions[2 * i] ?? Number.NaN }))))
}

describe.each([...SAMPLES, MIXED])('caret and selection in $label', (sample) => {
  const paragraph = laidOut(sample)
  afterAll(() => paragraph.delete())
  const cases = graphemes(sample.text).filter((g) => g.text.trim() !== '')
  const [line] = paragraph.getLineMetrics()
  if (!line) throw new Error('no line')
  const lineTop = line.baseline - line.ascent

  it.each(cases)('"$text" has one box in its own direction, around its glyphs', (g) => {
    const boxes = selectionBoxes(ck, paragraph, g.start, g.end)
    expect(boxes).toHaveLength(1)
    const [box] = boxes
    if (!box) return
    expect(box.width).toBeGreaterThan(0)
    if (ARABIC.test(g.text)) expect(box.rtl).toBe(true)
    if (LATIN_OR_DIGIT.test(g.text)) expect(box.rtl).toBe(false)
    const all = glyphOrigins(paragraph, sample.text)
    const origins = all.filter((o) => o.offset >= g.start && o.offset < g.end)
    // A grapheme with no glyph of its own is inside a ligature that starts earlier, like "fi".
    if (origins.length === 0) expect(all.some((o) => o.offset < g.start)).toBe(true)
    for (const o of origins) {
      expect(o.x).toBeGreaterThanOrEqual(box.x - 1)
      expect(o.x).toBeLessThanOrEqual(box.x + box.width + 1)
    }
  })

  it.each(cases)('a click anywhere up the line on "$text" puts the caret on its near edge', (g) => {
    const [box] = selectionBoxes(ck, paragraph, g.start, g.end)
    if (!box) throw new Error('no box')
    const leading = box.rtl ? box.x + box.width * 0.75 : box.x + box.width * 0.25
    const trailing = box.rtl ? box.x + box.width * 0.25 : box.x + box.width * 0.75
    for (const share of [0.05, 0.3, 0.6, 0.95]) {
      const y = lineTop + line.height * share
      expect(caretAt(ck, paragraph, sample.text, leading, y)).toBe(g.start)
      expect(caretAt(ck, paragraph, sample.text, trailing, y)).toBe(g.end)
    }
  })

  it('the caret is drawn where a click puts it', () => {
    for (const g of cases) {
      for (const offset of [g.start, g.end]) {
        const at = caretPosition(ck, paragraph, sample.text, offset)
        const clicked = caretAt(ck, paragraph, sample.text, at.x, at.y + at.height / 2)
        // Where a left-to-right run meets right-to-left text, two offsets share one place on screen,
        // so the click may pick the other one; it must still draw the caret in the same place.
        expect(caretPosition(ck, paragraph, sample.text, clicked).x).toBeCloseTo(at.x, 3)
      }
    }
  })

  it('every caret position is a grapheme edge', () => {
    const edges = new Set(graphemes(sample.text).flatMap((g) => [g.start, g.end]))
    for (let x = -10; x <= paragraph.getMaxWidth() + 10; x += 2) {
      expect(edges).toContain(caretAt(ck, paragraph, sample.text, x, lineTop + line.height / 2))
    }
  })
})

describe('caret on wrapped text', () => {
  const sample = SAMPLES.find((s) => s.label === 'Hindi body')
  if (!sample) throw new Error('no Hindi body')
  const paragraph = laidOut(sample, 300)
  afterAll(() => paragraph.delete())
  const lines = paragraph.getLineMetrics()

  it('wraps onto several lines', () => {
    expect(lines.length).toBeGreaterThan(1)
  })

  it('a click on a line, beside it or past its ends stays on that line', () => {
    for (const l of lines) {
      const top = l.baseline - l.ascent
      for (const x of [-50, l.left + 1, l.left + l.width / 2, l.left + l.width - 1, 1000]) {
        for (const y of [top + 1, top + l.height / 2, top + l.height - 1]) {
          const offset = caretAt(ck, paragraph, sample.text, x, y)
          expect(offset).toBeGreaterThanOrEqual(l.startIndex)
          expect(offset).toBeLessThanOrEqual(l.endIndex)
        }
      }
    }
  })

  it('a click above the text goes to the first line and below it to the last', () => {
    const first = lines[0]
    const last = lines.at(-1)
    if (!first || !last) throw new Error('no lines')
    expect(caretAt(ck, paragraph, sample.text, 5, -100)).toBe(first.startIndex)
    expect(caretAt(ck, paragraph, sample.text, 1000, paragraph.getHeight() + 100)).toBeGreaterThanOrEqual(last.startIndex)
  })
})
