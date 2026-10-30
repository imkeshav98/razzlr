/** One font file we ship. Fonts are loaded from these bytes, never from the system (CLAUDE.md). */
export interface FontFile {
  family: string
  /** For people and the manifest; CanvasKit reads the weight and style from the file itself. */
  weight: number
  style: 'normal' | 'italic'
  file: string
}

/** The fonts of the phase 0 spike: Latin, Devanagari and Arabic, each in the weights the fixtures use. */
export const FONT_FACES: readonly FontFile[] = [
  { family: 'Noto Sans', weight: 400, style: 'normal', file: 'NotoSans-Regular.ttf' },
  { family: 'Noto Sans', weight: 700, style: 'normal', file: 'NotoSans-Bold.ttf' },
  { family: 'Noto Sans', weight: 800, style: 'normal', file: 'NotoSans-ExtraBold.ttf' },
  { family: 'Noto Sans Devanagari', weight: 400, style: 'normal', file: 'NotoSansDevanagari-Regular.ttf' },
  { family: 'Noto Sans Devanagari', weight: 700, style: 'normal', file: 'NotoSansDevanagari-Bold.ttf' },
  { family: 'Noto Naskh Arabic', weight: 400, style: 'normal', file: 'NotoNaskhArabic-Regular.ttf' },
  { family: 'Noto Naskh Arabic', weight: 700, style: 'normal', file: 'NotoNaskhArabic-Bold.ttf' },
]

/** Used for any character a layer's own family lacks, such as Latin digits inside Arabic text. */
export const FALLBACK_FAMILY = 'Noto Sans'
