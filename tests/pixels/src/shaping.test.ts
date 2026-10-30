import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { FALLBACK_FAMILY, FONT_FACES } from '@razzlr/fonts'
import { FONT_FILES_DIR, loadFontFiles } from '@razzlr/fonts/node'
import { makeResources } from '@razzlr/renderer'
import { loadCanvasKit } from '@razzlr/renderer/node'
import { afterAll, describe, expect, it } from 'vitest'
import { SAMPLES } from './text-samples.ts'

/** Shaping at 1000 px puts both sides in font units (every Noto face here has 1000 units per em). */
const SIZE = 1000
/** Skia accumulates advances in floats; HarfBuzz reports whole units. */
const TOLERANCE = 0.05

interface Glyph { g: number; x: number; y: number }

const ck = await loadCanvasKit()
const resources = makeResources(ck, { fonts: loadFontFiles(), fallbackFamilies: [], images: {} })
afterAll(() => resources.delete())

function hb(file: string, text: string, direction: 'ltr' | 'rtl') {
  const out = execFileSync('hb-shape', [
    '--output-format=json', '--no-glyph-names', `--font-size=${SIZE}`, `--direction=${direction}`, join(FONT_FILES_DIR, file), text,
  ], { env: { ...process.env, LC_ALL: 'C.UTF-8' } }).toString()
  return JSON.parse(out) as { g: number; cl: number; dx: number; dy: number; ax: number }[]
}

/** Splits text where the font stops or starts covering it, as SkParagraph's font fallback does. */
function byCoverage(file: string, text: string): { text: string; covered: boolean }[] {
  const missing = new Set(hb(file, text, 'ltr').filter((h) => h.g === 0).map((h) => h.cl))
  const pieces: { text: string; covered: boolean }[] = []
  let bytes = 0
  for (const ch of text) {
    const covered = !missing.has(bytes)
    const last = pieces.at(-1)
    if (last && last.covered === covered) last.text += ch
    else pieces.push({ text: ch, covered })
    bytes += Buffer.byteLength(ch)
  }
  return pieces
}

/**
 * The left-to-right runs inside Arabic in these samples: Latin words, and numbers in either kind
 * of digit. A percent sign stays outside the number: after Arabic letters, digits are Arabic
 * numbers (bidi rule W2), which don't absorb a following "%" the way rule W5 makes European ones do.
 */
const LTR_RUN = /([A-Za-z](?:[A-Za-z ]*[A-Za-z])?|[0-9\u0660-\u0669](?:[0-9\u0660-\u0669.,]*[0-9\u0660-\u0669])?)/

/**
 * hb-shape shapes one font and one direction at a time, so do what it leaves out: the bidi step
 * (in right-to-left text, Latin and numbers are left-to-right runs, and runs are laid out from the
 * right) and font fallback (characters the face lacks are shaped with Noto Sans, as Skia does).
 */
function hbShape(face: string, fallback: string, text: string, rtl: boolean): Glyph[] {
  const runs = (rtl ? text.split(LTR_RUN) : [text]).filter((t) => t !== '')
    .map((t) => ({ text: t, direction: rtl && !LTR_RUN.test(t) ? 'rtl' as const : 'ltr' as const }))
  if (rtl) runs.reverse()
  let pen = 0
  return runs.flatMap((run) => {
    const pieces = byCoverage(face, run.text)
    if (run.direction === 'rtl') pieces.reverse()
    return pieces.flatMap((piece) => hb(piece.covered ? face : fallback, piece.text, run.direction).map((h) => {
      const glyph = { g: h.g, x: pen + h.dx, y: -h.dy }
      pen += h.ax
      return glyph
    }))
  })
}

function skiaShape(family: string, weight: number, text: string, rtl: boolean): Glyph[] {
  const builder = ck.ParagraphBuilder.MakeFromFontCollection(new ck.ParagraphStyle({
    textDirection: rtl ? ck.TextDirection.RTL : ck.TextDirection.LTR,
    // Left-aligned so the line starts at x = 0 in both directions, as hb-shape's pen does.
    textAlign: ck.TextAlign.Left,
    textStyle: new ck.TextStyle({ fontFamilies: [family, FALLBACK_FAMILY], fontSize: SIZE, fontStyle: { weight: { value: weight } }, color: ck.BLACK }),
  }), resources.fonts)
  builder.addText(text)
  const paragraph = builder.build()
  builder.delete()
  paragraph.layout(1e9)
  const lines = paragraph.getShapedLines()
  paragraph.delete()
  expect(lines).toHaveLength(1)
  const line = lines[0]
  if (!line) return []
  return line.runs.flatMap((run) => [...run.glyphs].map((g, i) => ({
    g, x: run.positions[2 * i] ?? Number.NaN, y: (run.positions[2 * i + 1] ?? Number.NaN) - line.baseline,
  })))
}

describe('shaping matches hb-shape', () => {
  it.each(SAMPLES)('$label', ({ text, family, weight, rtl = false }) => {
    const face = FONT_FACES.find((f) => f.family === family && f.weight === weight)
    const fallback = FONT_FACES.find((f) => f.family === FALLBACK_FAMILY && f.weight === weight)
    if (!face || !fallback) throw new Error(`no ${family} or ${FALLBACK_FAMILY} at ${weight}`)
    const expected = hbShape(face.file, fallback.file, text, rtl)
    expect(expected.filter((g) => g.g === 0), 'the fonts cover every character').toEqual([])
    const actual = skiaShape(family, weight, text, rtl)
    expect(actual.map((g) => g.g)).toEqual(expected.map((g) => g.g))
    for (const [i, g] of actual.entries()) {
      expect(Math.abs(g.x - (expected[i]?.x ?? 0)), `glyph ${i} x`).toBeLessThanOrEqual(TOLERANCE)
      expect(Math.abs(g.y - (expected[i]?.y ?? 0)), `glyph ${i} y`).toBeLessThanOrEqual(TOLERANCE)
    }
  })
})
