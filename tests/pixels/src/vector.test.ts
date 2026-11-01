import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { PDFiumLibrary } from '@hyzyla/pdfium'
import { exportDesign } from '@razzlr/export'
import { layoutText, render, renderDesign, renderVector, resourceCache, textMeasure, type SceneLayer } from '@razzlr/renderer'
import { loadCanvasKit } from '@razzlr/renderer/node'
import { parseDesign } from '@razzlr/schema'
import { afterAll, describe, expect, it } from 'vitest'
import { loadFixtures } from './fixtures.ts'
import { pdfGlyphs } from './pdf-glyphs.ts'
import { encodePng, fixtureResources, OUTPUT_DIR } from './pixels.ts'
import { overWhite, pdfText, rasterisePdf, rasteriseSvg, readVectorBaselines, recordVectorBaseline, vectorDifference } from './vector.ts'

/** Set to record the baselines from the current exports, after checking them by eye. */
const UPDATE = process.env.UPDATE_VECTOR_BASELINES === '1'
if (UPDATE && process.env.CI) throw new Error('UPDATE_VECTOR_BASELINES rewrites the baselines, so CI must never set it')

const ck = await loadCanvasKit()
const bytes = fixtureResources()
const cache = resourceCache(ck)
const pdfium = await PDFiumLibrary.init()
afterAll(() => {
  pdfium.destroy()
  cache.delete()
})

const cases = loadFixtures().flatMap(({ name, json }) => {
  const parsed = parseDesign(json)
  if (!parsed.success) throw new Error(parsed.errors.join('\n'))
  const design = parsed.design
  return Object.keys(design.pages).flatMap((pageId) => Object.keys(design.formats).map((formatId) => ({ name, json, design, pageId, formatId, label: `${name} ${pageId}.${formatId}` })))
})
const baselines = readVectorBaselines()

describe('PDF and SVG exports (#56)', () => {
  it.each(cases)('$label: pdfium and resvg draw them as the CPU does, within the baseline', async ({ name, json, pageId, formatId, label }) => {
    const cpu = overWhite(renderDesign(ck, json, pageId, formatId, bytes, cache))
    const pdf = renderVector(ck, json, pageId, formatId, bytes, 'pdf', cache)
    const svg = renderVector(ck, json, pageId, formatId, bytes, 'svg', cache)
    const pdfPixels = await rasterisePdf(pdfium, pdf)
    const svgPixels = rasteriseSvg(svg)
    const measured = { pdf: vectorDifference(cpu, pdfPixels), svg: vectorDifference(cpu, svgPixels) }
    if (UPDATE) {
      recordVectorBaseline(label, measured)
      return
    }
    const baseline = baselines[label]
    if (!baseline) throw new Error(`no vector baseline for ${label}; record one with UPDATE_VECTOR_BASELINES=1 and commit it`)
    const over = (['pdf', 'svg'] as const).filter((type) => measured[type] > baseline[type].limit)
    if (over.length > 0) {
      const out = join(OUTPUT_DIR, 'vector', name)
      mkdirSync(out, { recursive: true })
      const base = `${pageId}.${formatId}`
      writeFileSync(join(out, `${base}.pdf`), pdf)
      writeFileSync(join(out, `${base}.svg`), svg)
      writeFileSync(join(out, `${base}.cpu.png`), encodePng(ck, cpu))
      writeFileSync(join(out, `${base}.pdf.png`), encodePng(ck, pdfPixels))
      writeFileSync(join(out, `${base}.svg.png`), encodePng(ck, svgPixels))
    }
    for (const type of ['pdf', 'svg'] as const) {
      expect(measured[type], `${type}: % of pixels differing (baseline ${baseline[type].percent}%)`).toBeLessThanOrEqual(baseline[type].limit)
    }
  })

  it('keeps PDF text as text, each text once, outlines included', async () => {
    const styles = cases.find((c) => c.name === 'text-styles')
    const sale = cases.find((c) => c.name === 'english-sale-ad')
    if (!styles || !sale) throw new Error('fixtures missing')
    const stylesText = await pdfText(pdfium, renderVector(ck, styles.json, styles.pageId, styles.formatId, bytes, 'pdf', cache))
    expect(stylesText).toContain('Bold outline')
    expect(stylesText.match(/Bold/g)).toHaveLength(1)
    expect(await pdfText(pdfium, renderVector(ck, sale.json, sale.pageId, sale.formatId, bytes, 'pdf', cache))).toContain('Summer sale')
  })

  it.each(cases)('$label: every glyph in the PDF sits where the renderer draws it, within 0.05 px', ({ design, pageId, formatId, json }) => {
    const resources = cache.resources(bytes)
    const scene = render(design, pageId, formatId, undefined, textMeasure(ck, resources), bytes.variables)
    const drawn = rendererGlyphs(scene.layers, resources)
    const inFile = pdfGlyphs(renderVector(ck, json, pageId, formatId, bytes, 'pdf', cache))
    // Text drawn only as a mask lives in the PDF's soft masks, which this doesn't read.
    let worst = 0
    for (const g of inFile) {
      const nearest = Math.min(...(drawn.get(g.glyph) ?? []).map(([x, y]) => Math.hypot(x - g.x, y - g.y)))
      worst = Math.max(worst, nearest)
    }
    expect(worst, `largest distance over ${inFile.length} glyphs`).toBeLessThanOrEqual(0.05)
  })

  it('names the file and its type for PDF and SVG', () => {
    const [c] = cases
    if (!c) throw new Error('no cases')
    for (const [type, mime] of [['pdf', 'application/pdf'], ['svg', 'image/svg+xml']] as const) {
      const file = exportDesign(ck, c.json, { pageIds: [c.pageId], formatIds: [c.formatId], type }, bytes, cache)
      expect(file.type).toBe(mime)
      expect(file.name.endsWith(`.${type}`)).toBe(true)
    }
  })
})

type Affine = [number, number, number, number, number, number]
const apply = ([a, b, c, d, e, f]: Affine, x: number, y: number) => [a * x + c * y + e, b * x + d * y + f] as const
const turn = (m: Affine, degrees: number, cx: number, cy: number): Affine => {
  if (degrees === 0) return m
  const r = (degrees * Math.PI) / 180
  const [cos, sin] = [Math.cos(r), Math.sin(r)]
  // m × (translate(c) · rotate · translate(-c))
  const [a, b, c, d, e, f] = m
  const tx = cx - cos * cx + sin * cy
  const ty = cy - sin * cx - cos * cy
  return [a * cos + c * sin, b * cos + d * sin, -a * sin + c * cos, -b * sin + d * cos, a * tx + c * ty + e, b * tx + d * ty + f]
}

/** Every glyph the renderer lays out, by glyph id, where it draws it on the page, each layer turned as it is drawn. */
function rendererGlyphs(layers: readonly SceneLayer[], resources: ReturnType<typeof cache.resources>, m: Affine = [1, 0, 0, 1, 0, 0], into = new Map<number, [number, number][]>()) {
  for (const layer of layers) {
    const { props } = layer
    const turned = turn(m, props.rotation, props.x + props.width / 2, props.y + props.height / 2)
    if (layer.type === 'text') {
      const laid = layoutText(ck, layer.props, resources)
      for (const b of laid.blocks) {
        const pieces: [typeof b.paragraph | null, number, number][] = [[b.paragraph, b.x, b.y], [b.marker, b.markerX, b.y + b.markerY]]
        for (const [paragraph, ox, oy] of pieces) {
          for (const line of paragraph?.getShapedLines() ?? []) {
            for (const run of line.runs) {
              run.glyphs.forEach((glyph, i) => {
                const at = apply(turned, props.x + ox + (run.positions[2 * i] ?? 0), props.y + laid.dy + oy + (run.positions[2 * i + 1] ?? 0))
                into.set(glyph, [...(into.get(glyph) ?? []), [at[0], at[1]]])
              })
            }
          }
        }
      }
      laid.delete()
    }
    rendererGlyphs(layer.children, resources, turned, into)
  }
  return into
}
