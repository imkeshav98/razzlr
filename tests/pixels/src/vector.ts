// Vector export checks (#56): PDFs drawn by pdfium and SVGs drawn by resvg, compared with the CPU
// render. Their rasterisers anti-alias and hint text their own way, so a pixel counts as different
// only when nothing within one pixel of it in the CPU render is within VECTOR_CHANNEL_TOLERANCE.
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { PDFiumLibrary } from '@hyzyla/pdfium'
import { Resvg } from '@resvg/resvg-js'
import { REFERENCE_DIR, type Pixels } from './pixels.ts'

/** How far a channel may differ before a pixel counts as different, out of 255. */
export const VECTOR_CHANNEL_TOLERANCE = 16

export const VECTOR_BASELINES = join(REFERENCE_DIR, 'vector-baselines.json')

/** One case's measured share of differing pixels, in percent, and the limit it must stay within. */
export interface VectorBaseline {
  pdf: { percent: number; limit: number }
  svg: { percent: number; limit: number }
}

/** The pixels over white, as a PDF viewer draws a page. */
export function overWhite({ width, height, pixels }: Pixels): Pixels {
  const out = new Uint8Array(pixels.length)
  for (let i = 0; i < pixels.length; i += 4) {
    const a = pixels[i + 3] ?? 255
    for (let c = 0; c < 3; c++) out[i + c] = Math.round(((pixels[i + c] ?? 0) * a + 255 * (255 - a)) / 255)
    out[i + 3] = 255
  }
  return { width, height, pixels: out }
}

/** A one-page PDF drawn by pdfium at one pixel to a unit, over white. */
export async function rasterisePdf(pdfium: PDFiumLibrary, bytes: Uint8Array): Promise<Pixels> {
  const document = await pdfium.loadDocument(bytes)
  try {
    const page = document.getPage(0)
    const { width, height, data } = await page.render({ scale: 1, render: 'bitmap', colorSpace: 'RGBA' })
    return overWhite({ width, height, pixels: new Uint8Array(data) })
  } finally {
    document.destroy()
  }
}

/** The text pdfium reads from a one-page PDF. */
export async function pdfText(pdfium: PDFiumLibrary, bytes: Uint8Array): Promise<string> {
  const document = await pdfium.loadDocument(bytes)
  try {
    return document.getPage(0).getText()
  } finally {
    document.destroy()
  }
}

/** An SVG drawn by resvg at its own size, over white; it needs no fonts, since our text is shapes. */
export function rasteriseSvg(bytes: Uint8Array): Pixels {
  const image = new Resvg(Buffer.from(bytes), { fitTo: { mode: 'original' }, font: { loadSystemFonts: false } }).render()
  return overWhite({ width: image.width, height: image.height, pixels: new Uint8Array(image.pixels) })
}

/** The share of `actual`'s pixels, in percent, with no pixel of `expected` within one pixel that matches it. */
export function vectorDifference(expected: Pixels, actual: Pixels): number {
  const { width, height } = expected
  if (actual.width !== width || actual.height !== height) {
    throw new Error(`sizes differ: ${width}×${height} expected, ${actual.width}×${actual.height} drawn`)
  }
  const a = expected.pixels
  const b = actual.pixels
  const t = VECTOR_CHANNEL_TOLERANCE
  const near = (i: number, j: number) =>
    Math.abs((a[j] ?? 0) - (b[i] ?? 0)) <= t && Math.abs((a[j + 1] ?? 0) - (b[i + 1] ?? 0)) <= t && Math.abs((a[j + 2] ?? 0) - (b[i + 2] ?? 0)) <= t
  let differing = 0
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4
      // Most pixels match the same pixel; only the rest look around.
      let matched = near(i, i)
      for (let dy = -1; dy <= 1 && !matched; dy++) {
        for (let dx = -1; dx <= 1 && !matched; dx++) {
          const xx = x + dx
          const yy = y + dy
          if (xx < 0 || yy < 0 || xx >= width || yy >= height) continue
          matched = near(i, (yy * width + xx) * 4)
        }
      }
      if (!matched) differing++
    }
  }
  return (differing / (width * height)) * 100
}

/** The limit set when a baseline is recorded: a quarter more than measured plus 0.05 percentage points. */
export const vectorLimit = (percent: number) => Number((percent * 1.25 + 0.05).toFixed(3))

export function readVectorBaselines(): Record<string, VectorBaseline> {
  return existsSync(VECTOR_BASELINES) ? (JSON.parse(readFileSync(VECTOR_BASELINES, 'utf8')) as Record<string, VectorBaseline>) : {}
}

/** Records one case's baseline, keeping the others; cases stay sorted so diffs are readable. */
export function recordVectorBaseline(name: string, measured: { pdf: number; svg: number }) {
  const entry = (percent: number) => ({ percent: Number(percent.toFixed(3)), limit: vectorLimit(percent) })
  const all = { ...readVectorBaselines(), [name]: { pdf: entry(measured.pdf), svg: entry(measured.svg) } }
  const sorted = Object.fromEntries(Object.entries(all).sort(([a], [b]) => (a < b ? -1 : 1)))
  writeFileSync(VECTOR_BASELINES, `${JSON.stringify(sorted, null, 2)}\n`)
}
