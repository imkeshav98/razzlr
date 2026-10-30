import { layoutText, makeResources, renderDesign, type Rendered, type ResourceBytes } from '@razzlr/renderer'
import { loadCanvasKit } from '@razzlr/renderer/node'
import { parseDesign, type DesignInput } from '@razzlr/schema'
import type { CanvasKit, Typeface } from 'canvaskit-wasm'
import { fallbackFamilies, loadBrandFonts, type Face } from './fonts.ts'

/** CanvasKit, the brand fonts and a typeface per family, loaded once per run. */
export interface Kit { ck: CanvasKit; fonts: Face[]; faces: Map<string, Typeface> }

export async function loadKit(): Promise<Kit> {
  const ck = await loadCanvasKit()
  const fonts = loadBrandFonts()
  const faces = new Map<string, Typeface>()
  for (const font of fonts) {
    if (faces.has(font.family)) continue
    const face = ck.Typeface.MakeTypefaceFromData(font.bytes.slice().buffer)
    if (face) faces.set(font.family, face)
  }
  return { ck, fonts, faces }
}

const bytesOf = (kit: Kit, images: Record<string, Uint8Array>): ResourceBytes => ({ fonts: kit.fonts, fallbackFamilies: fallbackFamilies(), images })

export function draw(kit: Kit, design: DesignInput, images: Record<string, Uint8Array>): Rendered {
  return renderDesign(kit.ck, design, 'p1', 'f', bytesOf(kit, images))
}

/** What fitting found for one text layer. */
export interface TextFit {
  node: string
  /** Final font size over the planned one. */
  scale: number
  /** Still taller than its box, or a word wider than it, at the smallest size allowed. */
  overflows: boolean
  /** Characters the layer's own family lacks, drawn by a fallback font instead. */
  missing: string[]
  family: string
  size: number
}

const MIN_SCALE = 0.5

/**
 * Shrinks each text layer's font size, 5% at a time down to half, until its lines fit its box
 * and no word is wider than the box: what the editor's auto-fit would do to a planned layout.
 */
export function fitText(kit: Kit, design: DesignInput): { design: DesignInput; fits: TextFit[] } {
  const parsed = parseDesign(design)
  if (!parsed.success) throw new Error(`invalid design:\n${parsed.errors.join('\n')}`)
  const out = structuredClone(design)
  const resources = makeResources(kit.ck, bytesOf(kit, {}))
  const fits: TextFit[] = []
  try {
    for (const [id, node] of Object.entries(parsed.design.nodes)) {
      if (node.type !== 'text') continue
      const planned = node.props.style.fontSize
      let size = planned
      let overflows = true
      while (size >= planned * MIN_SCALE) {
        const { paragraph } = layoutText(kit.ck, { ...node.props, style: { ...node.props.style, fontSize: size } }, resources)
        const fits = paragraph.getHeight() <= node.props.height + 0.5 && paragraph.getMinIntrinsicWidth() <= node.props.width + 0.5
        paragraph.delete()
        if (fits) { overflows = false; break }
        size *= 0.95
      }
      size = Math.max(size, planned * MIN_SCALE)
      const target = out.nodes[id]
      if (target?.type === 'text') target.props.style.fontSize = Math.round(size * 10) / 10
      fits.push({ node: id, scale: size / planned, overflows, missing: missingChars(kit, node.props.style.fontFamily, node.props.text), family: node.props.style.fontFamily, size })
    }
  } finally {
    resources.delete()
  }
  return { design: out, fits }
}

/** Letters, digits and symbols the family has no glyph for; spaces and joiners don't count. */
export function missingChars(kit: Kit, family: string, text: string): string[] {
  const face = kit.faces.get(family)
  const chars = [...new Set([...text].filter((c) => /[\p{L}\p{N}\p{S}\p{P}\p{M}]/u.test(c)))]
  if (!face) return chars
  const ids = face.getGlyphIDs(chars.join(''))
  return chars.filter((_, i) => ids[i] === 0)
}

/** The same design with its text layers hidden: what each text is read against. */
export function withoutText(design: DesignInput): DesignInput {
  const out = structuredClone(design)
  for (const node of Object.values(out.nodes)) if (node.type === 'text') node.props.visible = false
  return out
}

const channel = (c: number) => { const s = c / 255; return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4 }
const luminance = (r: number, g: number, b: number) => 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
const ratio = (a: number, b: number) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)

/**
 * WCAG contrast of a text colour against what is behind its box: the median over the box's
 * pixels, and the share of pixels under 3:1, the large-text minimum.
 */
export function contrast(back: Rendered, box: { x: number; y: number; width: number; height: number }, hex: string): { median: number; under3: number } {
  const text = luminance(parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16))
  const ratios: number[] = []
  const x0 = Math.max(0, Math.floor(box.x)); const y0 = Math.max(0, Math.floor(box.y))
  const x1 = Math.min(back.width, Math.ceil(box.x + box.width)); const y1 = Math.min(back.height, Math.ceil(box.y + box.height))
  const step = Math.max(1, Math.floor(Math.sqrt(((x1 - x0) * (y1 - y0)) / 4000)))
  for (let y = y0; y < y1; y += step) {
    for (let x = x0; x < x1; x += step) {
      const i = (y * back.width + x) * 4
      ratios.push(ratio(text, luminance(back.pixels[i] ?? 0, back.pixels[i + 1] ?? 0, back.pixels[i + 2] ?? 0)))
    }
  }
  if (ratios.length === 0) return { median: 0, under3: 1 }
  ratios.sort((a, b) => a - b)
  return { median: ratios[Math.floor(ratios.length / 2)] ?? 0, under3: ratios.filter((r) => r < 3).length / ratios.length }
}
