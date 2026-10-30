import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { FONT_FACES } from '@razzlr/fonts'
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

function hbRun(file: string, text: string, direction: 'ltr' | 'rtl', start: number): { glyphs: Glyph[]; end: number } {
  const out = execFileSync('hb-shape', [
    '--output-format=json', '--no-glyph-names', `--font-size=${SIZE}`, `--direction=${direction}`, join(FONT_FILES_DIR, file), text,
  ], { env: { ...process.env, LC_ALL: 'C.UTF-8' } }).toString()
  let pen = start
  const glyphs = (JSON.parse(out) as { g: number; dx: number; dy: number; ax: number }[]).map((h) => {
    const glyph = { g: h.g, x: pen + h.dx, y: -h.dy }
    pen += h.ax
    return glyph
  })
  return { glyphs, end: pen }
}

/**
 * hb-shape shapes one direction at a time, so do the bidi step it leaves out: in right-to-left
 * text, numbers are left-to-right runs, and the runs are laid out from the right.
 */
function hbShape(file: string, text: string, rtl: boolean): Glyph[] {
  if (!rtl) return hbRun(file, text, 'ltr', 0).glyphs
  const runs = text.split(/([0-9][0-9.,]*)/).filter((t) => t !== '').reverse()
  let pen = 0
  return runs.flatMap((run) => {
    const shaped = hbRun(file, run, /^[0-9]/.test(run) ? 'ltr' : 'rtl', pen)
    pen = shaped.end
    return shaped.glyphs
  })
}

function skiaShape(family: string, weight: number, text: string, rtl: boolean): Glyph[] {
  const builder = ck.ParagraphBuilder.MakeFromFontCollection(new ck.ParagraphStyle({
    textDirection: rtl ? ck.TextDirection.RTL : ck.TextDirection.LTR,
    // Left-aligned so the line starts at x = 0 in both directions, as hb-shape's pen does.
    textAlign: ck.TextAlign.Left,
    textStyle: new ck.TextStyle({ fontFamilies: [family], fontSize: SIZE, fontStyle: { weight: { value: weight } }, color: ck.BLACK }),
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
    if (!face) throw new Error(`no ${family} ${weight}`)
    const expected = hbShape(face.file, text, rtl)
    expect(expected.filter((g) => g.g === 0), 'the font covers every character').toEqual([])
    const actual = skiaShape(family, weight, text, rtl)
    expect(actual.map((g) => g.g)).toEqual(expected.map((g) => g.g))
    for (const [i, g] of actual.entries()) {
      expect(Math.abs(g.x - (expected[i]?.x ?? 0)), `glyph ${i} x`).toBeLessThanOrEqual(TOLERANCE)
      expect(Math.abs(g.y - (expected[i]?.y ?? 0)), `glyph ${i} y`).toBeLessThanOrEqual(TOLERANCE)
    }
  })
})
