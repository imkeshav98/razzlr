// Reads a font file's family, weight and style from its own tables (#50), so the API can refuse what
// isn't a TrueType or OpenType font and name an upload as its designer did. Drawing stays with
// CanvasKit, which also has to accept the file before it is recorded.
import { loadCanvasKit } from '@dazbee/renderer/node'
import type { FontType } from '@dazbee/schema'

export interface FontInfo { contentType: FontType; family: string; weight: number; style: 'normal' | 'italic' }

const tag = (view: DataView, at: number) => String.fromCharCode(view.getUint8(at), view.getUint8(at + 1), view.getUint8(at + 2), view.getUint8(at + 3))

function utf16be(view: DataView, at: number, length: number) {
  let text = ''
  for (let i = 0; i + 1 < length; i += 2) text += String.fromCharCode(view.getUint16(at + i))
  return text
}

function latin1(view: DataView, at: number, length: number) {
  let text = ''
  for (let i = 0; i < length; i++) text += String.fromCharCode(view.getUint8(at + i))
  return text
}

/** The name table's strings by name id, Windows English first, then any Windows, then Mac Roman. */
function names(view: DataView, at: number, length: number): Map<number, string> {
  const found = new Map<number, { rank: number; text: string }>()
  if (length < 6) return new Map()
  const count = view.getUint16(at + 2)
  const strings = at + view.getUint16(at + 4)
  for (let i = 0; i < count; i++) {
    const record = at + 6 + i * 12
    if (record + 12 > at + length) break
    const [platform, encoding, language, nameId, size, offset] = [0, 2, 4, 6, 8, 10].map((o) => view.getUint16(record + o)) as [number, number, number, number, number, number]
    if (strings + offset + size > view.byteLength) continue
    const rank = platform === 3 && (encoding === 1 || encoding === 10) ? (language === 0x409 ? 0 : 1) : platform === 1 && encoding === 0 ? 2 : -1
    if (rank < 0 || (found.get(nameId)?.rank ?? 9) <= rank) continue
    const text = (platform === 3 ? utf16be(view, strings + offset, size) : latin1(view, strings + offset, size)).trim()
    if (text) found.set(nameId, { rank, text })
  }
  return new Map([...found].map(([id, { text }]) => [id, text]))
}

/** The font's family, weight and style, or null when the bytes are not one TrueType or OpenType font. */
export function readFontInfo(bytes: Uint8Array): FontInfo | null {
  if (bytes.length < 12) return null
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const version = view.getUint32(0)
  // TrueType outlines (1.0 or Apple's 'true'), or CFF outlines ('OTTO'). Collections and WOFF are refused.
  const contentType: FontType | null = version === 0x00010000 || version === 0x74727565 ? 'font/ttf' : version === 0x4f54544f ? 'font/otf' : null
  if (!contentType) return null
  const tables = new Map<string, { at: number; length: number }>()
  const count = view.getUint16(4)
  for (let i = 0; i < count; i++) {
    const record = 12 + i * 16
    if (record + 16 > bytes.length) return null
    const at = view.getUint32(record + 8)
    const length = view.getUint32(record + 12)
    if (at + length > bytes.length) return null
    tables.set(tag(view, record), { at, length })
  }
  const name = tables.get('name')
  if (!name) return null
  const named = names(view, name.at, name.length)
  // The typographic family (16) groups every weight under one name; the legacy one (1) may be "Inter SemiBold".
  const family = named.get(16) ?? named.get(1)
  if (!family) return null
  let weight = 400
  let italic = /italic|oblique/i.test(named.get(17) ?? named.get(2) ?? '')
  const os2 = tables.get('OS/2')
  if (os2 && os2.length >= 64) {
    const weightClass = view.getUint16(os2.at + 4)
    if (weightClass >= 1 && weightClass <= 1000) weight = weightClass
    const selection = view.getUint16(os2.at + 62)
    italic ||= (selection & 0x1) !== 0 || (selection & 0x200) !== 0
  }
  return { contentType, family, weight, style: italic ? 'italic' : 'normal' }
}

/**
 * A preview is the family's name at 32 pixels on a 48 pixel tall strip with its baseline 36 down,
 * every family alike, so the picker shows them at one size on one line; it shows them at half size.
 * What a family draws above or below the strip is cut.
 */
const PREVIEW_SIZE = 32
const PREVIEW_HEIGHT = 48
const PREVIEW_BASELINE = 36
const PREVIEW_MAX_WIDTH = 640

/**
 * The family's name drawn in the face itself, near black on clear, as a PNG: the font picker shows
 * it, so the browser never decodes the font. Throws when CanvasKit can't read the font.
 */
export async function fontPreview(bytes: Uint8Array, { family, weight, style }: Pick<FontInfo, 'family' | 'weight' | 'style'>): Promise<Uint8Array> {
  const ck = await loadCanvasKit()
  const typeface = ck.Typeface.MakeTypefaceFromData(bytes.slice().buffer)
  if (!typeface) throw new Error('CanvasKit can\'t read this font')
  typeface.delete()
  const provider = ck.TypefaceFontProvider.Make()
  const fonts = ck.FontCollection.Make()
  try {
    provider.registerFont(bytes, 'preview')
    fonts.setDefaultFontManager(provider)
    const paragraphStyle = new ck.ParagraphStyle({
      textStyle: {
        color: ck.Color(31, 35, 41, 1), fontFamilies: ['preview'], fontSize: PREVIEW_SIZE,
        fontStyle: { weight: { value: weight }, slant: style === 'italic' ? ck.FontSlant.Italic : ck.FontSlant.Upright },
      },
      maxLines: 1, ellipsis: '…',
    })
    const builder = ck.ParagraphBuilder.MakeFromFontCollection(paragraphStyle, fonts)
    builder.addText(family)
    const paragraph = builder.build()
    builder.delete()
    try {
      paragraph.layout(PREVIEW_MAX_WIDTH)
      const width = Math.max(1, Math.min(PREVIEW_MAX_WIDTH, Math.ceil(paragraph.getMaxIntrinsicWidth())))
      const surface = ck.MakeSurface(width, PREVIEW_HEIGHT)
      if (!surface) throw new Error('could not make a surface for the preview')
      try {
        surface.getCanvas().drawParagraph(paragraph, 0, PREVIEW_BASELINE - paragraph.getAlphabeticBaseline())
        const image = surface.makeImageSnapshot()
        const png = image.encodeToBytes()
        image.delete()
        if (!png) throw new Error('could not encode the preview')
        return png
      } finally {
        surface.delete()
      }
    } finally {
      paragraph.delete()
    }
  } finally {
    fonts.delete()
    provider.delete()
  }
}
