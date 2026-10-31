import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { FONT_FILES_DIR } from '@razzlr/fonts/node'
import { describe, expect, it } from 'vitest'
import { readImageHeader } from './images.ts'
import { fontPreview, readFontInfo } from './font-file.ts'

const fontFile = (file: string) => new Uint8Array(readFileSync(join(FONT_FILES_DIR, file)))

describe('readFontInfo', () => {
  it('reads the family, weight and style from the font’s own tables', () => {
    expect(readFontInfo(fontFile('NotoSans-Regular.ttf'))).toEqual({ contentType: 'font/ttf', family: 'Noto Sans', weight: 400, style: 'normal' })
    expect(readFontInfo(fontFile('NotoSans-ExtraBold.ttf'))).toEqual({ contentType: 'font/ttf', family: 'Noto Sans', weight: 800, style: 'normal' })
    expect(readFontInfo(fontFile('NotoNaskhArabic-Bold.ttf'))).toMatchObject({ family: 'Noto Naskh Arabic', weight: 700 })
  })

  it('refuses what is not one TrueType or OpenType font', () => {
    const font = fontFile('NotoSans-Regular.ttf')
    expect(readFontInfo(new TextEncoder().encode('not a font at all, just some text'))).toBeNull()
    // WOFF2 and collections, by their signatures.
    expect(readFontInfo(new Uint8Array([...new TextEncoder().encode('wOF2'), ...font.subarray(4)]))).toBeNull()
    expect(readFontInfo(new Uint8Array([...new TextEncoder().encode('ttcf'), ...font.subarray(4)]))).toBeNull()
    // Cut short, so its tables run past the end.
    expect(readFontInfo(font.subarray(0, 2000))).toBeNull()
  })
})

describe('fontPreview', () => {
  it('draws the family’s name in the face as a PNG', async () => {
    const preview = await fontPreview(fontFile('NotoSans-Bold.ttf'), { family: 'Noto Sans', weight: 700, style: 'normal' })
    const header = readImageHeader(preview)
    expect(header?.contentType).toBe('image/png')
    expect(header?.height).toBe(48)
    expect(header?.width).toBeGreaterThan(100)
  })

  it('throws for bytes CanvasKit can’t read', async () => {
    await expect(fontPreview(new Uint8Array(100), { family: 'X', weight: 400, style: 'normal' })).rejects.toThrow(/can't read/)
  })
})
