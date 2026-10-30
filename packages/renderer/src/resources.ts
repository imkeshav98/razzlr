import type { CanvasKit, Image } from 'canvaskit-wasm'
import type { Resources } from './draw.ts'

export interface ResourceBytes {
  /** Font files by family; the font's own name is ignored. Never system fonts (CLAUDE.md). */
  fonts: { family: string; bytes: Uint8Array }[]
  fallbackFamilies: string[]
  /** Encoded images (PNG, JPEG, WebP) by asset id, from originals or renditions we store. */
  images: Record<string, Uint8Array>
}

/** Registers fonts and decodes images with CanvasKit itself, so every runtime reads the same bytes the same way. */
export function makeResources(ck: CanvasKit, bytes: ResourceBytes): Resources & { delete(): void } {
  const provider = ck.TypefaceFontProvider.Make()
  for (const font of bytes.fonts) provider.registerFont(font.bytes, font.family)
  const fonts = ck.FontCollection.Make()
  fonts.setDefaultFontManager(provider)
  const images = new Map<string, Image>()
  const free = () => {
    for (const image of images.values()) image.delete()
    fonts.delete()
    provider.delete()
  }
  for (const [id, encoded] of Object.entries(bytes.images)) {
    const image = ck.MakeImageFromEncoded(encoded)
    if (!image) {
      free()
      throw new Error(`CanvasKit can't decode the image for asset "${id}"`)
    }
    images.set(id, image)
  }
  return { fonts, fallbackFamilies: bytes.fallbackFamilies, images, delete: free }
}
