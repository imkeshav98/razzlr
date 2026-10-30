import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { FONT_FACES, type FontFace } from './index.ts'

export const FONT_FILES_DIR = join(import.meta.dirname, '..', 'files')

/** Every shipped font face with its bytes, read from this package's files. */
export function loadFontFiles(): (FontFace & { bytes: Uint8Array })[] {
  return FONT_FACES.map((face) => ({ ...face, bytes: new Uint8Array(readFileSync(join(FONT_FILES_DIR, face.file))) }))
}
