import { FALLBACK_FAMILY } from '@razzlr/fonts'
import { loadFontFiles } from '@razzlr/fonts/node'
import { caretAt, layoutText, makeResources, selectionBoxes } from '@razzlr/renderer'
import { loadCanvasKit } from '@razzlr/renderer/node'
import { TextProps } from '@razzlr/schema'
import { afterAll, describe, expect, it } from 'vitest'
import { MIXED, SAMPLES, type TextSample } from './text-samples.ts'

const ck = await loadCanvasKit()
const resources = makeResources(ck, { fonts: loadFontFiles(), fallbackFamilies: [FALLBACK_FAMILY], images: {} })
afterAll(() => resources.delete())

const ARABIC = /\p{Script=Arabic}/u
const LATIN_OR_DIGIT = /[\p{Script=Latin}0-9]/u

/** Graphemes as Unicode defines them (Intl.Segmenter), with their UTF-16 ranges. */
function graphemes(text: string) {
  return [...new Intl.Segmenter('und', { granularity: 'grapheme' }).segment(text)]
    .map((s) => ({ text: s.segment, start: s.index, end: s.index + s.segment.length }))
}

function laidOut(sample: TextSample) {
  const props = TextProps.parse({
    x: 0, y: 0, width: 0, height: 0, boxMode: 'autoWidth', text: sample.text,
    style: { fontFamily: sample.family, fontWeight: sample.weight, fontSize: 48, color: '#000000FF' },
  })
  return layoutText(ck, props, resources).paragraph
}

describe.each([...SAMPLES, MIXED])('caret and selection in $label', (sample) => {
  const paragraph = laidOut(sample)
  afterAll(() => paragraph.delete())
  const cases = graphemes(sample.text).filter((g) => g.text.trim() !== '')

  it.each(cases)('"$text" has one box in its own direction', (g) => {
    const boxes = selectionBoxes(ck, paragraph, g.start, g.end)
    expect(boxes).toHaveLength(1)
    expect(boxes[0]?.width).toBeGreaterThan(0)
    if (ARABIC.test(g.text)) expect(boxes[0]?.rtl).toBe(true)
    if (LATIN_OR_DIGIT.test(g.text)) expect(boxes[0]?.rtl).toBe(false)
  })

  it.each(cases)('a click on "$text" puts the caret on its near edge', (g) => {
    const [box] = selectionBoxes(ck, paragraph, g.start, g.end)
    if (!box) throw new Error('no box')
    const y = box.y + box.height / 2
    const leading = box.rtl ? box.x + box.width * 0.75 : box.x + box.width * 0.25
    const trailing = box.rtl ? box.x + box.width * 0.25 : box.x + box.width * 0.75
    expect(caretAt(ck, paragraph, sample.text, leading, y)).toBe(g.start)
    expect(caretAt(ck, paragraph, sample.text, trailing, y)).toBe(g.end)
  })

  it('every caret position is a grapheme edge', () => {
    const edges = new Set(graphemes(sample.text).flatMap((g) => [g.start, g.end]))
    const width = paragraph.getMaxWidth()
    for (let x = 0; x <= width; x += 2) expect(edges).toContain(caretAt(ck, paragraph, sample.text, x, 10))
  })
})
