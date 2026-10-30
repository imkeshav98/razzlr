import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { FALLBACK_FAMILIES } from '@razzlr/fonts'
import { loadFontFiles } from '@razzlr/fonts/node'
import type { ResourceBytes } from '@razzlr/renderer'
import type { CanvasKit } from 'canvaskit-wasm'
import manifest from '../fonts.json' with { type: 'json' }

export const FONTS_DIR = join(import.meta.dirname, '..', 'fonts')

/** A brand font the test can use: a family, its weights and the scripts it covers. */
export interface BrandFamily { family: string; weights: number[]; scripts: Script[] }
export type Script = 'latin' | 'devanagari' | 'arabic'

const SCRIPT_SAMPLES: Record<Script, string> = {
  latin: 'AaZz09$%',
  devanagari: 'अआकखगक्षत्रज्ञ्',
  arabic: 'ابتثجحخ٠١٢',
}

/**
 * The brand fonts (OFL, pinned in fonts.json) plus the shipped Noto faces, as renderer bytes.
 * Fonts come from bytes whose hashes we pinned, never the system (CLAUDE.md).
 * `pnpm fonts` downloads them first.
 */
export function loadBrandFonts(): Face[] {
  const brand = manifest.faces.map((face) => {
    const file = join(FONTS_DIR, basename(face.path))
    if (!existsSync(file)) throw new Error(`missing ${file}: run \`pnpm fonts\` in tests/ai-drafts first`)
    const bytes = new Uint8Array(readFileSync(file))
    const hash = createHash('sha256').update(bytes).digest('hex')
    if (hash !== face.sha256) throw new Error(`${file} does not match its pinned SHA-256`)
    return { family: face.family, weight: face.weight, bytes }
  })
  return [...loadFontFiles().map(({ family, weight, bytes }) => ({ family, weight, bytes })), ...brand]
}

export type Face = ResourceBytes['fonts'][number] & { weight: number }

export const fallbackFamilies = (): string[] => [...FALLBACK_FAMILIES]

/** Every family with its weights and the scripts all of its faces draw without a missing glyph. */
export function brandFamilies(ck: CanvasKit, fonts: Face[] = loadBrandFonts()): BrandFamily[] {
  const families = new Map<string, BrandFamily>()
  for (const font of fonts) {
    const face = ck.Typeface.MakeTypefaceFromData(font.bytes.slice().buffer)
    if (!face) throw new Error(`CanvasKit can't read a face of ${font.family}`)
    const scripts = (Object.keys(SCRIPT_SAMPLES) as Script[]).filter((s) => [...face.getGlyphIDs(SCRIPT_SAMPLES[s])].every((g) => g !== 0))
    const weight = font.weight
    face.delete()
    const known = families.get(font.family)
    if (!known) families.set(font.family, { family: font.family, weights: [weight], scripts })
    else {
      known.weights = [...new Set([...known.weights, weight])].sort((a, b) => a - b)
      known.scripts = known.scripts.filter((s) => scripts.includes(s))
    }
  }
  return [...families.values()]
}

/** Which scripts a string uses, by its letters. */
export function scriptsOf(text: string): Script[] {
  const scripts = new Set<Script>()
  for (const ch of text) {
    if (/\p{Script=Devanagari}/u.test(ch)) scripts.add('devanagari')
    else if (/\p{Script=Arabic}/u.test(ch)) scripts.add('arabic')
    else if (/\p{L}/u.test(ch)) scripts.add('latin')
  }
  return [...scripts]
}
